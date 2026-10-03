const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

// Execute the production importer and event registration, without app startup.
// Only browser/persistence boundaries are doubles; parsing and replacement are real.
const source = readFileSync(process.env.APP_SOURCE || require.resolve('../app.js'), 'utf8');
const importer = source.slice(source.indexOf('function tradeState(){'), source.indexOf('function calendarEvents('));
const registrationStart = source.indexOf('  $("#calendarImportFiles")?.addEventListener');
const registration = source.slice(registrationStart, source.indexOf('  $$("[data-cal-day]")', registrationStart));
assert.ok(importer && registration, 'production source sections must exist');

function harness({ failCheckpoint = false, replaceInput = false } = {}) {
  const effects = { checkpoints: [], saves: [], alerts: [], renders: 0 };
  let handler;
  function makeInput() {
    let value = '';
    return {
      files: [],
      get value() { return value; },
      set value(v) { value = v; if (v === '') this.files = []; },
      addEventListener(type, fn) { assert.equal(type, 'change'); handler = fn; },
    };
  }
  const input = makeInput();
  let visibleInput = input;
  const context = vm.createContext({
    S: { infomartTrade: { months: [], days: [] } },
    CALENDAR_MONTH: '2026-10', CALENDAR_TRADE_STORE: 'all',
    clone: x => JSON.parse(JSON.stringify(x)), URLSearchParams,
    checkpoint(label) {
      effects.checkpoints.push(label);
      if (failCheckpoint) throw Error('checkpoint failure');
    },
    save: label => effects.saves.push(label),
    alert: message => effects.alerts.push(message),
    render() { effects.renders++; if (replaceInput) visibleInput = makeInput(); },
    $: selector => { assert.equal(selector, '#calendarImportFiles'); return visibleInput; },
  });
  vm.runInContext(importer + '\n' + registration, context);
  return {
    input, effects, context,
    // Model a picker that suppresses change when the same file is selected.
    async select(files) {
      const value = files.length ? 'C:\\fakepath\\' + files.map(f => f.name).join('|') : '';
      if (input.value === value) return false;
      input.value = value;
      input.files = files;
      await handler({ target: input });
      return true;
    },
    emptyChange() { input.value = ''; input.files = []; return handler({ target: input }); },
    cancel() { /* Native picker cancel dispatches no change. */ },
  };
}
const month = (storeName = '店舗A', ym = '2026-10') => ({
  schemaVersion: 'infomart-trade-calendar-export-v1', storeName, ym, days: [],
});
const day = (date = '2026-10-03') => ({
  schemaVersion: 'infomart-trade-list-export-v1', storeName: '店舗A', date,
  orders: [{ items: [{ code: '001', qty: 2 }] }],
});
const file = (name, pkg) => ({ name, text: async () => JSON.stringify(pkg) });

test('same file twice: both imports run, one snapshot is replaced, checkpoint once per batch', async () => {
  const h = harness(), f = file('month.json', month());
  assert.equal(await h.select([f]), true);
  assert.equal(h.input.value, '');
  assert.equal(await h.select([f]), true);
  assert.equal(h.input.value, '');
  assert.equal(h.context.S.infomartTrade.months.length, 1);
  assert.equal(h.effects.checkpoints.length, 2);
  assert.equal(h.effects.saves.length, 2);
  assert.match(h.effects.alerts[1], /既存スナップショット更新 1件/);
});

test('broken JSON then same-name corrected JSON: failure clears input without saving', async () => {
  const h = harness();
  await h.select([{ name: 'trade.json', text: async () => '{broken' }]);
  assert.equal(h.input.value, '');
  assert.equal(h.effects.saves.length, 0);
  assert.equal(h.effects.renders, 0);
  assert.equal(h.context.S.infomartTrade.months.length, 0);
  assert.match(h.effects.alerts[0], /取り込めませんでした。.*trade.json:/s);
  assert.equal(await h.select([file('trade.json', month())]), true);
  assert.equal(h.context.S.infomartTrade.months.length, 1);
  assert.equal(h.effects.checkpoints.length, 2);
  assert.equal(h.effects.saves.length, 1);
});

test('multiple files: month/day imports, per-store replacement, partial error behavior preserved', async () => {
  const h = harness();
  const files = [file('a.json', month()), file('b.json', month('店舗B')),
    file('d.json', day()), { name: 'bad.json', text: async () => '{' }];
  await h.select(files);
  assert.equal(h.input.value, '');
  assert.equal(h.context.S.infomartTrade.months.length, 2);
  assert.equal(h.context.S.infomartTrade.days.length, 1);
  assert.equal(h.effects.checkpoints.length, 1);
  assert.equal(h.effects.saves.length, 1);
  assert.match(h.effects.alerts[0], /月カレンダー 2件 \/ 日別明細 1件/);
  assert.match(h.effects.alerts[0], /伝票 1件 \/ 商品明細 1件/);
  assert.match(h.effects.alerts[0], /読込エラー:\nbad.json:/);
  await h.select(files);
  assert.match(h.effects.alerts[1], /既存スナップショット更新 3件/);
  assert.equal(h.context.S.infomartTrade.months.length, 2);
  assert.equal(h.context.S.infomartTrade.days.length, 1);
});

test('picker cancel and empty FileList: no checkpoint, save, render or alert', async () => {
  const h = harness();
  h.cancel();
  await h.emptyChange();
  assert.equal(h.input.value, '');
  assert.deepEqual(h.effects, { checkpoints: [], saves: [], alerts: [], renders: 0 });
  await h.select([file('month.json', month())]);
  const before = JSON.stringify(h.effects);
  h.cancel();
  await h.emptyChange();
  assert.equal(JSON.stringify(h.effects), before);
  assert.equal(h.context.S.infomartTrade.months.length, 1);
});

test('render replaces DOM input: the original event target is still cleared', async () => {
  const h = harness({ replaceInput: true });
  await h.select([file('month.json', month())]);
  assert.equal(h.effects.renders, 1);
  assert.equal(h.input.value, '');
});

test('unexpected importer rejection: finally clears input and preserves rejection', async () => {
  const h = harness({ failCheckpoint: true });
  await assert.rejects(h.select([file('month.json', month())]), /checkpoint failure/);
  assert.equal(h.input.value, '');
  assert.equal(h.effects.saves.length, 0);
});