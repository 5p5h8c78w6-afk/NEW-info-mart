const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const production=source.slice(source.indexOf('function vendorDialog('),source.indexOf('function productPersonalDialog('));
function harness({allowed=true}={}){
  const effects={saves:[],alerts:[],auth:0,sync:0};
  const dialog={open:true,scrollTop:12,listeners:new Set(),showModal(){this.open=true},close(){this.open=false;for(const fn of [...this.listeners])fn()},addEventListener(t,fn){assert.equal(t,'close');this.listeners.add(fn)},removeEventListener(t,fn){this.listeners.delete(fn)}};
  const body={childNodes:[],replaceChildren(...nodes){this.childNodes=nodes}};
  const element=()=>({value:'',checked:false,options:[],addEventListener(t,fn){this['on'+t]=fn},focus(){},insertBefore(option){this.options.splice(-1,0,option)},get lastElementChild(){return this.options.at(-1)}});
  function modal(html){
    const fields={};
    for(const m of html.matchAll(/<(input|select|button)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)(?=<input|<select|<button|$)/g)){
      const e=element();e.value=m[2].match(/value="([^"]*)"/)?.[1]||'';e.checked=/\bchecked\b/.test(m[2]);
      if(m[1]==='select'){
        e.options=[...m[4].split('</select>')[0].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)/g)].map(o=>({value:o[1],selected:/selected/.test(o[2]),textContent:o[3]}));
        e.value=(e.options.find(o=>o.selected)||e.options[0])?.value||'';
      }
      fields['#'+m[3]]=e;
    }
    body.childNodes=[{fields,html}];dialog.open=true;
  }
  const root={commonMaster:{vendors:[{id:'old',name:'既存',scheduleEntries:[{classKey:'8days'}]}],products:[]},masterVersion:1};
  let counter=0;
  const context=vm.createContext({ROOT:root,document:{createElement:element},$:s=>s==='#modal'?dialog:s==='#modalBody'?body:body.childNodes[0]?.fields[s]||null,modal,uid:()=>`id${++counter}`,clone:x=>JSON.parse(JSON.stringify(x)),normalizeVendor:x=>x,V:id=>root.commonMaster.vendors.find(v=>v.id===id),MP:id=>root.commonMaster.products.find(p=>p.id===id),esc:x=>String(x??''),weeks:()=>'',bindWeeks(){},selected:()=>[],splitDates:s=>s.split(',').filter(Boolean),productSpecText:p=>p.specification||'未取得',scheduleClassLabel:x=>x,requireAdmin:async()=>{effects.auth++;return allowed},checkpoint(){},syncMasterToProfiles(){effects.sync++},save:r=>effects.saves.push(r),alert:m=>effects.alerts.push(m),confirm:()=>true,showDomRow(){}});
  vm.runInContext(production,context);
  const get=s=>context.$(s);
  const draft={mc:'00123456789',mn:'入力中 商品',mspec:'1kg×6',ml:'0',msc:'8days'};
  function fill(){for(const [id,value] of Object.entries(draft))get('#'+id).value=value;get('#mdec').checked=true}
  async function create(){get('#mv').value='__new_vendor__';await get('#mv').onchange()}
  function preserved(){for(const [id,value] of Object.entries(draft))assert.equal(get('#'+id).value,value);assert.equal(get('#mdec').checked,true)}
  return {context,root,effects,get,dialog,body,fill,create,preserved};
}
test('save vendor returns identical product form, selects vendor and saves complete product draft',async()=>{
  const h=harness();h.context.productMasterDialog();h.fill();const nodes=h.body.childNodes,save=h.get('#sm').onclick;
  await h.create();assert.equal(h.root.commonMaster.products.length,0);
  h.get('#vn').value='新規発注先';h.get('#sv').onclick();h.preserved();
  assert.equal(h.body.childNodes[0],nodes[0]);assert.equal(h.get('#sm').onclick,save);
  const v=h.root.commonMaster.vendors.at(-1);assert.equal(h.get('#mv').value,v.id);assert.equal(v.calendarConfirmed,false);assert.deepEqual([...v.deliveryWeekdays],[]);assert.equal(v.orderHolidayRule,'unknown');assert.equal(v.deliveryHolidayRule,'unknown');assert.equal(h.dialog.listeners.size,0);
  h.get('#sm').onclick();const p=h.root.commonMaster.products[0];assert.equal(p.code,'00123456789');assert.equal(p.specification,'1kg×6');assert.equal(p.leadDaysOverride,0);assert.equal(p.allowDecimalQty,true);assert.equal(p.scheduleClass,'8days');assert.equal(p.vendorId,v.id);assert.equal(h.effects.sync,2);
});
test('close or Escape cancellation preserves draft and prior selection; repeated visits do not leak handlers',async()=>{
  const h=harness();h.context.productMasterDialog();h.fill();
  for(let i=0;i<3;i++){await h.create();h.dialog.close();h.preserved();assert.equal(h.get('#mv').value,'old');assert.equal(h.dialog.open,true);assert.equal(h.dialog.listeners.size,0)}
  assert.equal(h.root.commonMaster.vendors.length,1);assert.equal(h.effects.saves.length,0);h.dialog.close();assert.equal(h.dialog.open,false);
});
test('permission denial keeps draft and does not open vendor editor or mutate data',async()=>{
  const h=harness({allowed:false});h.context.productMasterDialog();h.fill();await h.create();h.preserved();assert.equal(h.get('#mv').value,'old');assert.equal(h.get('#vn'),null);assert.equal(h.effects.auth,1);assert.equal(h.effects.saves.length,0);
});
test('vendor validation failure stays in editor; cancel returns unchanged draft',async()=>{
  const h=harness();h.context.productMasterDialog();h.fill();await h.create();h.get('#sv').onclick();assert.equal(h.root.commonMaster.vendors.length,1);assert.equal(h.effects.alerts.length,1);h.get('#vn').value='新規';h.get('#vok').checked=true;h.get('#sv').onclick();assert.equal(h.root.commonMaster.vendors.length,1);h.dialog.close();h.preserved();
});
test('edit existing product retains identity and source evidence through vendor return',async()=>{
  const h=harness();h.root.commonMaster.products.push({id:'p1',code:'00123456789',name:'商品',vendorId:'old',domSource:{code:'00123456789',name:'商品',specification:'1kg'},scheduleClass:'standard'});h.context.validateDomRow=()=>{};h.context.productMasterDialog('p1');await h.create();h.get('#vn').value='新規';h.get('#sv').onclick();h.get('#sm').onclick();assert.equal(h.root.commonMaster.products.length,1);assert.equal(h.root.commonMaster.products[0].id,'p1');assert.equal(h.root.commonMaster.products[0].domSource.code,'00123456789');
});
test('invalid and duplicate product codes remain rejected after return',async()=>{
  const h=harness();h.context.productMasterDialog();await h.create();h.dialog.close();h.get('#mc').value='bad';h.get('#sm').onclick();assert.equal(h.root.commonMaster.products.length,0);h.root.commonMaster.products.push({id:'other',code:'00123456789'});h.get('#mc').value='00123456789';h.get('#sm').onclick();assert.equal(h.root.commonMaster.products.length,1);assert.equal(h.effects.alerts.length,2);
});
test('ordinary vendor management still closes on save and app/SW patch versions agree',()=>{
  const h=harness();h.context.vendorDialog();h.get('#vn').value='通常';h.get('#sv').onclick();assert.equal(h.dialog.open,false);assert.match(source,/const APP_VERSION="1\.7\.1"/);assert.match(fs.readFileSync(require.resolve('../sw.js'),'utf8'),/infomart-order-nav-v1\.7\.1/);assert.equal(source.includes('1.7.0'),false);
});
