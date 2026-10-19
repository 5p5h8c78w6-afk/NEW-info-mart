const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const production=source.slice(source.indexOf('function pastAttentionEntries('),source.indexOf('function skipOnce('));
const plain=x=>JSON.parse(JSON.stringify(x));
function harness({cancel=false,snapshotFail=false,persistFail=false}={}){
  const S={canceled:['old'],quantityOverrides:{'past|2026-10-03':{qty:3}},history:[{key:'done',qty:8}],products:[{id:'p',intervalDays:1}],presets:[{id:'preset'}],pendingRun:{entryKeys:['busy|2026-10-05']}};
  const profile={id:'self',name:'本人',updatedAt:'before',data:S};
  const ROOT={profiles:[profile,{id:'other',data:{canceled:[],products:[{id:'other'}]}}],commonMaster:{products:[{id:'master'}]},cloud:{test:'unchanged'}};
  const effects={prompts:[],alerts:[],renders:0,persists:0,snapshots:[]};
  const rows=[];
  const add=(key,scheduled,due=scheduled)=>rows.push({key,scheduled:new Date(scheduled+'T00:00:00'),due:due?new Date(due+'T00:00:00'):null});
  add('past|2026-10-03','2026-10-03');add('past2|2026-10-04','2026-10-04');add('busy|2026-10-05','2026-10-05');add('today','2026-10-19');add('future','2026-10-20');add('future-due-past','2026-10-21','2026-10-18');add('unsafe','2026-10-06',null);
  const storage=new Map();
  const context=vm.createContext({Date,S,ROOT,SNAP_KEY:'snap',today:()=>new Date('2026-10-19T00:00:00'),iso:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,classify:()=>({attention:rows.filter(e=>!S.canceled.includes(e.key))}),activeProfile:()=>profile,esc:s=>String(s),uid:()=>`snapshot${effects.snapshots.length}`,getSnapshots:()=>effects.snapshots,localStorage:{setItem(k,v){if(snapshotFail)throw Error('quota');storage.set(k,v);effects.snapshots=JSON.parse(v)},getItem:k=>storage.get(k)},persistRoot(){effects.persists++;if(persistFail)throw Error('quota');effects.saved=plain(ROOT)},render(){effects.renders++},confirm:m=>{effects.prompts.push(m);return !cancel},alert:m=>effects.alerts.push(m)});
  vm.runInContext(production,context);
  return {context,S,ROOT,profile,effects,rows};
}
test('bulk skips all past attention beyond the eight-row home preview; preserves other business data',()=>{
  const h=harness();for(let i=0;i<14;i++)h.rows.push({key:'extra'+i,scheduled:new Date('2026-10-02'),due:new Date('2026-10-02')});
  const before=plain(h.ROOT);h.context.skipPastAttention();
  assert.equal(h.S.attentionSkipUndo.keys.length,16);assert.equal(h.S.canceled.length,17);assert.equal(h.effects.persists,1);
  assert.match(h.effects.prompts[0],/16件/);assert.match(h.effects.prompts[0],/2026-10-02 ～ 2026-10-04/);
  assert.equal(h.effects.snapshots.length,1);assert.deepEqual(JSON.parse(h.effects.snapshots[0].data),before);
  for(const field of ['quantityOverrides','history','products','presets','pendingRun'])assert.deepEqual(h.S[field],before.profiles[0].data[field]);
  assert.deepEqual(h.ROOT.profiles[1],before.profiles[1]);assert.deepEqual(h.ROOT.commonMaster,before.commonMaster);assert.deepEqual(h.ROOT.cloud,before.cloud);
  assert.deepEqual(plain(h.context.pastAttentionEntries()),[]);
});
test('today, future, pending and invalid dates are never bulk targets; duplicates collapse',()=>{
  const h=harness();h.rows.push(h.rows[0]);h.rows.push({key:'invalid',scheduled:new Date('invalid'),due:new Date('invalid')});
  assert.deepEqual(plain(h.context.pastAttentionEntries()).map(e=>e.key),['past|2026-10-03','past2|2026-10-04']);
});
test('confirmation cancellation leaves data and snapshots unchanged',()=>{
  const h=harness({cancel:true}),before=plain(h.ROOT);h.context.skipPastAttention();assert.deepEqual(h.ROOT,before);assert.equal(h.effects.persists,0);assert.equal(h.effects.snapshots.length,0);
});
test('backup failure prevents mutation',()=>{
  const h=harness({snapshotFail:true}),before=plain(h.ROOT);h.context.skipPastAttention();assert.deepEqual(h.ROOT,before);assert.equal(h.effects.persists,0);assert.equal(h.effects.alerts.length,1);
});
test('root persistence failure rolls back memory and leaves pre-operation recovery point',()=>{
  const h=harness({persistFail:true}),before=plain(h.ROOT);h.context.skipPastAttention();assert.deepEqual(h.ROOT,before);assert.deepEqual(JSON.parse(h.effects.snapshots[0].data),before);assert.equal(h.effects.renders,0);
});
test('undo survives reload, restores only bulk keys and retains independent skips/quantity overrides',()=>{
  const h=harness(),before=plain(h.S);h.context.skipPastAttention();h.S.attentionSkipUndo=plain(h.S.attentionSkipUndo);h.S.canceled.push('independent');h.context.undoPastAttention();
  assert.deepEqual(plain(h.S.canceled),['old','independent']);assert.equal(h.S.attentionSkipUndo,undefined);assert.deepEqual(h.S.quantityOverrides,before.quantityOverrides);assert.equal(h.effects.persists,2);
});
test('undo cancellation and persistence failure retain saved state and undo metadata',()=>{
  const h=harness({cancel:true});h.S.canceled.push('bulk');h.S.attentionSkipUndo={keys:['bulk']};const before=plain(h.S);h.context.undoPastAttention();assert.deepEqual(h.S,before);
  const f=harness({persistFail:true});f.S.canceled.push('bulk');f.S.attentionSkipUndo={keys:['bulk']};const state=plain(f.S);f.context.undoPastAttention();assert.deepEqual(f.S,state);
});
test('undo blocks a pending entry and empty operations do not persist',()=>{
  const h=harness();h.S.canceled.push('busy|2026-10-05');h.S.attentionSkipUndo={keys:['busy|2026-10-05']};h.context.undoPastAttention();assert.equal(h.effects.persists,0);assert.equal(h.effects.prompts.length,0);
  h.rows.length=0;h.context.skipPastAttention();assert.equal(h.effects.persists,0);
});
test('both screens expose bulk action and count, and undo-only state remains accessible',()=>{
  const h=harness();assert.match(h.context.attentionBulkPanel(h.context.classify()),/一括スキップ（2件）/);h.context.skipPastAttention();
  const panel=h.context.attentionBulkPanel(h.context.classify());assert.match(panel,/取り消す（2件）/);assert.doesNotMatch(panel,/id="skipPastAttention"/);
  assert.equal(source.split('${attentionBulkPanel(c)}').length-1,2);
  assert.match(source,/\$\("#skipPastAttention"\)\?\.addEventListener\("click",skipPastAttention\)/);
});
