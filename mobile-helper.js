(function(){
"use strict";
/* v1.4.9 P0 safety: fresh payload, DOM identity lock, fail-closed, receipt verification. */

function createInfomartQuantityCore() {
  "use strict";
  const rowSelector = "tr.slip-summary-a";
  const inputSelector = "input#prodQtyTxt[name='q'].w50.ime-dis.mainLineText";
  const PAYLOAD_TTL_MS = 60*60*1000;
  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const normText = s => String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  function decode(raw) {
    if (typeof raw !== "string" || !raw.trim().startsWith("IFM1:")) throw Error("発注ナビの数量データではありません");
    let encoded = raw.trim().slice(5).replace(/-/g, "+").replace(/_/g, "/");
    while (encoded.length % 4) encoded += "=";
    const p = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
    if (!p || p.payloadVersion !== 2 || !p.runId || !Array.isArray(p.items) || !p.items.length) throw Error("数量データの形式が古い、または不正です。発注ナビからもう一度開始してください");
    const created = Date.parse(p.createdAt || ""), expires = Date.parse(p.expiresAt || "");
    const now = Date.now();
    if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires-created > PAYLOAD_TTL_MS+60000) throw Error("数量データの日時情報が不正です");
    if (now > expires || now-created > PAYLOAD_TTL_MS) throw Error("数量データの有効時間（60分）が切れています。発注ナビからもう一度開始してください");
    if (created-now > 5*60*1000) throw Error("端末の日時または数量データの作成日時が不正です");
    return p;
  }
  function normalize(it) {
    const code = typeof it?.code === "string" ? it.code.trim() : "";
    const qty = typeof it?.qty === "number" || typeof it?.qty === "string" ? String(it.qty).trim() : "";
    const allowDecimal = it?.allowDecimalQty === true;
    const qtyOk = (allowDecimal ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(qty) && Number.isFinite(Number(qty)) && Number(qty) >= 0 && Number(qty) <= Number.MAX_SAFE_INTEGER;
    const identity = it?.identity && typeof it.identity === "object" ? {
      name:normText(it.identity.name),
      specification:normText(it.identity.specification),
      vendorDisplay:normText(it.identity.vendorDisplay)
    } : null;
    const identityOk = Boolean(identity?.name && identity?.vendorDisplay);
    return {code, qty, allowDecimal, identity, valid:/^\d{7,13}$/.test(code) && qtyOk && identityOk};
  }
  function locate(doc, item) {
    const code = item.code;
    const rows = all(doc, rowSelector).filter(row => all(row, "td.listtd").some(cell => cell.closest("tr") === row && cell.textContent.trim() === code));
    if (!rows.length) return {status:"missing", msg:"商品コードがこのページにありません。別ページならスキップして続行します"};
    if (rows.length !== 1) return {status:"duplicate", msg:"同じ商品コードの行が複数あります。安全のため停止します"};
    const row = rows[0], cells = all(row, "td.listtd").filter(cell => cell.closest("tr") === row);
    if (cells.length < 6) return {status:"contract", msg:"商品行の列構造が想定と違います。安全のため停止します"};
    const actual = {name:normText(cells[1]?.textContent), specification:normText(cells[2]?.textContent), vendorDisplay:normText(cells[cells.length-1]?.textContent)};
    if (!item.identity) return {status:"identity-missing", msg:"商品本人確認情報がありません。安全のため停止します"};
    if (actual.name !== item.identity.name) return {status:"identity-name", msg:"商品名が発注ナビの登録内容と一致しません。安全のため停止します"};
    if (item.identity.specification && actual.specification !== item.identity.specification) return {status:"identity-spec", msg:"規格が発注ナビの登録内容と一致しません。安全のため停止します"};
    if (actual.vendorDisplay !== item.identity.vendorDisplay) return {status:"identity-vendor", msg:"発注先表示が発注ナビの登録内容と一致しません。安全のため停止します"};
    const inputs = all(row, inputSelector).filter(input => input.closest("tr") === row);
    if (!inputs.length) return {status:"noinput", msg:"指定の数量欄がありません。安全のため停止します"};
    if (inputs.length !== 1) return {status:"duplicate-input", msg:"数量欄が複数あります。安全のため停止します"};
    const input = inputs[0], view = doc.defaultView;
    if (!input.isConnected || !["text", "number"].includes(input.type) || input.matches(":disabled") || input.readOnly || !input.getClientRects().length || view.getComputedStyle(input).visibility !== "visible") {
      return {status:"unavailable", msg:"数量欄が非表示・無効・読取専用です。安全のため停止します"};
    }
    return {row, input, actual};
  }
  function apply(doc, items) {
    if (!Array.isArray(items) || !items.length) throw Error("商品がありません");
    const normalized = items.map(normalize), counts = new Map();
    for (const item of normalized) counts.set(item.code, (counts.get(item.code) || 0) + 1);
    const results = normalized.map(item => {
      const {code, qty} = item;
      const fail = (status, msg) => ({code, qty, status, msg});
      if (!item.valid) return fail("invalid", "商品コード・数量・本人確認情報が不正です。安全のため停止します");
      if (counts.get(code) !== 1) return fail("duplicate-payload", "入力データ内の商品コードが重複しています。安全のため停止します");
      const found = locate(doc, item);
      if (!found.input) return fail(found.status, found.msg);
      const input = found.input, view = doc.defaultView;
      const probe = input.cloneNode(false);
      probe.value = qty;
      if (probe.value !== qty || !probe.checkValidity() || (input.maxLength >= 0 && qty.length > input.maxLength)) return fail("invalid-quantity", "数量が入力欄の制約に合いません。安全のため停止します");
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
      if (!setter) return fail("unavailable", "数量欄の値を設定できません。安全のため停止します");
      try {
        setter.call(input, qty);
        input.dispatchEvent(new view.Event("input", {bubbles:true}));
        if (locate(doc, item).input !== input || input.value !== qty) return fail("changed", "入力中に画面または値が変わりました。手動確認が必要です");
        input.dispatchEvent(new view.Event("change", {bubbles:true}));
        if (locate(doc, item).input !== input || input.value !== qty) return fail("changed", "入力後に画面または値が変わりました。手動確認が必要です");
        return fail("filled", "数量入力完了（発注は未確定）");
      } catch (_) {
        return fail("error", "入力処理でエラーが発生しました。数量を手動確認してください");
      }
    });
    for (const result of results) if (result.status === "filled") {
      const item = normalized.find(x => x.code === result.code);
      const found = item ? locate(doc, item) : null;
      if (!found?.input || found.input.value !== result.qty) Object.assign(result, {status:"changed", msg:"処理中に画面または値が変わりました。手動確認が必要です"});
    }
    return {ok:results.filter(r => r.status === "filled").length, total:results.length, results};
  }
  return {decode, apply, normalize};
}

const MOBILE_VERSION="1.4.9";
const PREFIX="IFM1:";
const RECEIPT_PREFIX="IFMR1:";
const STATE_KEY="__IFM_MOBILE_AUTOFILL_V149__";
const core=createInfomartQuantityCore();

function encodeTagged(prefix,obj){
  const bytes=new TextEncoder().encode(JSON.stringify(obj));let bin="";
  bytes.forEach(b=>bin+=String.fromCharCode(b));
  return prefix+btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function assertInfomartCatalog(){
  if(window.top!==window)throw Error("フレーム内では実行しません。Infomartの商品一覧を直接開いてください");
  if(location.origin!=="https://www2.infomart.co.jp"||location.pathname!=="/trade/order_my_catalog.page"){
    throw Error("Infomartの商品一覧（order_my_catalog.page）を開いて実行してください");
  }
  const rows=Array.from(document.querySelectorAll("tr.slip-summary-a"));
  if(!rows.length)throw Error("商品行が見つかりません。Infomartの画面構造が変更された可能性があります");
  const sample=rows.slice(0,Math.min(20,rows.length));
  const good=sample.filter(row=>{
    const code=Array.from(row.querySelectorAll("td.listtd")).some(td=>/^\d{7,13}$/.test(td.textContent.trim()));
    const qty=row.querySelector("input#prodQtyTxt[name='q'].w50.ime-dis.mainLineText");
    return code&&qty;
  }).length;
  if(good<Math.max(1,Math.ceil(sample.length*0.7))){
    throw Error(`Infomartの画面構造チェックに失敗しました（${good}/${sample.length}行）。数量入力を停止します`);
  }
}
function readState(){
  try{const raw=sessionStorage.getItem(STATE_KEY);return raw?JSON.parse(raw):null}catch(_){return null}
}
function saveState(s){try{sessionStorage.setItem(STATE_KEY,JSON.stringify(s))}catch(_){}}
function clearState(){try{sessionStorage.removeItem(STATE_KEY)}catch(_){}}
function hashPayload(){
  const m=location.hash.match(/(?:^#|[&#])ifm=([^&]+)/);
  if(!m)return "";
  try{return decodeURIComponent(m[1])}catch(_){return ""}
}
function validCandidate(raw){
  try{
    const p=core.decode(String(raw||"").trim());
    return {raw:String(raw).trim(),payload:p,created:Date.parse(p.createdAt||"")};
  }catch(_){return null}
}
async function acquireRaw(){
  let clip="";try{clip=(await navigator.clipboard.readText()||"").trim()}catch(_){}
  const state=readState(),candidates=[
    validCandidate(hashPayload()),
    validCandidate(clip),
    validCandidate(state?.raw)
  ].filter(Boolean).sort((a,b)=>b.created-a.created);
  if(candidates.length){
    const c=candidates[0],resume=Boolean(state&&state.raw===c.raw&&state.runId===c.payload.runId);
    return {raw:c.raw,payload:c.payload,resume};
  }
  const pasted=prompt("発注ナビで今回作った数量データを貼り付けてください。古いデータは使えません。");
  if(!pasted)throw Error("有効な数量データがありません。入力は行っていません");
  const c=validCandidate(String(pasted).trim());
  if(!c)throw Error("数量データが古い、または形式が違います。発注ナビからもう一度開始してください");
  return {raw:c.raw,payload:c.payload,resume:false};
}
function removeOverlay(){document.getElementById("__ifmMobileOverlay")?.remove()}
function makeButton(label,kind,fn){
  const b=document.createElement("button");
  b.type="button";b.textContent=label;
  b.style.cssText="min-height:44px;padding:10px 14px;margin:4px;border-radius:10px;border:1px solid #ccd3da;font-weight:800;font-size:15px;background:"+
    (kind==="danger"?"#b42318":kind==="primary"?"#0b6edc":"#fff")+";color:"+(kind==="secondary"?"#17202a":"#fff");
  b.onclick=fn;return b;
}
function receiptFromState(payload,state){
  const items=payload.items.filter(x=>state.completed?.[x.code]).map(x=>({code:String(x.code),qty:String(state.completed[x.code].qty)}));
  return encodeTagged(RECEIPT_PREFIX,{receiptVersion:1,runId:payload.runId,payloadCreatedAt:payload.createdAt,finishedAt:new Date().toISOString(),items});
}
function renderOverlay(payload,state,report,allDone){
  removeOverlay();
  const box=document.createElement("section");
  box.id="__ifmMobileOverlay";box.setAttribute("role","region");box.setAttribute("aria-label","Infomart数量自動入力結果");
  box.style.cssText="position:fixed;z-index:2147483647;left:10px;right:10px;bottom:10px;max-height:72vh;overflow:auto;padding:15px;background:#fff;color:#17202a;border:2px solid #0b6edc;border-radius:14px;box-shadow:0 8px 30px #0005;font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const doneCount=Object.keys(state.completed||{}).length,total=payload.items.length;
  const remain=payload.items.filter(x=>!state.completed?.[x.code]&&!state.failed?.[x.code]).length;
  const h=document.createElement("div");h.style.cssText="font-size:20px;font-weight:900";h.textContent=`Infomart 数量自動入力 v${MOBILE_VERSION}`;box.appendChild(h);
  const s=document.createElement("div");s.style.cssText="margin-top:6px;font-weight:800";s.textContent=`${doneCount} / ${total}件 入力完了`;box.appendChild(s);
  const sub=document.createElement("div");sub.style.cssText="margin-top:5px";
  sub.textContent=allDone?"全対象の入力が完了しました。数量を確認してから納品日入力へ進んでください。":`このページの処理が終わりました。未処理 ${remain}件。別ページの商品はページを手動で移動して、同じヘルパーをもう一度実行してください。`;
  box.appendChild(sub);
  if(report?.results?.length){
    const list=document.createElement("div");list.style.cssText="margin-top:10px;border-top:1px solid #dde3ea;padding-top:8px";
    for(const r of report.results){
      if(r.status==="missing")continue;
      const p=document.createElement("div");p.style.cssText="padding:5px 0;color:"+(r.status==="filled"?"#157f48":"#b42318");
      p.textContent=`${r.status==="filled"?"✓":"⚠"} ${r.code||"コードなし"} × ${r.qty} — ${r.msg}`;list.appendChild(p);
    }
    if(list.childNodes.length)box.appendChild(list);
  }
  if(Object.keys(state.failed||{}).length){
    const warn=document.createElement("div");warn.style.cssText="margin-top:10px;padding:10px;background:#fff0ee;color:#b42318;border-radius:9px;font-weight:700";
    warn.textContent="要確認の商品があります。自動で推測せず停止しています。Infomart画面で数量を確認してください。";box.appendChild(warn);
  }
  const note=document.createElement("div");note.style.cssText="margin-top:10px;padding:10px;background:#eef6ff;border-radius:9px";
  note.textContent="数量欄だけを変更します。納品日選択・注文確定・送信は行いません。商品コード・商品名・規格・発注先も照合しています。";box.appendChild(note);
  const actions=document.createElement("div");actions.style.cssText="margin-top:10px";
  if(doneCount){
    actions.appendChild(makeButton(allDone?"入力結果コードをコピー":"現在までの入力結果コードをコピー","primary",async()=>{
      const receipt=receiptFromState(payload,state);
      try{await navigator.clipboard.writeText(receipt);alert("入力結果コードをコピーしました。発注ナビへ戻って「数量入力結果コードを確認」を押してください。")}
      catch(_){prompt("この入力結果コードをコピーしてください。",receipt)}
    }));
  }
  actions.appendChild(makeButton("閉じる","secondary",removeOverlay));
  actions.appendChild(makeButton("今回の状態をリセット","danger",()=>{clearState();removeOverlay();alert("数量入力ヘルパーの今回の状態をリセットしました。")}));
  box.appendChild(actions);document.body.appendChild(box);
}
async function runMobile(){
  assertInfomartCatalog();
  if(window.__IFM_MOBILE_BUSY__)throw Error("数量入力処理中です");
  window.__IFM_MOBILE_BUSY__=true;
  try{
    const acquired=await acquireRaw(),raw=acquired.raw,payload=acquired.payload||core.decode(raw);
    assertInfomartCatalog();
    let state=readState();
    if(!acquired.resume||!state||state.raw!==raw||state.runId!==payload.runId){
      state={version:MOBILE_VERSION,runId:payload.runId,raw,completed:{},failed:{},startedAt:new Date().toISOString()};
    }
    const todo=payload.items.filter(it=>!state.completed[it.code]&&!state.failed[it.code]);
    let report={ok:0,total:0,results:[]};
    if(todo.length){
      report=core.apply(document,todo);
      for(const r of report.results){
        if(r.status==="filled")state.completed[r.code]={qty:r.qty,at:new Date().toISOString()};
        else if(r.status==="missing"){}
        else state.failed[r.code]=r;
      }
      saveState(state);
    }
    const allDone=payload.items.every(it=>Boolean(state.completed[it.code]));
    renderOverlay(payload,state,report,allDone);
    return {ok:Object.keys(state.completed).length,total:payload.items.length,allDone,failed:Object.keys(state.failed).length};
  }finally{window.__IFM_MOBILE_BUSY__=false}
}
window.__IFM_MOBILE_AUTOFILL_RUN__=runMobile;

runMobile().catch(e=>alert("数量自動入力を開始できません。\n"+(e?.message||e)));
})();
