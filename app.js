(() => {
"use strict";

const SCHEMA_VERSION=3;
const APP_VERSION="1.5.0";
const ROOT_KEY="infomartOrderNav.root.v3";
const OLD_ROOT_KEY="infomartOrderNav.multiuser.v2";
const LEGACY_KEY="infomartOrderNav.web.v1";
const SNAP_KEY="infomartOrderNav.snapshots.v3";
const PFX="IFM1:";
const RECEIPT_PFX="IFMR1:";
const PAYLOAD_TTL_MS=60*60*1000;
const RECEIPT_TTL_MS=24*60*60*1000;
const OPEN_DATE_SEARCH_DAYS=366;
const DEFAULT_URL="https://www2.infomart.co.jp/mypage/mypage_fb.page?93&IMReferer=/scripts/mode.page";
const IDLE_MS=15*60*1000;
const ADMIN_SESSION_MS=10*60*1000;
const DAYS=[{v:1,l:"月"},{v:2,l:"火"},{v:3,l:"水"},{v:4,l:"木"},{v:5,l:"金"},{v:6,l:"土"},{v:0,l:"日"}];
const TODAY_FILTER={status:"all",vendor:"all",query:""};
const PRESET_FILTER={query:"",sort:"recent"};

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const uid=()=>crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
const clone=x=>JSON.parse(JSON.stringify(x));
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function workspaceDefault(){
  return {
    settings:{infomartUrl:DEFAULT_URL},
    products:[],
    presets:[],
    history:[],
    canceled:[],
    pendingRun:null
  };
}
function rootDefault(){
  return {
    schemaVersion:SCHEMA_VERSION,
    appVersion:APP_VERSION,
    masterVersion:1,
    commonMaster:{vendors:[],products:[]},
    profiles:[],
    activeProfileId:null,
    admin:{pinHash:null},
    lastExportAt:null,
    lastMasterExportAt:null
  };
}
function normalizeWorkspace(x){
  x=x&&typeof x==="object"?x:{};
  return {
    ...workspaceDefault(),
    ...x,
    settings:{...workspaceDefault().settings,...(x.settings||{})},
    products:Array.isArray(x.products)?x.products:[],
    presets:Array.isArray(x.presets)?x.presets:[],
    history:Array.isArray(x.history)?x.history:[],
    canceled:Array.isArray(x.canceled)?x.canceled:[],
    pendingRun:x.pendingRun||null
  };
}
function newProfile(name,data){
  const now=new Date().toISOString();
  return {id:uid(),name,createdAt:now,updatedAt:now,data:normalizeWorkspace(data)};
}
function masterProductFromProduct(p){
  return {
    id:p.id||uid(),
    code:String(p.code||"").trim(),
    name:p.domSource?p.domSource.name:p.imageSource?String(p.name||""):String(p.name||"").trim(),
    ...(p.domSource?{domSource:clone(p.domSource)}:{}),
    ...(p.imageSource?{imageSource:p.imageSource,codeAuthority:p.codeAuthority}:{}),
    ...Object.fromEntries(['specification','vendorDisplay','screenshotSource','domSyncStatus','screenshotReviewBeforeDom','domMatchedAt'].filter(k=>p[k]!==undefined).map(k=>[k,clone(p[k])])),
    vendorId:p.vendorId||"",
    leadDaysOverride:Number.isFinite(+p.leadDaysOverride)?+p.leadDaysOverride:null,
    scheduleClass:String(p.scheduleClass||"standard"),
    allowDecimalQty:p.allowDecimalQty===true
  };
}
function personalProductFromMaster(mp,old=null){
  return {
    id:mp.id,
    code:mp.code,
    name:mp.name,
    ...(mp.domSource?{domSource:clone(mp.domSource)}:{}),
    ...(mp.imageSource?{imageSource:mp.imageSource,codeAuthority:mp.codeAuthority}:{}),
    ...Object.fromEntries(['specification','vendorDisplay','screenshotSource','domSyncStatus','screenshotReviewBeforeDom','domMatchedAt'].filter(k=>mp[k]!==undefined).map(k=>[k,clone(mp[k])])),
    vendorId:mp.vendorId,
    leadDaysOverride:mp.leadDaysOverride,
    scheduleClass:String(mp.scheduleClass||old?.scheduleClass||"standard"),
    allowDecimalQty:mp.allowDecimalQty===true,
    defaultQty:old?.defaultQty??(mp.domSource||mp.imageSource?0:1),
    intervalMode:old?.intervalMode??"daily",
    intervalDays:Math.max(1,+old?.intervalDays||1),
    firstOrderDate:old?.firstOrderDate||iso(today()),
    active:old?old.active!==false:!(mp.domSource||mp.imageSource),
    confirmed:mp.imageSource&&!mp.domSource?false:old?.confirmed!==false,
    masterOrphan:false
  };
}
function migrateToV3(){
  let v2=null,legacy=null;
  try{v2=JSON.parse(localStorage.getItem(OLD_ROOT_KEY)||"null")}catch(_){}
  try{legacy=JSON.parse(localStorage.getItem(LEGACY_KEY)||"null")}catch(_){}

  if(v2?.profiles?.length){
    const r=rootDefault();
    const vendorMap=new Map();
    const productMap=new Map();
    const oldToNewByProfile=new Map();

    for(const pr of v2.profiles){
      const d=normalizeWorkspace(pr.data);
      const vm=new Map();
      for(const v of d.vendors||[]){
        const key=String(v.name||"").trim().toLowerCase()||v.id;
        if(!vendorMap.has(key)) vendorMap.set(key,{...clone(v),id:v.id||uid()});
        vm.set(v.id,vendorMap.get(key).id);
      }
      const pm=new Map();
      for(const p of d.products||[]){
        const code=String(p.code||"").trim();
        if(!code)continue;
        if(!productMap.has(code)){
          productMap.set(code,{
            id:p.id||uid(),code,name:p.name||"",
            vendorId:vm.get(p.vendorId)||p.vendorId||"",
            leadDaysOverride:Number.isFinite(+p.leadDaysOverride)?+p.leadDaysOverride:null
          });
        }
        pm.set(p.id,productMap.get(code).id);
      }
      oldToNewByProfile.set(pr.id,{vm,pm});
    }
    r.commonMaster.vendors=[...vendorMap.values()];
    r.commonMaster.products=[...productMap.values()];

    r.profiles=v2.profiles.map(pr=>{
      const d=normalizeWorkspace(pr.data),maps=oldToNewByProfile.get(pr.id);
      const oldByCode=new Map((d.products||[]).map(p=>[String(p.code||"").trim(),p]));
      const products=r.commonMaster.products.map(mp=>personalProductFromMaster(mp,oldByCode.get(mp.code)));
      const presets=(d.presets||[]).map(x=>({...x,items:(x.items||[]).map(i=>({...i,productId:maps.pm.get(i.productId)||i.productId}))}));
      const rewriteKey=k=>{
        if(typeof k!=="string"||!k.includes("|"))return k;
        const [pid,...rest]=k.split("|");return [maps.pm.get(pid)||pid,...rest].join("|");
      };
      return {
        id:pr.id||uid(),name:pr.name||"利用者",createdAt:pr.createdAt||new Date().toISOString(),
        updatedAt:pr.updatedAt||new Date().toISOString(),
        data:{...workspaceDefault(),settings:d.settings,products,presets,
          history:(d.history||[]).map(h=>({...h,key:rewriteKey(h.key)})),
          canceled:(d.canceled||[]).map(rewriteKey),pendingRun:null}
      };
    });
    r.activeProfileId=v2.activeProfileId&&r.profiles.some(p=>p.id===v2.activeProfileId)?v2.activeProfileId:r.profiles[0].id;
    r.lastExportAt=v2.lastExportAt||null;
    return r;
  }

  const r=rootDefault();
  const d=normalizeWorkspace(legacy);
  r.commonMaster.vendors=clone(d.vendors||[]);
  r.commonMaster.products=(d.products||[]).map(masterProductFromProduct);
  const profileData={...workspaceDefault(),settings:d.settings,
    products:r.commonMaster.products.map(mp=>personalProductFromMaster(mp,(d.products||[]).find(p=>p.code===mp.code))),
    presets:d.presets||[],history:d.history||[],canceled:d.canceled||[],pendingRun:null};
  const p=newProfile("利用者1",profileData);
  r.profiles=[p];r.activeProfileId=p.id;
  return r;
}

function normalizeVendor(v){
  const x={...(v||{})};
  if(!Array.isArray(x.deliveryWeekdays))x.deliveryWeekdays=[];
  if(!Array.isArray(x.orderClosedWeekdays))x.orderClosedWeekdays=[];
  if(!Array.isArray(x.orderClosedDates))x.orderClosedDates=[];
  if(!Array.isArray(x.deliveryClosedDates))x.deliveryClosedDates=[];
  if(!Array.isArray(x.scheduleEntries))x.scheduleEntries=[];
  if(!x.scheduleMode)x.scheduleMode="rule";
  if(!x.orderHolidayRule){
    if(x.orderAvoidHolidays===true)x.orderHolidayRule="blocked";
    else if(x.orderAvoidHolidays===false)x.orderHolidayRule="allowed";
    else x.orderHolidayRule="unknown";
  }
  if(!x.deliveryHolidayRule){
    if(x.deliveryAvoidHolidays===true)x.deliveryHolidayRule="blocked";
    else if(x.deliveryAvoidHolidays===false)x.deliveryHolidayRule="allowed";
    else x.deliveryHolidayRule="unknown";
  }
  return x;
}
function vendorReady(v){
  if(!v||!v.calendarConfirmed)return false;
  if(v.scheduleMode!=="dated"&&!(v.deliveryWeekdays||[]).length)return false;
  if(v.orderHolidayRule==="unknown"||v.deliveryHolidayRule==="unknown")return false;
  return true;
}

function loadRoot(){
  try{
    const r=JSON.parse(localStorage.getItem(ROOT_KEY)||"null");
    if(r?.schemaVersion===SCHEMA_VERSION&&r?.profiles?.length){
      r.profiles=r.profiles.map(p=>({...p,data:normalizeWorkspace(p.data)}));
      r.commonMaster=r.commonMaster||{vendors:[],products:[]};
      r.commonMaster.vendors=Array.isArray(r.commonMaster.vendors)?r.commonMaster.vendors.map(normalizeVendor):[];
      r.commonMaster.products=Array.isArray(r.commonMaster.products)?r.commonMaster.products:[];
      if(!r.profiles.some(p=>p.id===r.activeProfileId))r.activeProfileId=r.profiles[0].id;
      r.admin=r.admin||{pinHash:null};
      return r;
    }
  }catch(_){}
  return migrateToV3();
}

let ROOT=loadRoot();
ROOT.commonMaster.vendors=(ROOT.commonMaster.vendors||[]).map(normalizeVendor);
let ACTIVE_ID=ROOT.activeProfileId;
let S=activeProfile().data;
let view="home";
let healthReturn=false;
let ADMIN_UNTIL=0;
let BUNDLED_INITIAL_MASTER=null;
let lastActivity=Date.now();

function activeProfile(){return ROOT.profiles.find(p=>p.id===ACTIVE_ID)||ROOT.profiles[0]}
function V(id){return ROOT.commonMaster.vendors.find(x=>x.id===id)}
function MP(id){return ROOT.commonMaster.products.find(x=>x.id===id)}
function P(id){return S.products.find(x=>x.id===id)}
function persistRoot(){ROOT.activeProfileId=ACTIVE_ID;ROOT.schemaVersion=SCHEMA_VERSION;ROOT.appVersion=APP_VERSION;localStorage.setItem(ROOT_KEY,JSON.stringify(ROOT))}
function save(reason="変更を保存"){activeProfile().data=S;activeProfile().updatedAt=new Date().toISOString();persistRoot();autoSnapshot(reason,false);render()}
function switchProfile(id){const p=ROOT.profiles.find(x=>x.id===id);if(!p)return;healthReturn=false;ACTIVE_ID=id;S=p.data;ROOT.activeProfileId=id;persistRoot();view="home";render()}
function adminActive(){return Date.now()<ADMIN_UNTIL}
async function sha256(text){const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest("SHA-256",data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function requireAdmin(reason="共通マスターを変更"){
  if(adminActive())return true;
  if(!ROOT.admin.pinHash){
    const a=prompt("管理者PINを初回設定します。4文字以上で入力してください。");
    if(!a||a.length<4){alert("4文字以上のPINを設定してください。");return false}
    const b=prompt("確認のため同じPINをもう一度入力してください。");
    if(a!==b){alert("PINが一致しません。");return false}
    ROOT.admin.pinHash=await sha256(a);persistRoot();ADMIN_UNTIL=Date.now()+ADMIN_SESSION_MS;render();alert("管理者PINを設定しました。");return true;
  }
  const p=prompt(`${reason}\n管理者PINを入力してください。`);
  if(!p)return false;
  if(await sha256(p)!==ROOT.admin.pinHash){alert("PINが違います。");return false}
  ADMIN_UNTIL=Date.now()+ADMIN_SESSION_MS;render();return true;
}
function logoutAdmin(){ADMIN_UNTIL=0;render()}

function getSnapshots(){try{return JSON.parse(localStorage.getItem(SNAP_KEY)||"[]")}catch{return[]}}
function autoSnapshot(reason="自動保存",force=false){
  try{
    let list=getSnapshots(),now=Date.now(),last=list[0]?.time||0;
    if(!force&&now-last<10*60*1000)return;
    list.unshift({id:uid(),time:now,at:new Date(now).toISOString(),reason,data:JSON.stringify(ROOT)});
    localStorage.setItem(SNAP_KEY,JSON.stringify(list.slice(0,12)));
  }catch(_){}
}
function checkpoint(reason){autoSnapshot(reason,true)}

function syncMasterToProfiles(persist=true){
  const master=ROOT.commonMaster;
  for(const pr of ROOT.profiles){
    const d=pr.data,oldByCode=new Map((d.products||[]).map(p=>[String(p.code||"").trim(),p]));
    const oldIdToNew=new Map();
    const synced=master.products.map(mp=>{
      const old=oldByCode.get(mp.code); if(old)oldIdToNew.set(old.id,mp.id);
      return personalProductFromMaster(mp,old);
    });
    // Keep removed master products as inactive orphans to avoid silent data loss.
    for(const old of d.products||[]){
      if(!master.products.some(mp=>mp.code===old.code)){
        synced.push({...old,active:false,confirmed:false,masterOrphan:true});
      }
    }
    d.products=synced;
    d.presets=(d.presets||[]).map(prs=>({...prs,items:(prs.items||[]).map(i=>({...i,productId:oldIdToNew.get(i.productId)||i.productId}))}));
    const rewrite=k=>{
      if(typeof k!=="string"||!k.includes("|"))return k;
      const [pid,...rest]=k.split("|");return [oldIdToNew.get(pid)||pid,...rest].join("|");
    };
    d.history=(d.history||[]).map(h=>({...h,key:rewrite(h.key)}));
    d.canceled=(d.canceled||[]).map(rewrite);
  }
  S=activeProfile().data;
  if(persist)persistRoot();
}
function captureMasterFromActive(){
  ROOT.commonMaster.vendors=clone(ROOT.commonMaster.vendors);
  ROOT.commonMaster.products=(S.products||[]).filter(p=>!p.masterOrphan).map(masterProductFromProduct);
  ROOT.masterVersion=(ROOT.masterVersion||0)+1;
  syncMasterToProfiles();
}
function commonMasterPackage(){
  return {
    type:"infomartOrderNav.initialMaster",
    schemaVersion:SCHEMA_VERSION,
    masterVersion:ROOT.masterVersion||1,
    createdAt:new Date().toISOString(),
    vendors:clone(ROOT.commonMaster.vendors),
    products:clone(ROOT.commonMaster.products)
  };
}
function validIsoDateString(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||"")))return false;
  const d=parseDate(s);return d instanceof Date&&!Number.isNaN(d.getTime())&&iso(d)===s;
}
function validateMasterPackage(pkg){
  if(!pkg||pkg.type!=="infomartOrderNav.initialMaster")throw new Error("共通マスターJSONではありません");
  if(pkg.schemaVersion!==SCHEMA_VERSION)throw new Error(`マスターのschemaVersionが違います（必要 ${SCHEMA_VERSION}）`);
  if(!Array.isArray(pkg.vendors)||!Array.isArray(pkg.products))throw new Error("マスター形式が違います");
  if(pkg.vendors.length>500||pkg.products.length>10000)throw new Error("マスター件数が上限を超えています");
  const vendors=pkg.vendors.map(normalizeVendor),vids=new Set(),vnames=new Set();
  for(const v of vendors){
    if(!v.id||typeof v.id!=="string"||vids.has(v.id))throw new Error("発注先IDが空または重複しています");
    vids.add(v.id);
    const nm=String(v.name||"").trim();if(!nm)throw new Error("発注先名が空です");
    const nk=nm.toLowerCase();if(vnames.has(nk))throw new Error(`発注先名が重複しています：${nm}`);vnames.add(nk);
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v.cutoff||"")))throw new Error(`${nm} の締切時刻が不正です`);
    if(!Number.isFinite(+v.minDeliveryDays)||+v.minDeliveryDays<0||+v.minDeliveryDays>60)throw new Error(`${nm} の最短納品日数が不正です`);
    for(const [label,a] of [["納品曜日",v.deliveryWeekdays],["発注不可曜日",v.orderClosedWeekdays]]){
      if(!Array.isArray(a)||a.some(x=>!Number.isInteger(+x)||+x<0||+x>6)||new Set(a.map(Number)).size!==a.length)throw new Error(`${nm} の${label}が不正です`);
    }
    for(const [label,a] of [["発注休業日",v.orderClosedDates],["納品休業日",v.deliveryClosedDates]]){
      if(!Array.isArray(a)||a.some(x=>!validIsoDateString(x)))throw new Error(`${nm} の${label}が不正です`);
    }
    if(!["unknown","allowed","blocked"].includes(v.orderHolidayRule)||!["unknown","allowed","blocked"].includes(v.deliveryHolidayRule))throw new Error(`${nm} の祝日ルールが不正です`);
    if(!["rule","dated"].includes(v.scheduleMode))throw new Error(`${nm} のスケジュール方式が不正です`);
    const seenSchedule=new Set();
    for(const x of v.scheduleEntries||[]){
      const cls=String(x.classKey||"standard"),key=`${cls}|${x.orderDate}`;
      if(!validIsoDateString(x.orderDate)||!validIsoDateString(x.deliveryDate)||x.deliveryDate<x.orderDate)throw new Error(`${nm} の紙スケジュール日付が不正です`);
      if(seenSchedule.has(key))throw new Error(`${nm} の紙スケジュールが重複しています：${key}`);seenSchedule.add(key);
    }
  }
  const products=pkg.products.map(p=>({...clone(p),allowDecimalQty:p.allowDecimalQty===true})),codes=new Set(),pids=new Set();
  for(const p of products){
    if(!p.id||typeof p.id!=="string"||pids.has(p.id))throw new Error("商品IDが空または重複しています");pids.add(p.id);
    const code=String(p.code||"").trim();
    if(!/^\d{7,13}$/.test(code))throw new Error(`商品コードが不正です：${code||"(空)"}`);
    if(codes.has(code))throw new Error(`商品コードが重複しています：${code}`);codes.add(code);
    if(!vids.has(p.vendorId))throw new Error(`商品 ${code} の発注先が存在しません`);
    if(p.leadDaysOverride!==null&&p.leadDaysOverride!==undefined&&(!Number.isFinite(+p.leadDaysOverride)||+p.leadDaysOverride<0||+p.leadDaysOverride>60))throw new Error(`商品 ${code} の最短納品日数が不正です`);
    if(p.domSource){validateDomRow(p.domSource);if(String(p.domSource.code)!==code)throw new Error(`商品 ${code} のDOMコードが一致しません`)}
  }
  return {vendors,products};
}
function applyMasterPackage(pkg,{reason="共通マスター更新"}={}){
  const checked=validateMasterPackage(pkg);
  checkpoint(reason+"前");
  ROOT.commonMaster={vendors:clone(checked.vendors),products:clone(checked.products)};
  ROOT.masterVersion=+pkg.masterVersion||((ROOT.masterVersion||0)+1);
  syncMasterToProfiles();
  save(reason);
}

function today(){let d=new Date();d.setHours(12,0,0,0);return d}
function iso(d){return d.toISOString().slice(0,10)}
function parseDate(s){let[y,m,d]=String(s).split("-").map(Number);return new Date(y,m-1,d,12)}
function add(d,n){let x=new Date(d);x.setDate(x.getDate()+n);return x}
function fmt(d){return d instanceof Date&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",weekday:"short"}).format(d):"計算停止"}
function fmtF(d){return d instanceof Date&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"numeric",day:"numeric",weekday:"short"}).format(d):"計算停止"}
function nowMin(){let d=new Date();return d.getHours()*60+d.getMinutes()}
function hm(s){let[h,m]=String(s||"00:00").split(":").map(Number);return h*60+m}
function intLabel(p){return p.intervalMode==="daily"?"毎日":`${Math.max(1,+p.intervalDays||1)}日ごと`}
function lead(p){return Number.isFinite(+p.leadDaysOverride)?+p.leadDaysOverride:+(V(p.vendorId)?.minDeliveryDays??3)}

function nthMondayDay(y,m,n){
  const x=new Date(y,m-1,1,12);while(x.getDay()!==1)x.setDate(x.getDate()+1);x.setDate(x.getDate()+7*(n-1));return x.getDate();
}
function baseHolidayName(y,m,day){
  const k=`${m}/${day}`;
  const fixed={"1/1":"元日","2/11":"建国記念の日","2/23":"天皇誕生日","4/29":"昭和の日","5/3":"憲法記念の日","5/4":"みどりの日","5/5":"こどもの日","11/3":"文化の日","11/23":"勤労感謝の日"};
  if(fixed[k])return fixed[k];
  if(y===2019&&m===5&&day===1)return"天皇の即位の日";
  if(y===2019&&m===10&&day===22)return"即位礼正殿の儀";
  if(y===2020){
    if(m===7&&day===23)return"海の日";if(m===7&&day===24)return"スポーツの日";if(m===8&&day===10)return"山の日";
  }else if(y===2021){
    if(m===7&&day===22)return"海の日";if(m===7&&day===23)return"スポーツの日";if(m===8&&day===8)return"山の日";
  }else{
    if(m===7&&day===nthMondayDay(y,7,3))return"海の日";
    if(m===8&&day===11)return"山の日";
    if(m===10&&day===nthMondayDay(y,10,2))return"スポーツの日";
  }
  if(m===1&&day===nthMondayDay(y,1,2))return"成人の日";
  if(m===9&&day===nthMondayDay(y,9,3))return"敬老の日";
  const ve=Math.floor(20.8431+.242194*(y-1980)-Math.floor((y-1980)/4));
  const ae=Math.floor(23.2488+.242194*(y-1980)-Math.floor((y-1980)/4));
  if(m===3&&day===ve)return"春分の日";if(m===9&&day===ae)return"秋分の日";
  return null;
}
const HOLIDAY_CACHE=new Map();
function holidayMapForYear(y){
  if(HOLIDAY_CACHE.has(y))return HOLIDAY_CACHE.get(y);
  const map=new Map(),key=d=>iso(d);
  for(let m=1;m<=12;m++)for(let day=1;day<=31;day++){
    const d=new Date(y,m-1,day,12);if(d.getMonth()!==m-1)continue;
    const name=baseHolidayName(y,m,day);if(name)map.set(key(d),name);
  }
  // 国民の休日：祝日に挟まれた日を休日化。
  for(let d=new Date(y,0,2,12);d.getFullYear()===y;d=add(d,1)){
    const k=key(d);if(map.has(k))continue;
    const prev=key(add(d,-1)),next=key(add(d,1));
    if(map.has(prev)&&map.has(next))map.set(k,"国民の休日");
  }
  // 振替休日：日曜の祝日の後、最初の祝日でない日を休日化（現行法の連続振替に対応）。
  const originals=[...map.entries()].map(([k,name])=>({d:parseDate(k),name}));
  for(const h of originals){
    if(h.d.getDay()!==0)continue;
    let x=add(h.d,1),guard=0;while(map.has(key(x))&&guard++<10)x=add(x,1);
    if(x.getFullYear()===y)map.set(key(x),"振替休日");
  }
  HOLIDAY_CACHE.set(y,map);return map;
}
function holiday(d){
  if(!(d instanceof Date)||Number.isNaN(d.getTime()))return null;
  const y=d.getFullYear();
  if(y<1980||y>2099)return"休日カレンダー範囲外";
  return holidayMapForYear(y).get(iso(d))||null;
}
function orderOpen(d,v){if(!d||!v||v.orderHolidayRule==="unknown")return false;if((v.orderClosedWeekdays||[]).includes(d.getDay()))return false;if((v.orderClosedDates||[]).includes(iso(d)))return false;if(v.orderHolidayRule==="blocked"&&holiday(d))return false;return true}
function deliveryOpen(d,v){if(!d||!v||v.deliveryHolidayRule==="unknown")return false;let a=v.deliveryWeekdays||[];if(!a.length||!a.includes(d.getDay()))return false;if((v.deliveryClosedDates||[]).includes(iso(d)))return false;if(v.deliveryHolidayRule==="blocked"&&holiday(d))return false;return true}
function nextOrder(d,v){let x=new Date(d);for(let i=0;i<OPEN_DATE_SEARCH_DAYS;i++){if(orderOpen(x,v))return x;x=add(x,1)}return null}
function prevOrder(d,v){let x=new Date(d);for(let i=0;i<OPEN_DATE_SEARCH_DAYS;i++){if(orderOpen(x,v))return x;x=add(x,-1)}return null}
function nextDelivery(d,v){let x=new Date(d);for(let i=0;i<OPEN_DATE_SEARCH_DAYS;i++){if(deliveryOpen(x,v))return x;x=add(x,1)}return null}
function acceptance(v){let d=today();if(nowMin()>hm(v.cutoff||"13:30"))d=add(d,1);return nextOrder(d,v)}
function earliest(order,p,v){if(!order)return null;return nextDelivery(add(order,lead(p)),v)}
function scheduleEntriesFor(v,p){
  if(!v||v.scheduleMode!=="dated"||!Array.isArray(v.scheduleEntries))return[];
  const cls=String(p?.scheduleClass||"standard");
  let list=v.scheduleEntries.filter(x=>String(x.classKey||"standard")===cls);
  if(!list.length&&cls!=="standard")list=v.scheduleEntries.filter(x=>String(x.classKey||"standard")==="standard");
  return list.slice().sort((a,b)=>String(a.orderDate).localeCompare(String(b.orderDate)));
}
function exactScheduleEntry(orderDate,p,v){
  const key=iso(orderDate);
  return scheduleEntriesFor(v,p).find(x=>x.orderDate===key)||null;
}
function nearestScheduleEntries(orderDate,p,v){
  const key=iso(orderDate),list=scheduleEntriesFor(v,p);let prev=null,next=null;
  for(const x of list){if(x.orderDate<key)prev=x;if(x.orderDate>key){next=x;break}}
  return{prev,next};
}
function scheduleMismatch(orderDate,p,v){
  return Boolean(v?.scheduleMode==="dated"&&(v.scheduleEntries||[]).length&&!exactScheduleEntry(orderDate,p,v));
}
function nextDatedScheduleAfter(date,p,v){
  if(!date)return null;const key=iso(date);return scheduleEntriesFor(v,p).find(x=>x.orderDate>=key)||null;
}
function scheduleClassLabel(k){return k==="standard"?"通常":String(k||"通常")}
function vendorScheduleSummary(v){return v?.scheduleMode==="dated"?`紙スケジュール ${(v.scheduleEntries||[]).length}件`:"通常ルール"}

function firstOnOrAfter(p,target){let first=parseDate(p.firstOrderDate||iso(today())),step=p.intervalMode==="daily"?1:Math.max(1,+p.intervalDays||1);if(target<=first)return first;let delta=Math.floor((target-first)/86400000),j=Math.ceil(delta/step);return add(first,j*step)}

function entries(){
  let out=[],start=add(today(),-45),end=add(today(),60);
  for(let p of S.products.filter(p=>p.active!==false&&p.confirmed!==false&&!p.masterOrphan)){
    let v=V(p.vendorId);if(!v||!vendorReady(v))continue;
    let d=firstOnOrAfter(p,start),step=p.intervalMode==="daily"?1:Math.max(1,+p.intervalDays||1);
    while(d<=end){
      let key=`${p.id}|${iso(d)}`,exact=exactScheduleEntry(d,p,v),mismatch=scheduleMismatch(d,p,v),due,delivery;
      if(v.scheduleMode==="dated"&&(v.scheduleEntries||[]).length){
        due=new Date(d);
        delivery=exact?parseDate(exact.deliveryDate):earliest(d,p,v);
      }else{
        due=orderOpen(d,v)?d:prevOrder(d,v);
        delivery=earliest(d,p,v);
      }
      const safetyIssue=!due?`発注可能日が${OPEN_DATE_SEARCH_DAYS}日以内に見つかりません`:!delivery?`納品可能日が${OPEN_DATE_SEARCH_DAYS}日以内に見つかりません`:null;
      if(!S.history.some(h=>h.key===key)&&!S.canceled.includes(key)){
        out.push({key,p,v,scheduled:new Date(d),due,delivery,safetyIssue,scheduleExact:exact,scheduleMismatch:mismatch,scheduleSuggestion:mismatch?nearestScheduleEntries(d,p,v):null});
      }
      d=add(d,step)
    }
  }
  const ts=d=>d instanceof Date&&!Number.isNaN(d.getTime())?d.getTime():Number.MAX_SAFE_INTEGER;
  return out.sort((a,b)=>ts(a.due)-ts(b.due)||ts(a.delivery)-ts(b.delivery))
}
function classify(){
  let t=today(),n=nowMin(),attention=[],overdue=[],due=[],upcoming=[];
  for(let e of entries()){
    if(e.safetyIssue){attention.push({...e,issue:`安全停止：${e.safetyIssue}`,earliest:null});continue}
    const accepted=acceptance(e.v);
    if(!accepted){attention.push({...e,issue:`安全停止：発注可能日が${OPEN_DATE_SEARCH_DAYS}日以内に見つかりません`,earliest:null});continue}
    let late=e.due<t||(iso(e.due)===iso(t)&&n>hm(e.v.cutoff||"13:30"));
    let scheduleIssue=e.scheduleMismatch;
    let genericDeliveryIssue=e.v.scheduleMode==="dated"?false:!deliveryOpen(e.delivery,e.v);
    let ea;
    if(e.v.scheduleMode==="dated"){
      const next=nextDatedScheduleAfter(accepted,e.p,e.v);
      ea=next?parseDate(next.deliveryDate):earliest(accepted,e.p,e.v);
    }else ea=earliest(accepted,e.p,e.v);
    if(!ea){attention.push({...e,issue:`安全停止：最短納品日が${OPEN_DATE_SEARCH_DAYS}日以内に見つかりません`,earliest:null});continue}
    let impossible=late&&e.delivery<ea;
    if(scheduleIssue||genericDeliveryIssue||impossible){
      let issue=scheduleIssue?"この発注日が紙スケジュール表にありません":genericDeliveryIssue?"納品不可日":"締切超過で予定納品日に間に合いません";
      attention.push({...e,issue,earliest:ea});
    }else if(late)overdue.push(e);
    else if(iso(e.due)===iso(t))due.push(e);
    else upcoming.push(e)
  }
  return{attention,overdue,due,upcoming}
}

function integrityCheck(){
  const issues=[],warn=[],findings=[];
  let target={kind:"products"};
  const issue=text=>{issues.push(text);findings.push({status:"NG",text,target:{...target}})};
  const warning=text=>{warn.push(text);findings.push({status:"注意",text,target:{...target}})};
  const codes=new Map();
  for(const p of ROOT.commonMaster.products){
    target={kind:"product",id:p.id};
    if(!p.code)issue("商品コードが空の商品があります");
    if(p.domSource){try{validateDomRow(p.domSource);if(p.code!==p.domSource.code)throw Error("コード不一致")}catch(err){issue(`商品 ${p.code} のDOM照合エラー：${err.message}`)}}
    if(p.imageSource)warning(`商品 ${p.code} は画像由来・DOM未確認です。自動入力は停止。共通マスターから削除後、DOM経路で登録し直してください。`);
    if(p.code){codes.set(p.code,(codes.get(p.code)||0)+1)}
    if(!V(p.vendorId))issue(`商品 ${p.code||p.name||"(不明)"} の発注先が未設定です`);
  }
  for(const [code,n] of codes)if(n>1){for(const p of ROOT.commonMaster.products.filter(p=>p.code===code)){target={kind:"product",id:p.id};issue(`商品コード ${code} が${n}件重複しています（${p.name||"名称なし"}）`)}}
  for(const v of ROOT.commonMaster.vendors){
    target={kind:"vendor",id:v.id};
    if(!v.name)issue("名称が空の発注先があります");
    if(!v.cutoff)issue(`${v.name||"発注先"} の締切時刻が未設定です`);
    if(!Number.isFinite(+v.minDeliveryDays))issue(`${v.name||"発注先"} の最短納品日数が未設定です`);
    if((v.orderClosedWeekdays||[]).length>=7)issue(`${v.name||"発注先"} は全曜日が発注不可になっています`);
    if(v.scheduleMode!=="dated"&&!(v.deliveryWeekdays||[]).length)issue(`${v.name||"発注先"} の納品可能曜日が未確認です`);
    if(v.orderHolidayRule==="unknown")issue(`${v.name||"発注先"} の祝日発注可否が未確認です`);
    if(v.deliveryHolidayRule==="unknown")issue(`${v.name||"発注先"} の祝日納品可否が未確認です`);
    if(!v.calendarConfirmed)warning(`${v.name||"発注先"} のInfomart納品日カレンダー確認が未完了です`);
    if(v.scheduleMode==="dated"){
      target={kind:"paper",id:v.id};
      if(!(v.scheduleEntries||[]).length)issue(`${v.name||"発注先"} は紙スケジュール方式ですが日付データがありません`);
      else{
        const future=(v.scheduleEntries||[]).filter(x=>x.orderDate>=iso(today())).sort((a,b)=>a.orderDate.localeCompare(b.orderDate));
        if(!future.length)warning(`${v.name||"発注先"} の紙スケジュールに今後の日付がありません`);
        else{
          const days=Math.round((parseDate(future[future.length-1].orderDate)-today())/86400000);
          if(days<=14)warning(`${v.name||"発注先"} の紙スケジュール残り期間が${days}日です`);
        }
      }
    }
  }
  const validIds=new Set(S.products.map(p=>p.id));
  for(const pr of S.presets){
    target={kind:"preset",id:pr.id};
    for(const it of pr.items||[])if(!validIds.has(it.productId))issue(`プリセット「${pr.name}」に削除済み商品があります`);
    for(const it of pr.items||[])if(+it.qty<0)issue(`プリセット「${pr.name}」に不正な数量があります`);
  }
  target={kind:"backup"};
  if(!ROOT.lastExportAt)warning("外部JSONバックアップがまだ作成されていません");
  return{issues:[...new Set(issues)],warnings:[...new Set(warn)],findings};
}
function healthStatus(){
  const i=integrityCheck(),snap=getSnapshots();
  return [
    {label:"共通商品マスター",status:i.issues.length?"NG":"OK",detail:i.issues.length?`${i.issues.length}件の問題`:`${ROOT.commonMaster.products.length}商品`},
    {label:"発注先ルール",status:ROOT.commonMaster.vendors.some(v=>!vendorReady(v))?"注意":"OK",detail:`${ROOT.commonMaster.vendors.length}件`},
    {label:"利用者プロフィール",status:ROOT.profiles.length?"OK":"NG",detail:`${ROOT.profiles.length}人`},
    {label:"個人プリセット",status:"OK",detail:`${S.presets.length}件`},
    {label:"復元ポイント",status:snap.length?"OK":"注意",detail:`${snap.length}件`},
    {label:"外部バックアップ",status:ROOT.lastExportAt?"OK":"注意",detail:ROOT.lastExportAt?new Date(ROOT.lastExportAt).toLocaleString("ja-JP"):"未作成"},
    {label:"Infomart DOM契約",status:"OK",detail:"v1.1 実DOM固定・実行時自己診断"},
    {label:"数量再照合",status:"OK",detail:"入力直後の実値一致を必須化"},
    {label:"紙スケジュールOCR",status:ROOT.commonMaster.vendors.some(v=>v.scheduleMode==="dated"&&!(v.scheduleEntries||[]).length)?"注意":"OK",detail:`${ROOT.commonMaster.vendors.filter(v=>v.scheduleMode==="dated").length}発注先で使用`}
  ];
}

function countdownInfo(){
  const c=classify(),list=[...c.due,...c.overdue].filter(e=>iso(e.due)===iso(today()));
  if(!list.length)return null;
  const mins=list.map(e=>hm(e.v.cutoff)-nowMin()).sort((a,b)=>a-b)[0];
  let cls="yellow",label="";
  if(mins<0){cls="red";label=`締切を ${Math.abs(mins)}分 超過`}
  else if(mins<=30){cls="red";label=`締切まで ${mins}分`}
  else if(mins<=60){cls="orange";label=`締切まで ${mins}分`}
  else label=`締切まで ${Math.floor(mins/60)}時間${mins%60}分`;
  return{cls,label}
}

function nextCard(t,k,title,detail,btn,target){return `<section class="card next ${t}"><div class="kicker">${esc(k)}</div><div class="big">${esc(title)}</div><div class="muted">${esc(detail)}</div><div style="height:12px"></div><button class="btn full" data-nav="${target}">${esc(btn)} →</button></section>`}
function nextAction(c){
  const integ=integrityCheck();
  if(integ.issues.length)return nextCard("red","システム確認","設定に問題があります",`${integ.issues.length}件あります。発注前にシステムチェックを行ってください。`,"システムチェック","health");
  if(S.pendingRun)return nextCard("blue","次にすること","Infomartの発注結果を記録してください","発注が完了したら「発注済み」、まだなら「まだ発注していない」を選びます。","発注結果を記録","home");
  if(!ROOT.commonMaster.vendors.length)return nextCard("blue","次にすること","まず発注先を登録してください","管理者が締切・最短納品・納品可能曜日を登録します。","管理者設定","vendors");
  if(ROOT.commonMaster.vendors.some(v=>!vendorReady(v)))return nextCard("orange","安全確認","発注先ルールを確認してください","納品可能曜日・祝日の扱い・Infomart納品日カレンダーを確認するまで発注予定は自動生成しません。","発注先を確認","vendors");
  if(!ROOT.commonMaster.products.length)return nextCard("blue","次にすること","共通商品マスターを登録してください","管理者が商品コード・商品名・発注先を登録します。","商品を登録","products");
  if(c.attention.length)return nextCard("orange","次にすること","納品日・締切の要対応があります",`${c.attention.length}件あります。最短納品日を確認してください。`,"要対応を確認","today");
  if(c.overdue.length)return nextCard("red","最優先","発注漏れ候補があります",`${c.overdue.length}件あります。`,"発注漏れを確認","today");
  if(c.due.length)return nextCard("blue","今日の作業",`今日の発注は${c.due.length}件です`,"数量は自動入力。納品日と最終確定だけ本人が確認します。","今日の発注を始める","today");
  if(c.upcoming.length)return nextCard("green","現在の状態","今日の発注は完了です",`次は ${fmtF(c.upcoming[0].due)} に発注予定です。`,"今後の予定を見る","today");
  return nextCard("green","現在の状態","発注予定はありません","商品・発注間隔を確認してください。","商品を見る","products")
}
function row(e){return `<div class="task"><div><strong>${esc(e.p.name||e.p.code)}</strong><br><span class="muted">発注 ${fmt(e.due)} ${esc(e.v.cutoff)} / 納品 ${fmt(e.delivery)} / ${esc(intLabel(e.p))}</span>${e.issue||e.safetyIssue?`<br><span class="error">${esc(e.issue||e.safetyIssue)}</span>`:""}</div><button class="btn secondary small" data-one="${esc(e.key)}">確認</button></div>`}
function section(title,list,tone){return list.length?`<div class="section">${esc(title)} <span class="badge ${tone}">${list.length}件</span></div><section class="card">${list.slice(0,8).map(row).join("")}</section>`:""}

function pendingVerifiedCount(r){
  const verified=r?.inputVerified||{};return (r?.items||[]).filter(i=>String(verified[i.code]??"")===String(i.qty)).length;
}
function pendingRunCard(){
  if(!S.pendingRun)return"";
  const r=S.pendingRun,verified=pendingVerifiedCount(r),all=verified===r.items.length,override=r.verificationOverride===true;
  return `<section class="card pending-run"><h3>Infomart発注の結果を記録</h3><p><strong>${esc(r.name)}</strong></p><p>${r.items.length}商品 / 開始 ${esc(new Date(r.startedAt).toLocaleString("ja-JP"))}</p>
    <div class="${all?"schedule-ok":override?"notice":"error"}">${all?`✓ 数量入力結果 ${verified}/${r.items.length}件を発注ナビで照合済み`:override?"管理者が手入力完了として確認済み":`数量入力結果 未確認 ${verified}/${r.items.length}件`}</div>
    ${!all&&!override?'<button class="btn full" id="pendingVerify" style="margin-top:8px">数量入力結果コードを確認</button><button class="btn secondary full" id="pendingOverride" style="margin-top:8px">手入力で完了した場合（管理者確認）</button>':""}
    <div class="grid2" style="margin-top:8px"><button class="btn green" id="pendingDone" ${all||override?"":"disabled"}>発注済みにする</button><button class="btn secondary" id="pendingClear">まだ発注していない</button></div></section>`
}
function homeMenu(){
  const items=[
    ["vendors","発","発注先を登録","取引先（発注先）の締切・納品ルールを登録・編集します。","blue"],
    ["products","商","商品・個人設定をする","商品情報と、利用者ごとの数量・発注間隔を設定します。","cyan"],
    ["presets","プ","プリセットを作る","よく使う発注内容をセットにして、すぐ呼び出せます。","lavender"],
    ["today","予","発注予定を確認する","今日・これからの発注、締切、納品日を確認します。","green"],
    ["history","履","発注履歴を見る","過去の発注や前年同月を確認し、今年用へコピーできます。","amber"],
    ["paper","紙","紙のスケジュールを登録","変則日程の発注期限・納品日を写真または手入力で登録します。","rose"],
    ["mobile","自","スマホ自動入力を使う","iPhone・AndroidでInfomartの数量欄へ安全に自動入力します。","cyan"],
    ["health","✓","システムチェックを見る","商品・発注先・バックアップなどの安全状態を確認します。","green"],
    ["backup","保","バックアップ・復元をする","発注ナビのデータを保存し、必要なときに復元します。","lavender"],
    ["admin","管","管理者設定を開く","共通マスターや管理者向け設定を変更します。","slate"]
  ];
  return `<section class="home-menu">
    <div class="home-menu-head">
      <div><div class="home-title">メニュー <span class="version-chip">v${APP_VERSION}</span></div><div class="home-subtitle">やりたいことを選んでください</div></div>
    </div>
    <div class="menu-grid">${items.map(([to,icon,label,desc,tone])=>`<button class="nav-card ${tone}" data-nav="${to}">
      <span class="nav-icon">${esc(icon)}</span><span class="nav-copy"><strong>${esc(label)}</strong><small>${esc(desc)}</small></span><span class="nav-arrow">›</span>
    </button>`).join("")}</div>
  </section>`;
}
function home(){
  let c=classify(),cd=countdownInfo();
  return `<section class="home-welcome"><div><div class="eyebrow-big">Infomart 発注ナビ</div><h2>やさしく、かんたんに発注業務をサポートします</h2><p>${esc(activeProfile().name)}さんの発注状況を確認して、次に必要な作業だけ進めます。</p></div></section>
    ${cd?`<div class="countdown ${cd.cls}"><div><strong>今日の締切</strong><br><span class="muted">最も近い締切</span></div><div class="time">${esc(cd.label)}</div></div>`:""}
    ${homeMenu()}${nextAction(c)}${pendingRunCard()}
    ${section("要対応",c.attention,"orange")}${section("発注漏れ注意",c.overdue,"red")}${section("今日の発注",c.due,"green")}
    ${c.upcoming.length?`<div class="section">これからの発注</div><section class="card">${c.upcoming.slice(0,5).map(row).join("")}</section>`:""}`;
}

function todayEntriesWithStatus(){
  const c=classify();
  return [
    ...c.attention.map(e=>({...e,uiStatus:"attention",uiLabel:"要確認"})),
    ...c.overdue.map(e=>({...e,uiStatus:"overdue",uiLabel:"締切超過"})),
    ...c.due.map(e=>({...e,uiStatus:"due",uiLabel:"今日"})),
    ...c.upcoming.map(e=>({...e,uiStatus:"upcoming",uiLabel:"予定"}))
  ];
}
function todayStatusBadge(e){
  const cls=e.uiStatus==="attention"?"orange":e.uiStatus==="overdue"?"red":e.uiStatus==="due"?"green":"";
  return `<span class="badge ${cls}">${esc(e.uiLabel)}</span>`;
}
function filteredTodayEntries(){
  const q=TODAY_FILTER.query.trim().toLowerCase();
  return todayEntriesWithStatus().filter(e=>{
    if(TODAY_FILTER.status!=="all"&&e.uiStatus!==TODAY_FILTER.status)return false;
    if(TODAY_FILTER.vendor!=="all"&&e.v.id!==TODAY_FILTER.vendor)return false;
    if(q){
      const hay=[e.p.code,e.p.name,e.v.name,e.issue,e.safetyIssue].map(x=>String(x||"").toLowerCase()).join(" ");
      if(!hay.includes(q))return false;
    }
    return true;
  });
}
function todayTableRow(e){
  const issue=e.issue||e.safetyIssue;
  return `<tr class="${issue?"order-row-warn":""}">
    <td>${todayStatusBadge(e)}</td>
    <td><strong>${esc(fmtF(e.due))}</strong><br><span class="table-sub">${esc(e.v.cutoff||"")}</span></td>
    <td>${esc(e.v.name||"")}</td>
    <td>${e.delivery?esc(fmtF(e.delivery)):"—"}</td>
    <td><strong>${esc(e.p.name||e.p.code)}</strong><br><span class="table-sub">${esc(e.p.code)} / ${esc(intLabel(e.p))}</span>${issue?`<div class="table-error">${esc(issue)}</div>`:""}</td>
    <td>${esc(e.p.defaultQty??0)}</td>
    <td><button class="btn secondary small" data-one="${esc(e.key)}">${e.uiStatus==="due"||e.uiStatus==="overdue"?"発注開始":"確認"}</button></td>
  </tr>`;
}
function todayMobileCard(e){
  const issue=e.issue||e.safetyIssue;
  return `<article class="order-mobile-card ${issue?"warn":""}">
    <div class="order-mobile-head">${todayStatusBadge(e)}<strong>${esc(e.v.name||"")}</strong></div>
    <div class="order-mobile-product">${esc(e.p.name||e.p.code)}</div>
    <div class="order-mobile-code">${esc(e.p.code)}</div>
    <div class="order-mobile-grid"><span>発注予定</span><strong>${esc(fmtF(e.due))} ${esc(e.v.cutoff||"")}</strong><span>納品予定</span><strong>${e.delivery?esc(fmtF(e.delivery)):"—"}</strong><span>数量</span><strong>${esc(e.p.defaultQty??0)}</strong></div>
    ${issue?`<div class="table-error">${esc(issue)}</div>`:""}
    <button class="btn ${e.uiStatus==="due"||e.uiStatus==="overdue"?"":"secondary"} full" data-one="${esc(e.key)}">${e.uiStatus==="due"||e.uiStatus==="overdue"?"発注開始":"内容を確認"}</button>
  </article>`;
}
function todayView(){
  const all=todayEntriesWithStatus(),rows=filteredTodayEntries(),c=classify();
  const vendors=[...new Map(all.map(e=>[e.v.id,e.v])).values()];
  return `<button class="btn secondary small" data-nav="home">← ホーム</button>
    <div class="section page-title-row"><div>発注予定を確認</div><span class="version-chip">v${APP_VERSION}</span></div>
    <div class="today-tabs"><button class="active">予定一覧</button><button data-nav="history">発注済み履歴</button></div>
    <section class="card today-filter-panel">
      <div class="today-filter-grid">
        <label>発注先<select id="todayVendorFilter"><option value="all">すべて</option>${vendors.map(v=>`<option value="${esc(v.id)}" ${TODAY_FILTER.vendor===v.id?"selected":""}>${esc(v.name)}</option>`).join("")}</select></label>
        <label>状態<select id="todayStatusFilter"><option value="all">すべて</option><option value="due" ${TODAY_FILTER.status==="due"?"selected":""}>今日</option><option value="overdue" ${TODAY_FILTER.status==="overdue"?"selected":""}>締切超過</option><option value="attention" ${TODAY_FILTER.status==="attention"?"selected":""}>要確認</option><option value="upcoming" ${TODAY_FILTER.status==="upcoming"?"selected":""}>予定</option></select></label>
        <label class="today-search">商品名・コード<input id="todayQuery" value="${esc(TODAY_FILTER.query)}" placeholder="商品名・コード・発注先"></label>
        <button class="btn" id="todayApplyFilter">検索</button>
        <button class="btn secondary" id="todayClearFilter">条件をクリア</button>
      </div>
      <div class="history-quick row wrap"><button class="btn secondary small" id="openHistory">発注履歴を見る</button><button class="btn secondary small" id="openPrevYearMonth">前年同月を表示</button></div>
    </section>
    <section class="card order-list-card">
      <div class="order-list-summary"><strong>${rows.length}件表示</strong><span class="muted">Infomartでの納品日選択・最終確定は手動です。</span></div>
      ${rows.length?`<div class="order-table-wrap"><table class="order-table"><thead><tr><th>状態</th><th>発注日・締切</th><th>発注先</th><th>納品日</th><th>商品</th><th>数量</th><th>操作</th></tr></thead><tbody>${rows.map(todayTableRow).join("")}</tbody></table></div><div class="order-mobile-list">${rows.map(todayMobileCard).join("")}</div>`:'<div class="empty-state">条件に合う発注予定はありません。</div>'}
    </section>
    <section class="card today-primary-action"><div><h3>今日必要な商品をまとめて自動入力</h3><p class="muted">今日・締切超過の対象だけを安全確認してInfomart数量入力へ進みます。</p></div><button class="btn" id="todayAuto" ${(!c.due.length&&!c.overdue.length)?"disabled":""}>数量自動入力の準備</button></section>`;
}

let HISTORY_MONTH=iso(today()).slice(0,7);

function ymShift(ym,years){
  const [y,m]=String(ym||iso(today()).slice(0,7)).split("-").map(Number);
  return `${String(y+years).padStart(4,"0")}-${String(m).padStart(2,"0")}`;
}
function currentYM(){return iso(today()).slice(0,7)}
function previousYearSameMonth(){return ymShift(currentYM(),-1)}
function historyRecordsForMonth(ym){
  return (S.history||[]).filter(h=>h.status==="completed"&&String(h.date||"").slice(0,7)===ym)
    .slice().sort((a,b)=>String(b.recordedAt||b.date||"").localeCompare(String(a.recordedAt||a.date||"")));
}
function historyGroupsForMonth(ym){
  const records=historyRecordsForMonth(ym),map=new Map(),groups=[];
  for(const h of records){
    const key=h.runId||`legacy:${h.date||"unknown"}`;
    if(!map.has(key)){
      const g={key,runId:h.runId||null,date:h.date||"",runName:h.runName||"",recordedAt:h.recordedAt||"",items:[]};
      map.set(key,g);groups.push(g);
    }
    const g=map.get(key);
    g.items.push(h);
    if(!g.runName&&h.runName)g.runName=h.runName;
    if((h.recordedAt||"")>(g.recordedAt||""))g.recordedAt=h.recordedAt;
  }
  groups.sort((a,b)=>String(b.recordedAt||b.date).localeCompare(String(a.recordedAt||a.date)));
  return groups;
}
function historyVendorLabel(h){
  if(h.vendorName)return h.vendorName;
  const p=(S.products||[]).find(p=>p.id===h.productId||p.code===h.code);
  return V(p?.vendorId)?.name||"発注先不明";
}
function historyPage(){
  const groups=historyGroupsForMonth(HISTORY_MONTH);
  const [yy,mm]=HISTORY_MONTH.split("-");
  const prev=previousYearSameMonth();
  const isPrev=HISTORY_MONTH===prev;

  return `<button class="btn secondary small" data-nav="home">← ホーム</button>
    <div class="section">発注履歴</div>
    <section class="card history-toolbar">
      <div>
        <h3>${esc(yy)}年${esc(+mm)}月の発注</h3>
        <p class="muted">発注ナビで「発注済み」にした履歴を表示します。</p>
      </div>
      <div class="history-controls">
        <input id="historyMonth" type="month" value="${esc(HISTORY_MONTH)}">
        <button class="btn secondary" id="historyThisMonth">今月</button>
        <button class="btn ${isPrev?"green":"secondary"}" id="historyPrevYear">前年同月を表示</button>
      </div>
    </section>
    <section class="card notice">
      <strong>前年から今年へコピー</strong><br>
      前年の発注カードにある「今年用プリセットにコピー」で、当時の商品と数量を現在のプリセット候補として複製できます。
      発注日・納品日は自動変更せず、今年の発注時に現在の発注先ルールで再チェックします。
    </section>
    ${groups.length?groups.map(historyGroupCard).join(""):`<section class="card"><h3>履歴はありません</h3><p class="muted">${esc(yy)}年${esc(+mm)}月に発注ナビへ保存された発注履歴はありません。</p></section>`}`;
}
function historyGroupCard(g){
  const vendors=[...new Set(g.items.map(historyVendorLabel))];
  const totalQty=g.items.reduce((n,x)=>n+(+x.qty||0),0);
  const canCopy=String(g.date||"").slice(0,4)!==String(today().getFullYear());
  const title=g.runName||`発注 ${String(g.date||"").replaceAll("-","/")}`;
  const rows=g.items.map(h=>`<div class="history-item"><div><strong>${esc(h.name||h.code)}</strong><br><span class="muted">${esc(h.code)} / ${esc(historyVendorLabel(h))}</span></div><div class="history-qty">× ${esc(h.qty)}</div></div>`).join("");
  return `<section class="card history-card">
    <div class="history-card-head">
      <div><h3>${esc(title)}</h3><p class="muted">${esc(g.date||"日付不明")} / ${g.items.length}商品 / 合計数量 ${esc(totalQty)}</p></div>
      <span class="master-badge">${esc(vendors.length)}発注先</span>
    </div>
    ${rows}
    <div class="history-actions">
      ${canCopy?`<button class="btn full" data-copy-history="${esc(g.key)}">今年用プリセットにコピー</button>`:""}
    </div>
  </section>`;
}
function historyCopyDialog(groupKey){
  const groups=historyGroupsForMonth(HISTORY_MONTH);
  const g=groups.find(x=>x.key===groupKey);
  if(!g){alert("対象の履歴が見つかりません。");return}

  const available=[],missing=[];
  for(const h of g.items){
    const p=(S.products||[]).find(p=>p.code===h.code&&!p.masterOrphan);
    if(p)available.push({history:h,p,qty:Math.max(0,+h.qty||0)});
    else missing.push(h);
  }
  const currentYear=today().getFullYear();
  const monthDay=String(g.date||"").slice(5).replace("-","/");
  const defaultName=`前年コピー ${currentYear}/${monthDay||"発注"}`;

  modal(`<h2>前年から今年へコピー</h2>
    <p class="muted">${esc(g.date||"日付不明")} の発注内容から、今年用のプリセットを作ります。</p>
    <div class="field"><label>新しいプリセット名</label><input id="historyCopyName" value="${esc(defaultName)}"></div>
    <div class="section">コピーする商品</div>
    ${available.map(x=>`<div class="task"><div><strong>${esc(x.p.name||x.p.code)}</strong><br><span class="muted">${esc(x.p.code)} / ${esc(V(x.p.vendorId)?.name||"発注先未設定")}</span></div><div><strong>× ${esc(x.qty)}</strong></div></div>`).join("")||'<div class="error">現在の商品マスターに一致する商品がありません。</div>'}
    ${missing.length?`<div class="notice" style="margin-top:8px"><strong>コピー対象外 ${missing.length}件</strong><br>${missing.map(x=>esc(`${x.name||x.code} (${x.code})`)).join("<br>")}<br>現在の商品マスターに同じ商品コードがないため除外します。</div>`:""}
    <div class="notice" style="margin-top:8px">コピーするのは商品と数量だけです。前年の日付や古い納品条件はコピーしません。今年の発注時にv1.4.7以降のプレフライトで再判定します。</div>
    <button class="btn green full" id="saveHistoryCopy" ${available.length?"":"disabled"}>今年用プリセットを作成</button>`);

  $("#saveHistoryCopy").onclick=()=>{
    const name=$("#historyCopyName").value.trim();
    if(!name){alert("プリセット名を入力してください。");return}
    const items=available.filter(x=>x.qty>0).map(x=>({productId:x.p.id,qty:x.qty}));
    if(!items.length){alert("数量1以上でコピーできる商品がありません。");return}
    checkpoint("前年履歴からプリセット作成前");
    let unique=name,seq=2;
    while((S.presets||[]).some(p=>p.name===unique)){unique=`${name} (${seq++})`}
    S.presets.push({
      id:uid(),name:unique,items,
      copiedFromHistory:{date:g.date||null,runId:g.runId||null,copiedAt:new Date().toISOString()}
    });
    save("前年履歴から今年用プリセット作成");
    $("#modal").close();
    view="presets";render();
    alert(`「${unique}」を作成しました。発注前に内容を確認してください。`);
  };
}

function dayLabels(arr){return(arr||[]).map(n=>DAYS.find(d=>d.v===n)?.l).filter(Boolean).join("・")||"未設定"}
function vendors(){
  return `<button class="btn secondary small" data-nav="home">← ホーム</button><div class="section">発注先 <span class="master-badge">共通マスター v${ROOT.masterVersion||1}</span></div>
  <section class="card"><p class="muted">締切・最短納品・納品可能曜日は全利用者共通です。変更には管理者PINが必要です。</p><button class="btn full" id="addVendor">＋ 発注先を追加</button></section>
  ${ROOT.commonMaster.vendors.map(v=>`<section class="card ${v.scheduleMode==="dated"?"schedule-card":""}"><h3>${esc(v.name)}</h3><div class="grid2"><div>締切<br><strong>${esc(v.cutoff)}</strong></div><div>最短納品<br><strong>${esc(v.minDeliveryDays)}日後</strong></div></div><p>納品可能：${esc(dayLabels(v.deliveryWeekdays))}</p><p><span class="master-badge">${esc(vendorScheduleSummary(v))}</span>${v.scheduleUpdatedAt?` <span class="schedule-source">更新 ${esc(new Date(v.scheduleUpdatedAt).toLocaleDateString("ja-JP"))}</span>`:""}</p><p>${vendorReady(v)?'<span class="badge green">発注ルール確認済み</span>':'<span class="badge orange">未確認・予定生成停止</span>'}</p><div class="row wrap"><button class="btn secondary small" data-ev="${v.id}">管理者編集</button><button class="btn secondary small" data-schedule-import="${v.id}">📷 紙スケジュール読込</button>${v.scheduleMode==="dated"?`<button class="btn secondary small" data-schedule-view="${v.id}">日付一覧</button>`:""}</div></section>`).join("")}`
}
function products(){
  return `<button class="btn secondary small" data-nav="home">← ホーム</button><div class="section">商品</div>
  <section class="card"><p class="muted">商品コード・商品名・発注先は共通マスター。数量・発注間隔・最初の発注日は利用者ごとに保存されます。</p><div class="grid2"><button class="btn" id="domImport">Infomartの商品行から追加（PC推奨）</button><button class="btn secondary" id="batchOcr">スクショの商品表から追加（補助）</button><button class="btn secondary" id="addProduct">手動登録</button></div></section>
  ${S.products.map(p=>`<section class="card ${p.masterOrphan?"danger-zone":""}"><h3>${esc(p.name||p.code)}</h3>${p.imageSource?`<img src="${esc(p.imageSource.startsWith("data:image/png;base64,")?p.imageSource:"")}" alt="登録した元画像の行" style="max-width:100%"><p>${p.domSource?"画像由来・DOM完全一致照合済み":"画像由来・DOM未確認（仮登録）"}</p>`:""}<div class="muted">商品コード ${esc(p.code)}</div><p>数量 ${esc(p.defaultQty)} / ${esc(intLabel(p))} / 数量${p.allowDecimalQty===true?"小数可":"整数のみ"} / 最短${esc(lead(p))}日後${V(p.vendorId)?.scheduleMode==="dated"?` / ${esc(scheduleClassLabel(p.scheduleClass||"standard"))}`:""}</p><p class="muted">発注先：${esc(V(p.vendorId)?.name||"未設定")}</p>${p.masterOrphan?'<p class="error">共通マスターから削除済み。発注には使われません。</p>':""}<button class="btn secondary small" data-ep="${p.id}">個人設定を編集</button> <button class="btn secondary small" data-emp="${p.id}">共通情報を管理者編集</button></section>`).join("")}`
}
function presetCard(pr){
  const results=(pr.items||[]).map(preflightItemForPreset),groups=groupPresetPreflight(results);
  const blockers=results.filter(x=>!x.ok).length,cutoff=results.filter(x=>x.ok&&x.cutoffPassed).length;
  const vendorCount=new Set(results.map(x=>x.v?.id).filter(Boolean)).size;
  const status=blockers?["要確認","warn"]:cutoff?["締切注意","caution"]:["確認OK","ok"];
  const lines=groups.slice(0,4).map(g=>{
    const ok=g.items.filter(x=>x.ok),first=ok.slice().sort((a,b)=>String(a.deliveryDate||"").localeCompare(String(b.deliveryDate||"")))[0];
    if(!g.v)return `<div class="preset-vendor-line"><span>発注先未設定</span><strong class="health-bad">要修正</strong></div>`;
    if(!g.ok)return `<div class="preset-vendor-line"><span>${esc(g.v.name)}</span><strong class="health-bad">要確認</strong></div>`;
    return `<div class="preset-vendor-line"><span>${esc(g.v.name)}</span><strong>最短納品 ${first?.deliveryDate?esc(fmtF(first.deliveryDate)):"—"}</strong></div>`;
  }).join("");
  return `<article class="preset-card ${status[1]}">
    <div class="preset-card-head"><div><h3>${esc(pr.name)}</h3><p>${pr.items.length}商品 / ${vendorCount}発注先</p></div><span class="preset-status ${status[1]}">${status[0]}</span></div>
    <div class="preset-vendors">${lines||'<div class="muted">商品が登録されていません。</div>'}${groups.length>4?`<div class="muted">ほか ${groups.length-4}発注先</div>`:""}</div>
    <div class="preset-actions"><button class="btn full" data-run="${esc(pr.id)}">このプリセットで発注する</button><button class="btn secondary full" data-epr="${esc(pr.id)}">内容を見る・編集</button></div>
  </article>`;
}
function presets(){
  const q=PRESET_FILTER.query.trim().toLowerCase();
  let list=S.presets.filter(pr=>{
    if(!q)return true;
    const names=(pr.items||[]).map(i=>P(i.productId)).filter(Boolean).flatMap(p=>[p.name,p.code,V(p.vendorId)?.name]).join(" ").toLowerCase();
    return String(pr.name||"").toLowerCase().includes(q)||names.includes(q);
  });
  if(PRESET_FILTER.sort==="name")list.sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
  else if(PRESET_FILTER.sort==="items")list.sort((a,b)=>(b.items?.length||0)-(a.items?.length||0));
  else list.sort((a,b)=>String(b.lastUsedAt||"").localeCompare(String(a.lastUsedAt||""))||String(a.name).localeCompare(String(b.name),"ja"));
  return `<button class="btn secondary small" data-nav="home">← ホーム</button>
    <div class="preset-page-head"><div><div class="section" style="margin-bottom:2px">プリセット</div><p class="muted">よく使う発注内容を登録して、すぐ発注できます。</p></div><button class="btn" id="addPreset">＋ 新しいプリセットを作る</button></div>
    <section class="card preset-toolbar"><div class="preset-search"><input id="presetQuery" value="${esc(PRESET_FILTER.query)}" placeholder="プリセット名・取引先・商品名で検索"><button class="btn" id="presetSearchBtn">検索</button></div><label>並び順<select id="presetSort"><option value="recent" ${PRESET_FILTER.sort==="recent"?"selected":""}>最近使った順</option><option value="name" ${PRESET_FILTER.sort==="name"?"selected":""}>名前順</option><option value="items" ${PRESET_FILTER.sort==="items"?"selected":""}>商品数が多い順</option></select></label></section>
    <div class="notice preset-notice">発注ボタンを押すと、発注先ごとの締切・最短納品日・紙スケジュールを確認してから数量自動入力へ進みます。</div>
    ${list.length?`<div class="preset-grid">${list.map(presetCard).join("")}</div>`:'<section class="card empty-state">条件に合うプリセットはありません。</section>'}`;
}

function settings(){
  const h=healthStatus(),sn=getSnapshots();
  return `<button class="btn secondary small" data-nav="home">← ホーム</button><div class="section">設定・保守</div>
  <section class="card"><h3>利用者</h3><p><strong>${esc(activeProfile().name)}</strong></p><button class="btn secondary full" id="manageUsers">利用者を切り替え・追加</button></section>
  <section class="card"><h3>システムチェック</h3>${h.map(x=>`<div class="health-grid"><div><strong>${esc(x.label)}</strong><br><span class="muted">${esc(x.detail)}</span></div><div class="${x.status==="OK"?"health-ok":x.status==="NG"?"health-bad":"health-warn"}">${esc(x.status)}</div></div>`).join("")}<div style="height:10px"></div><button class="btn secondary full" id="healthDetails">詳しい診断を見る</button></section>
  <section class="card" id="backupSection"><h3>バックアップ / 復元</h3><div class="grid2"><button class="btn secondary" id="exportAll">全利用者バックアップ</button><button class="btn secondary" id="exportProfile">現在利用者だけ</button></div><div style="height:8px"></div><button class="btn secondary full" id="import">バックアップから復元</button><div style="height:8px"></div><button class="btn secondary full" id="restoreSnapshot">自動復元ポイントを見る（${sn.length}件）</button></section>
  <section class="card" id="masterSection"><h3>共通マスター保守 <span class="master-badge">v${ROOT.masterVersion||1}</span></h3><p class="muted">管理者だけが操作できます。個人プリセット・数量・発注間隔・履歴は消しません。</p><div class="grid2"><button class="btn secondary" id="restoreInitial">初期マスターへ復元</button><button class="btn secondary" id="importMaster">マスターだけ更新</button></div><div style="height:8px"></div><button class="btn secondary full" id="exportMaster">現在の共通マスターを書き出す</button></section>
  <section class="card" id="adminSection"><h3>管理者モード</h3><p>${adminActive()?'<span class="badge green">管理者モードON</span>':'<span class="badge">一般利用者モード</span>'}</p><button class="btn secondary full" id="adminToggle">${adminActive()?"管理者モードを終了":"管理者モードを開始"}</button></section>
  <section class="card"><div class="field"><label>Infomart URL</label><input id="url" value="${esc(S.settings.infomartUrl)}"></div><button class="btn" id="saveSettings">保存</button></section>
  <section class="card"><h3>紙スケジュールOCR</h3><p class="muted">「発注期限 / 納品日」の紙を写真で読み込み、確認してから日付表として保存できます。</p><button class="btn secondary full" data-nav="vendors">発注先のスケジュールを確認</button></section>
  <section class="card"><h3>数量自動入力ヘルパー</h3><button class="btn secondary full" id="guide">ヘルパー設定を見る</button></section>`
}

function render(){
  if($("#profileName"))$("#profileName").textContent=activeProfile()?.name||"利用者";
  if($("#adminBtn")){$("#adminBtn").textContent=adminActive()?"🔓":"🔒";$("#adminBtn").classList.toggle("admin-on",adminActive())}
  let m=$("#main");m.innerHTML=view==="home"?home():view==="today"?todayView():view==="history"?historyPage():view==="vendors"?vendors():view==="products"?products():view==="presets"?presets():view==="paper"?paperPage():view==="mobile"?mobileHelperPage():settings();
  if(view==="backup"||view==="admin"){
    const keep=view==="backup"?["backupSection"]:["adminSection","masterSection"];
    $$("#main > section").forEach(el=>{if(!keep.includes(el.id))el.remove()});
    $("#main > .section").textContent=view==="backup"?"バックアップ/復元":"管理者設定";
  }
  if(healthReturn)m.insertAdjacentHTML("afterbegin",'<section class="card notice"><strong>システムチェックから修正中</strong><p>変更を保存したら、戻って診断結果を確認してください。</p><button class="btn full" id="returnHealth">システムチェックへ戻る・再診断</button></section>');
  bind();
}
function bind(){
  $$("[data-nav]").forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
  $("#returnHealth")?.addEventListener("click",healthDialog);
  $$("[data-paper-open]").forEach(b=>b.onclick=()=>scheduleViewDialog(b.dataset.paperOpen));
  $$("[data-one]").forEach(b=>b.onclick=()=>startOne(b.dataset.one));
  $$("[data-ev]").forEach(b=>b.onclick=async()=>{if(await requireAdmin("発注先マスターを編集"))vendorDialog(b.dataset.ev)});
  $$("[data-schedule-import]").forEach(b=>b.onclick=async()=>{if(await requireAdmin("紙スケジュールを読み込む")){SCHEDULE_VENDOR_ID=b.dataset.scheduleImport;$("#scheduleOcrFiles").click()}});
  $$("[data-schedule-view]").forEach(b=>b.onclick=()=>scheduleViewDialog(b.dataset.scheduleView));
  $$("[data-ep]").forEach(b=>b.onclick=()=>productPersonalDialog(b.dataset.ep));
  $$("[data-emp]").forEach(b=>b.onclick=async()=>{if(await requireAdmin("商品マスターを編集"))productMasterDialog(b.dataset.emp)});
  $$("[data-epr]").forEach(b=>b.onclick=()=>presetDialog(b.dataset.epr));
  $$("[data-run]").forEach(b=>b.onclick=()=>runPreset(b.dataset.run));
  $("#addVendor")?.addEventListener("click",async()=>{if(await requireAdmin("発注先マスターを追加"))vendorDialog()});
  $("#addProduct")?.addEventListener("click",async()=>{if(await requireAdmin("共通商品を追加"))productMasterDialog()});
  $("#domImport")?.addEventListener("click",async()=>{if(await requireAdmin("DOMから商品を取り込む"))domImportDialog()});
  $("#batchOcr")?.addEventListener("click",async()=>{if(await requireAdmin("画像から行を補助登録"))$("#ocrFiles").click()});
  $("#addPreset")?.addEventListener("click",()=>presetDialog());
  $("#todayAuto")?.addEventListener("click",runToday);
  $("#pendingDone")?.addEventListener("click",completePendingRun);
  $("#pendingVerify")?.addEventListener("click",verifyPendingReceipt);
  $("#pendingOverride")?.addEventListener("click",async()=>{if(!(await requireAdmin("手入力の数量確認を承認")))return;if(!S.pendingRun)return;const typed=prompt("Infomart画面で全商品の数量を目視確認した場合だけ「確認済み」と入力してください。");if(typed!=="確認済み"){alert("一致しないため承認しません");return}S.pendingRun.verificationOverride=true;S.pendingRun.verificationOverrideAt=new Date().toISOString();save("手入力数量を管理者確認")});
  $("#pendingClear")?.addEventListener("click",()=>{S.pendingRun=null;save("保留発注を解除")});
  $("#manageUsers")?.addEventListener("click",()=>userSelector(false));
  $("#healthDetails")?.addEventListener("click",healthDialog);
  $("#exportAll")?.addEventListener("click",exportAllJson);
  $("#exportProfile")?.addEventListener("click",exportProfileJson);
  $("#import")?.addEventListener("click",()=>$("#importFile").click());
  $("#restoreSnapshot")?.addEventListener("click",snapshotDialog);
  $("#restoreInitial")?.addEventListener("click",restoreInitialMaster);
  $("#importMaster")?.addEventListener("click",async()=>{if(await requireAdmin("共通マスターを更新"))$("#masterImportFile").click()});
  $("#exportMaster")?.addEventListener("click",async()=>{if(await requireAdmin("共通マスターを書き出す"))exportMaster()});
  $("#adminToggle")?.addEventListener("click",async()=>{if(adminActive())logoutAdmin();else await requireAdmin("管理者モードを開始")});
  $("#saveSettings")?.addEventListener("click",()=>{S.settings.infomartUrl=$("#url").value.trim()||DEFAULT_URL;save("設定変更");alert("保存しました")});
  $("#guide")?.addEventListener("click",guide);
  $("#copyIosMobile")?.addEventListener("click",()=>copyMobileAsset("./mobile-shortcut.js","iPhone / iPad用ショートカットJS"));
  $("#copyAndroidMobile")?.addEventListener("click",()=>copyMobileAsset("./mobile-bookmarklet.txt","Android用ブックマークレット"));
  $("#copyBookmarkMobile")?.addEventListener("click",()=>copyMobileAsset("./mobile-bookmarklet.txt","ブックマークレット"));
  $("#openHistory")?.addEventListener("click",()=>{HISTORY_MONTH=currentYM();view="history";render()});
  $("#openPrevYearMonth")?.addEventListener("click",()=>{HISTORY_MONTH=previousYearSameMonth();view="history";render()});
  $("#historyThisMonth")?.addEventListener("click",()=>{HISTORY_MONTH=currentYM();render()});
  $("#historyPrevYear")?.addEventListener("click",()=>{HISTORY_MONTH=previousYearSameMonth();render()});
  $("#historyMonth")?.addEventListener("change",e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){HISTORY_MONTH=e.target.value;render()}});
  $$("[data-copy-history]").forEach(b=>b.onclick=()=>historyCopyDialog(b.dataset.copyHistory));
  $("#todayStatusFilter")?.addEventListener("change",e=>{TODAY_FILTER.status=e.target.value;render()});
  $("#todayVendorFilter")?.addEventListener("change",e=>{TODAY_FILTER.vendor=e.target.value;render()});
  $("#todayApplyFilter")?.addEventListener("click",()=>{TODAY_FILTER.query=$("#todayQuery")?.value||"";render()});
  $("#todayQuery")?.addEventListener("keydown",e=>{if(e.key==="Enter"){TODAY_FILTER.query=e.currentTarget.value||"";render()}});
  $("#todayClearFilter")?.addEventListener("click",()=>{TODAY_FILTER.status="all";TODAY_FILTER.vendor="all";TODAY_FILTER.query="";render()});
  $("#presetSort")?.addEventListener("change",e=>{PRESET_FILTER.sort=e.target.value;render()});
  $("#presetSearchBtn")?.addEventListener("click",()=>{PRESET_FILTER.query=$("#presetQuery")?.value||"";render()});
  $("#presetQuery")?.addEventListener("keydown",e=>{if(e.key==="Enter"){PRESET_FILTER.query=e.currentTarget.value||"";render()}});
}

function modal(h){
  $("#modalBody").innerHTML=h+(healthReturn?'<p class="muted">保存後に閉じて、画面上部の「システムチェックへ戻る・再診断」を押してください。</p>':'');
  if(!$("#modal").open)$("#modal").showModal();
}
function weeks(sel,name){return `<div class="weekdays">${DAYS.map(d=>`<button type="button" data-w="${d.v}" data-n="${name}" class="${sel.includes(d.v)?"active":""}">${d.l}</button>`).join("")}</div>`}
function bindWeeks(){$$('[data-w]',$("#modalBody")).forEach(b=>b.onclick=()=>b.classList.toggle("active"))}
function selected(name){return $$(`[data-w][data-n="${name}"].active`,$("#modalBody")).map(b=>+b.dataset.w)}
function splitDates(s){return String(s).split(/[,、\s]+/).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x))}

function vendorDialog(id){
  let v=id?clone(normalizeVendor(V(id))):normalizeVendor({id:uid(),name:"",cutoff:"13:30",minDeliveryDays:3,deliveryWeekdays:[],orderClosedWeekdays:[],orderClosedDates:[],deliveryClosedDates:[],calendarConfirmed:false,orderHolidayRule:"unknown",deliveryHolidayRule:"unknown",scheduleMode:"rule",scheduleEntries:[],scheduleUpdatedAt:null,scheduleSourceName:null,scheduleNote:""});
  modal(`<h2>${id?"発注先を編集":"発注先を追加"}</h2><div class="notice"><strong>安全のため新規発注先は曜日・祝日を未設定で開始します。</strong><br>Infomartの実際の納品日カレンダーを確認するまでは、発注予定を自動生成しません。</div><div class="field"><label>発注先名</label><input id="vn" value="${esc(v.name)}"></div><div class="grid2"><div class="field"><label>締切時刻</label><input id="vc" type="time" value="${esc(v.cutoff)}"></div><div class="field"><label>最短納品</label><input id="vl" type="number" min="0" value="${esc(v.minDeliveryDays)}"><span class="help">3日後なら「3」</span></div></div><div class="field"><label>納品できる曜日</label>${weeks(v.deliveryWeekdays||[],"del")}</div><div class="field"><label>発注できない曜日</label>${weeks(v.orderClosedWeekdays||[],"ord")}</div><div class="grid2"><div class="field"><label>祝日の発注</label><select id="voh"><option value="unknown" ${v.orderHolidayRule==="unknown"?"selected":""}>未確認</option><option value="allowed" ${v.orderHolidayRule==="allowed"?"selected":""}>発注できる</option><option value="blocked" ${v.orderHolidayRule==="blocked"?"selected":""}>発注できない</option></select></div><div class="field"><label>祝日の納品</label><select id="vdh"><option value="unknown" ${v.deliveryHolidayRule==="unknown"?"selected":""}>未確認</option><option value="allowed" ${v.deliveryHolidayRule==="allowed"?"selected":""}>納品できる</option><option value="blocked" ${v.deliveryHolidayRule==="blocked"?"selected":""}>納品できない</option></select></div></div><div class="field"><label>臨時発注休業日</label><input id="voc" value="${esc((v.orderClosedDates||[]).join(","))}"></div><div class="field"><label>臨時納品休業日</label><input id="vdc" value="${esc((v.deliveryClosedDates||[]).join(","))}"></div><label class="check"><input id="vok" type="checkbox" ${v.calendarConfirmed?"checked":""}><strong>Infomartの納品日カレンダーで確認済み</strong></label><div class="field"><label>発注スケジュール方式</label><select id="vsm"><option value="rule" ${v.scheduleMode!=="dated"?"selected":""}>通常ルール（曜日・最短日数）</option><option value="dated" ${v.scheduleMode==="dated"?"selected":""}>紙スケジュールの日付表を優先</option></select><span class="help">変則日程の取引先は紙スケジュール方式にします。</span></div><div class="notice">締切・最短納品・納品曜日は全員に影響します。</div><button class="btn full" id="sv">保存</button>${id?'<button class="btn red full" id="dv" style="margin-top:8px">削除</button>':""}`);
  bindWeeks();
  $("#sv").onclick=()=>{let name=$("#vn").value.trim(),cutoff=$("#vc").value,ld=+$("#vl").value,dw=selected("del"),scheduleMode=$("#vsm").value||"rule",orderHolidayRule=$("#voh").value,deliveryHolidayRule=$("#vdh").value,wantsConfirmed=$("#vok").checked;if(!name||!cutoff||!Number.isFinite(ld)){alert("発注先名・締切時刻・最短納品を確認してください");return}if(wantsConfirmed&&scheduleMode!=="dated"&&!dw.length){alert("「カレンダー確認済み」にする前に、納品できる曜日を1つ以上選択してください。");return}if(wantsConfirmed&&(orderHolidayRule==="unknown"||deliveryHolidayRule==="unknown")){alert("「カレンダー確認済み」にする前に、祝日の発注・納品が可能か確認してください。");return}checkpoint("発注先マスター変更前");Object.assign(v,{name,cutoff,minDeliveryDays:ld,deliveryWeekdays:dw,orderClosedWeekdays:selected("ord"),orderHolidayRule,deliveryHolidayRule,orderAvoidHolidays:orderHolidayRule==="blocked",deliveryAvoidHolidays:deliveryHolidayRule==="blocked",orderClosedDates:splitDates($("#voc").value),deliveryClosedDates:splitDates($("#vdc").value),calendarConfirmed:wantsConfirmed,scheduleMode,scheduleEntries:Array.isArray(v.scheduleEntries)?v.scheduleEntries:[],scheduleUpdatedAt:v.scheduleUpdatedAt||null,scheduleSourceName:v.scheduleSourceName||null,scheduleNote:v.scheduleNote||""});if(id){let i=ROOT.commonMaster.vendors.findIndex(x=>x.id===id);ROOT.commonMaster.vendors[i]=v}else ROOT.commonMaster.vendors.push(v);ROOT.masterVersion++;syncMasterToProfiles();save("発注先マスター更新");$("#modal").close()};
  $("#dv")?.addEventListener("click",()=>{if(!confirm("全利用者に影響します。本当に削除しますか？"))return;checkpoint("発注先削除前");ROOT.commonMaster.vendors=ROOT.commonMaster.vendors.filter(x=>x.id!==id);ROOT.commonMaster.products.forEach(p=>{if(p.vendorId===id)p.vendorId=""});ROOT.masterVersion++;syncMasterToProfiles();save("発注先削除");$("#modal").close()})
}

function productMasterDialog(id){
  let existing=id?MP(id):null,p=existing?clone(existing):{id:uid(),code:"",name:"",vendorId:ROOT.commonMaster.vendors[0]?.id||"",leadDaysOverride:null,scheduleClass:"standard"};
  modal(`<h2>${id?"共通商品を編集":"共通商品を追加"}</h2><div class="field"><label>商品コード</label><input id="mc" ${p.domSource||p.imageSource?"readonly":""} value="${esc(p.code)}"></div><div class="field"><label>商品名</label><input id="mn" ${p.domSource||p.imageSource?"readonly":""} value="${esc(p.name)}"></div><div class="field"><label>発注先</label><select id="mv"><option value="">選択</option>${ROOT.commonMaster.vendors.map(v=>`<option value="${v.id}" ${p.vendorId===v.id?"selected":""}>${esc(v.name)}</option>`).join("")}</select></div><div class="field"><label>商品だけ最短納品日数が違う場合</label><input id="ml" type="number" min="0" value="${p.leadDaysOverride??""}" placeholder="空欄なら発注先設定"></div><label class="check"><input id="mdec" type="checkbox" ${p.allowDecimalQty===true?"checked":""}><strong>数量に小数を許可する</strong>（通常はOFF）</label><div class="field"><label>紙スケジュール区分</label><select id="msc"><option value="standard" ${String(p.scheduleClass||"standard")==="standard"?"selected":""}>通常</option>${[...new Set(ROOT.commonMaster.vendors.flatMap(v=>(v.scheduleEntries||[]).map(x=>String(x.classKey||"standard"))))].filter(x=>x!=="standard").map(x=>`<option value="${esc(x)}" ${String(p.scheduleClass||"standard")===x?"selected":""}>${esc(scheduleClassLabel(x))}</option>`).join("")}</select><span class="help">紙に5日前 / 8日前 / 10日前などの区分がある商品だけ変更します。</span></div><div class="notice">数量・発注間隔・最初の発注日は各利用者が個別設定できます。</div><button class="btn full" id="sm">保存</button>${id?'<button class="btn red full" id="dm" style="margin-top:8px">共通マスターから削除</button>':""}`);
  if(p.domSource)showDomRow(p.domSource,$("#modalBody"));
  $("#sm").onclick=()=>{let code=$("#mc").value.trim(),vendorId=$("#mv").value;if(!/^\d{7,13}$/.test(code)||!vendorId){alert("7〜13桁の商品コードと発注先を確認してください");return}if(p.domSource){try{validateDomRow(p.domSource);if(code!==p.domSource.code)throw Error("DOMコード不一致")}catch(e){alert(e.message);return}}if(ROOT.commonMaster.products.some(x=>x.code===code&&x.id!==p.id)){alert("同じ商品コードがあります");return}checkpoint("商品マスター変更前");Object.assign(p,{code,name:p.domSource?p.domSource.name:p.imageSource?p.name:$("#mn").value.trim(),vendorId,leadDaysOverride:$("#ml").value===""?null:+$("#ml").value,scheduleClass:$("#msc").value||"standard",allowDecimalQty:$("#mdec").checked});if(id){let i=ROOT.commonMaster.products.findIndex(x=>x.id===id);ROOT.commonMaster.products[i]=p}else ROOT.commonMaster.products.push(p);ROOT.masterVersion++;syncMasterToProfiles();save("商品マスター更新");$("#modal").close()};
  $("#dm")?.addEventListener("click",()=>{if(!confirm("全利用者の共通商品から外します。個人設定は安全のため孤立データとして残します。続けますか？"))return;checkpoint("商品マスター削除前");ROOT.commonMaster.products=ROOT.commonMaster.products.filter(x=>x.id!==id);ROOT.masterVersion++;syncMasterToProfiles();save("商品マスター削除");$("#modal").close()})
}

function productPersonalDialog(id){
  let p=P(id);if(!p)return;
  modal(`<h2>個人設定：${esc(p.name||p.code)}</h2><div class="summary-box">商品コード：<strong>${esc(p.code)}</strong><br>発注先：${esc(V(p.vendorId)?.name||"未設定")}<br>最短納品：${esc(lead(p))}日後</div><div class="field"><label>通常数量</label><input id="pq" type="number" min="0" step="${p.allowDecimalQty===true?"any":"1"}" value="${esc(p.defaultQty)}"></div><div class="field"><label>発注間隔</label><div class="pill"><button type="button" id="daily" class="${p.intervalMode==="daily"?"active":""}">毎日</button><button type="button" id="nday" class="${p.intervalMode!=="daily"?"active":""}">○日ごと</button></div><div id="nwrap" class="${p.intervalMode==="daily"?"hidden":""}" style="margin-top:8px"><input id="pi" type="number" min="1" max="60" value="${esc(p.intervalDays||2)}"></div></div><div class="field"><label>最初の発注日</label><input id="pf" type="date" value="${esc(p.firstOrderDate)}"></div><div id="ex" class="example"></div><label class="check"><input id="pa" type="checkbox" ${p.active!==false?"checked":""}>発注予定へ自動追加</label><button class="btn full" id="sp">保存</button>`);
  let mode=p.intervalMode||"daily";function ref(){$("#daily").classList.toggle("active",mode==="daily");$("#nday").classList.toggle("active",mode!=="daily");$("#nwrap").classList.toggle("hidden",mode==="daily");let f=parseDate($("#pf").value||iso(today())),step=mode==="daily"?1:Math.max(1,+$("#pi").value||1);$("#ex").innerHTML=`<strong>${fmt(f)} → ${fmt(add(f,step))} → ${fmt(add(f,step*2))}</strong><br><span class="muted">${mode==="daily"?"毎日":step+"日ごと"}の例</span>`}$("#daily").onclick=()=>{mode="daily";ref()};$("#nday").onclick=()=>{mode="n";ref()};$("#pi").oninput=ref;$("#pf").onchange=ref;ref();
  $("#sp").onclick=()=>{const q=+$("#pq").value;if(!Number.isFinite(q)||q<0||(p.allowDecimalQty!==true&&!Number.isInteger(q))){alert(p.allowDecimalQty===true?"数量を確認してください":"この商品は整数数量だけ入力できます");return}checkpoint("個人商品設定変更前");Object.assign(p,{defaultQty:q,intervalMode:mode,intervalDays:mode==="daily"?1:Math.max(1,+$("#pi").value||1),firstOrderDate:$("#pf").value||iso(today()),active:p.imageSource?false:$("#pa").checked,confirmed:!p.imageSource});save("個人商品設定変更");$("#modal").close()}
}

function presetDialog(id){
  let pr=id?S.presets.find(x=>x.id===id):{id:uid(),name:"新しいプリセット",items:[]};
  modal(`<h2>${id?"プリセット編集":"プリセット作成"}</h2><div class="field"><label>プリセット名</label><input id="prn" value="${esc(pr.name)}"></div><p class="muted">${esc(activeProfile().name)}専用です。</p>${S.products.filter(p=>!p.masterOrphan).map(p=>{let it=pr.items.find(i=>i.productId===p.id);return `<div class="card" style="box-shadow:none"><label class="check"><input type="checkbox" data-c="${p.id}" ${it?"checked":""}><strong>${esc(p.name||p.code)}</strong> ${esc(p.code)}</label><input type="number" min="0" step="${p.allowDecimalQty===true?"any":"1"}" data-q="${p.id}" value="${esc(it?.qty??p.defaultQty??1)}"></div>`}).join("")}<button class="btn full" id="spr">保存</button>${id?'<button class="btn red full" id="dpr" style="margin-top:8px">削除</button>':""}`);
  $("#spr").onclick=()=>{let name=$("#prn").value.trim(),items=[];for(const c of $$("[data-c]:checked",$("#modalBody"))){const p=P(c.dataset.c),q=+$(`[data-q="${c.dataset.c}"]`,$("#modalBody")).value;if(!Number.isFinite(q)||q<0||(p?.allowDecimalQty!==true&&!Number.isInteger(q))){alert(`${p?.name||p?.code||"商品"} の数量を確認してください。通常は整数のみです。`);return}items.push({productId:c.dataset.c,qty:q})}if(!name||!items.length){alert("名前と商品を確認してください");return}checkpoint("プリセット変更前");Object.assign(pr,{name,items});if(!id)S.presets.push(pr);save("プリセット保存");$("#modal").close()};
  $("#dpr")?.addEventListener("click",()=>{if(!confirm("このプリセットを削除しますか？"))return;checkpoint("プリセット削除前");S.presets=S.presets.filter(x=>x.id!==id);save("プリセット削除");$("#modal").close()})
}

function duplicateTodayCodes(items){
  const t=iso(today()),set=new Set((S.history||[]).filter(h=>h.date===t&&h.status==="completed").map(h=>h.code));
  return items.filter(i=>set.has(i.code));
}
function normalizePayloadQty(q,allowDecimal){
  const s=String(q??"").trim(),rx=allowDecimal?/^\d+(?:\.\d+)?$/:/^\d+$/;
  if(!rx.test(s)||!Number.isFinite(Number(s))||Number(s)<0)throw new Error(allowDecimal?"数量が不正です":"整数でない数量があります");
  return Number(s);
}
async function startDialog(payload,es){
  const transferItems=[];
  for(const item of payload.items){
    const mp=ROOT.commonMaster.products.find(p=>p.code===item.code);
    if(!mp){alert(`FAIL-CLOSED：商品コード ${item.code} が共通マスターにありません`);return}
    if(mp.imageSource&&!mp.domSource){alert("画像由来の商品はDOM未確認です。DOM商品として登録し直してください。");return}
    if(!mp.domSource){alert(`FAIL-CLOSED：商品 ${item.code} は実DOM本人確認情報がありません。DOM取り込み経路で登録し直してください。`);return}
    try{validateDomRow(mp.domSource);if(item.code!==mp.domSource.code)throw Error("コード不一致")}catch(err){alert("FAIL-CLOSED："+err.message);return}
    let qty;try{qty=normalizePayloadQty(item.qty,mp.allowDecimalQty===true)}catch(err){alert(`FAIL-CLOSED：${item.name||item.code} — ${err.message}`);return}
    transferItems.push({
      code:item.code,qty,name:item.name||mp.name||item.code,
      allowDecimalQty:mp.allowDecimalQty===true,
      identity:{name:mp.domSource.name||mp.name||"",specification:mp.domSource.specification||mp.specification||"",vendorDisplay:mp.domSource.vendorDisplay||mp.vendorDisplay||""}
    });
  }
  const dup=duplicateTodayCodes(transferItems);
  if(dup.length){
    const names=dup.map(x=>x.name||x.code).join("\n");
    if(!confirm(`本日すでに発注済みの商品があります。\n\n${names}\n\n追加発注として続けますか？`))return;
    if(!(await requireAdmin("二重発注警告を解除して追加発注")))return;
  }
  for(let e of es||[]){
    if(e.safetyIssue){alert(`FAIL-CLOSED：${e.p.name||e.p.code} — ${e.safetyIssue}`);return}
    const accepted=acceptance(e.v),ea=earliest(accepted,e.p,e.v);
    if(!accepted||!ea){alert(`FAIL-CLOSED：${e.p.name||e.p.code} の発注日または納品日を安全に計算できません。発注先設定を確認してください。`);return}
  }
  const runId=uid(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+PAYLOAD_TTL_MS).toISOString();
  const transferPayload={payloadVersion:2,name:payload.name,items:transferItems,runId,createdAt,expiresAt},code=encodePayload(transferPayload),warnings=[];
  for(let e of es||[]){let accepted=acceptance(e.v),ea=earliest(accepted,e.p,e.v);if(nowMin()>hm(e.v.cutoff))warnings.push(`${e.p.name||e.p.code}：${e.v.cutoff}締切超過。今からの最短納品は${fmt(ea)}です。`)}
  modal(`<h2>${esc(payload.name)}</h2><div class="notice"><strong>自動化範囲</strong><br>商品コード＋商品名＋規格＋発注先の一致確認 → 数量入力まで。納品日と最終確定は本人が確認します。<br><strong>数量データの有効時間は60分です。</strong> 古いデータは自動停止します。</div>${warnings.length?`<div class="error">${warnings.map(esc).join("<br>")}</div>`:""}<div class="section">入力する商品</div><div class="summary-box">${transferItems.map(i=>`<div>${esc(i.name||i.code)} <strong>× ${esc(i.qty)}</strong><br><span class="muted">${esc(i.code)}</span></div>`).join("<hr>")}</div><button class="btn green full" id="copyOpen">数量データをコピーしてInfomartを開く</button>`);
  $("#copyOpen").onclick=async()=>{if(!await clip(code))prompt("下のデータをコピーしてください",code);S.pendingRun={id:runId,name:payload.name,startedAt:createdAt,expiresAt,items:transferItems,entryKeys:(es||[]).map(e=>e.key),inputVerified:{},verificationOverride:false};save("発注開始");$("#modal").close();let u=S.settings.infomartUrl||DEFAULT_URL;window.open(u+(u.includes("#")?"&":"#")+"ifm="+encodeURIComponent(code),"_blank")}
}
function decodeTagged(raw,prefix){
  if(typeof raw!=="string"||!raw.trim().startsWith(prefix))throw new Error("形式が違います");
  let encoded=raw.trim().slice(prefix.length).replace(/-/g,"+").replace(/_/g,"/");while(encoded.length%4)encoded+="=";
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))));
}
async function verifyPendingReceipt(){
  const r=S.pendingRun;if(!r)return;
  let raw="";try{raw=(await navigator.clipboard.readText()||"").trim()}catch(_){}
  if(!raw.startsWith(RECEIPT_PFX))raw=String(prompt("Infomartの数量入力結果画面で「入力結果コードをコピー」を押し、そのコードを貼り付けてください。","")||"").trim();
  if(!raw)return;
  try{
    const receipt=decodeTagged(raw,RECEIPT_PFX);
    if(receipt?.receiptVersion!==1||receipt.runId!==r.id||!Array.isArray(receipt.items))throw new Error("今回の発注と一致する入力結果ではありません");
    const ft=Date.parse(receipt.finishedAt||"");if(!Number.isFinite(ft)||Date.now()-ft>RECEIPT_TTL_MS||ft-Date.now()>5*60*1000)throw new Error("入力結果コードが古い、または日時が不正です");
    const expected=new Map(r.items.map(i=>[String(i.code),String(i.qty)])),seen=new Set();
    for(const it of receipt.items){
      const code=String(it.code||""),qty=String(it.qty??"");
      if(!expected.has(code)||expected.get(code)!==qty)throw new Error(`商品 ${code||"(不明)"} の数量が今回の発注と一致しません`);
      if(seen.has(code))throw new Error(`入力結果内の商品コードが重複しています：${code}`);seen.add(code);
    }
    r.inputVerified=r.inputVerified||{};
    for(const it of receipt.items)r.inputVerified[String(it.code)]=String(it.qty);
    r.lastReceiptAt=new Date().toISOString();save("数量入力結果を照合");
    const n=pendingVerifiedCount(r);alert(`数量入力結果を照合しました：${n}/${r.items.length}件`);
  }catch(err){alert("入力結果を確認できません："+err.message)}
}
function completePendingRun(){
  const r=S.pendingRun;if(!r)return;
  const all=pendingVerifiedCount(r)===r.items.length;
  if(!all&&r.verificationOverride!==true){alert("数量入力結果が全件確認できていません。先に「数量入力結果コードを確認」を行ってください。");return}
  if(!confirm("Infomartで納品日・数量・対象商品を確認し、最終発注確定まで完了しましたか？"))return;
  checkpoint("発注済み記録前");
  const date=iso(today()),entryKeys=new Set(r.entryKeys||[]),verification=r.verificationOverride===true?"admin-manual-override":"helper-receipt";
  for(const item of r.items){
    const hp=S.products.find(p=>p.code===item.code),hv=V(hp?.vendorId);
    S.history.push({id:uid(),runId:r.id,runName:r.name||"",key:[...entryKeys].find(k=>k.startsWith((hp?.id||"")+"|"))||null,productId:hp?.id||null,vendorId:hv?.id||null,vendorName:hv?.name||"",code:item.code,name:item.name,qty:item.qty,date,status:"completed",inputVerification:verification,recordedAt:new Date().toISOString()});
  }
  S.pendingRun=null;save("発注済み記録");
  alert("発注済みとして記録しました。")
}

function encodePayload(p){let bytes=new TextEncoder().encode(JSON.stringify(p)),bin="";bytes.forEach(b=>bin+=String.fromCharCode(b));return PFX+btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function guide(){modal(`<h2>数量自動入力ヘルパー</h2><div class="card" style="box-shadow:none"><h3>Windows</h3><p>Chrome / Edge拡張を使用します。現在の商品一覧ページへ商品コード完全一致で数量入力します。別ページは手動で開いて再実行します。</p></div><div class="card" style="box-shadow:none"><h3>スマホ</h3><p>ホームの「スマホ自動入力」からiPhone / iPad用ショートカット、またはAndroid用ブックマークレットを設定できます。</p></div><div class="notice">数量欄のみを変更します。ページ送り・納品日選択・注文確定は自動操作しません。</div>`)}
async function clip(s){try{await navigator.clipboard.writeText(s);return true}catch{return false}}
function startOne(k){let e=entries().find(x=>x.key===k);if(!e)return;if(e.safetyIssue){alert("安全停止："+e.safetyIssue);return}startDialog({name:"1件発注",items:[{code:e.p.code,qty:e.p.defaultQty,name:e.p.name}]},[e])}
function runToday(){let c=classify(),es=[...c.overdue,...c.due];startDialog({name:"今日の発注",items:es.map(e=>({code:e.p.code,qty:e.p.defaultQty,name:e.p.name}))},es)}

function fmtDateISO(s){
  try{return fmtF(parseDate(s))}catch(_){return String(s||"")}
}
function preflightItemForPreset(item){
  const p=P(item.productId);
  if(!p)return {ok:false,reason:"商品マスターに存在しない商品です",item,p:null,v:null};
  const v=V(p.vendorId);
  if(!v)return {ok:false,reason:"発注先が未設定です",item,p,v:null};
  if(!vendorReady(v)){
    return {ok:false,reason:"発注先ルールが未確認です",item,p,v};
  }

  const now=today();
  const cutoffPassed=nowMin()>hm(v.cutoff||"13:30");
  const acceptedOrderDate=acceptance(v);
  if(!acceptedOrderDate)return {ok:false,reason:`発注可能日が${OPEN_DATE_SEARCH_DAYS}日以内に見つかりません（設定を確認）`,item,p,v,cutoffPassed};

  if(v.scheduleMode==="dated"){
    const next=nextDatedScheduleAfter(acceptedOrderDate,p,v);
    if(!next){
      return {
        ok:false,
        reason:`${scheduleClassLabel(p.scheduleClass||"standard")}の今後の紙スケジュールがありません`,
        item,p,v,
        cutoffPassed,
        orderDate:acceptedOrderDate
      };
    }
    return {
      ok:true,item,p,v,cutoffPassed,
      orderDate:parseDate(next.orderDate),
      deliveryDate:parseDate(next.deliveryDate),
      scheduleMode:"dated",
      scheduleClass:next.classKey||"standard"
    };
  }

  const deliveryDate=earliest(acceptedOrderDate,p,v);
  if(!deliveryDate)return {ok:false,reason:`納品可能日が${OPEN_DATE_SEARCH_DAYS}日以内に見つかりません（設定を確認）`,item,p,v,cutoffPassed,orderDate:acceptedOrderDate};
  return {
    ok:true,item,p,v,cutoffPassed,
    orderDate:acceptedOrderDate,
    deliveryDate,
    scheduleMode:"rule"
  };
}

function groupPresetPreflight(results){
  const groups=[];
  const map=new Map();
  for(const r of results){
    const key=r.v?.id||"__missing__";
    if(!map.has(key)){
      const g={key,v:r.v,items:[],ok:true};
      map.set(key,g);groups.push(g);
    }
    const g=map.get(key);
    g.items.push(r);
    if(!r.ok)g.ok=false;
  }
  return groups;
}

function presetPreflightDialog(pr){
  const results=(pr.items||[]).map(preflightItemForPreset);
  const groups=groupPresetPreflight(results);
  const blockers=results.filter(x=>!x.ok);
  const cutoffWarnings=results.filter(x=>x.ok&&x.cutoffPassed);

  const groupHtml=groups.map(g=>{
    const vname=g.v?.name||"発注先未設定";
    const lines=g.items.map(r=>{
      const pname=r.p?.name||r.p?.code||"不明な商品";
      if(!r.ok){
        return `<div class="task"><div><strong>${esc(pname)}</strong><br><span class="error">✕ ${esc(r.reason)}</span></div></div>`;
      }
      const orderLabel=fmtF(r.orderDate);
      const deliveryLabel=fmtF(r.deliveryDate);
      const mode=r.scheduleMode==="dated"
        ? `紙スケジュール${r.scheduleClass&&r.scheduleClass!=="standard"?" / "+scheduleClassLabel(r.scheduleClass):""}`
        : "通常ルール";
      const cutoff=r.cutoffPassed?`<br><span class="health-warn">締切 ${esc(r.v.cutoff)} 経過 → 次の受付日で計算</span>`:"";
      return `<div class="task"><div><strong>${esc(pname)}</strong><br><span class="muted">発注受付 ${esc(orderLabel)} → 最短納品 ${esc(deliveryLabel)} / ${esc(mode)}</span>${cutoff}</div><div><strong>× ${esc(r.item.qty)}</strong></div></div>`;
    }).join("");
    return `<section class="card ${g.ok?"":"danger-zone"}"><h3>${esc(vname)}</h3><p class="muted">締切 ${esc(g.v?.cutoff||"未設定")}</p>${lines}</section>`;
  }).join("");

  modal(`<h2>プリセット発注前チェック</h2>
    <p><strong>${esc(pr.name)}</strong> / ${(pr.items||[]).length}商品</p>
    <div class="${blockers.length?"error":"schedule-ok"}">
      ${blockers.length
        ? `修正が必要な項目が ${blockers.length}件あります。数量自動入力は開始しません。`
        : `✓ 発注先ごとの締切・納品可能日を確認しました。`}
    </div>
    ${cutoffWarnings.length?`<div class="notice" style="margin-top:8px">締切を過ぎた発注先があります。表示している「発注受付日」と「最短納品日」を確認してください。</div>`:""}
    <div class="section">発注先別の判定</div>
    ${groupHtml}
    ${blockers.length
      ? `<div class="grid2"><button class="btn secondary" id="preflightFixVendors">発注先を修正</button><button class="btn secondary" id="preflightFixProducts">商品設定を確認</button></div>`
      : `<button class="btn green full" id="preflightProceed">確認して数量自動入力へ</button>`}
    <div class="notice" style="margin-top:10px">数量自動入力ヘルパーは数量欄だけを変更します。納品日はここで判定・表示しますが、Infomart上の納品日選択と最終確定は本人が行います。</div>`);

  $("#preflightFixVendors")?.addEventListener("click",()=>{
    $("#modal").close();view="vendors";render();
  });
  $("#preflightFixProducts")?.addEventListener("click",()=>{
    $("#modal").close();view="products";render();
  });
  $("#preflightProceed")?.addEventListener("click",()=>{
    $("#modal").close();
    const items=(pr.items||[]).map(i=>{const p=P(i.productId);return p?{code:p.code,qty:i.qty,name:p.name}:null}).filter(Boolean);
    startDialog({name:pr.name,items},[]);
  });
}

function runPreset(id){
  const pr=S.presets.find(x=>x.id===id);
  if(!pr)return;
  pr.lastUsedAt=new Date().toISOString();
  activeProfile().data=S;activeProfile().updatedAt=new Date().toISOString();persistRoot();
  presetPreflightDialog(pr);
}


function safeFileName(s){return String(s||"user").replace(/[\\/:*?"<>|]/g,"_").slice(0,60)}
function downloadJson(obj,name){let b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportAllJson(){ROOT.lastExportAt=new Date().toISOString();persistRoot();downloadJson({type:"infomartOrderNav.multiuser",schemaVersion:SCHEMA_VERSION,exportedAt:ROOT.lastExportAt,root:ROOT},`InfomartOrder_ALL_USERS_${iso(today())}.json`);render()}
function exportProfileJson(){let p=activeProfile();ROOT.lastExportAt=new Date().toISOString();persistRoot();downloadJson({type:"infomartOrderNav.profile",schemaVersion:SCHEMA_VERSION,exportedAt:ROOT.lastExportAt,profile:{name:p.name,data:p.data}},`InfomartOrder_${safeFileName(p.name)}_${iso(today())}.json`);render()}
function exportMaster(){ROOT.lastMasterExportAt=new Date().toISOString();persistRoot();downloadJson(commonMasterPackage(),`initial_master_v${ROOT.masterVersion}_${iso(today())}.json`)}
function snapshotDialog(){let list=getSnapshots();if(!list.length){alert("復元ポイントはまだありません。");return}modal(`<h2>復元ポイント</h2><p class="muted">復元前の状態も自動保存します。</p>${list.map(x=>`<div class="snapshot-row"><strong>${esc(new Date(x.at).toLocaleString("ja-JP"))}</strong><br><span class="muted">${esc(x.reason||"自動保存")}</span><br><button class="btn secondary small" data-rs="${x.id}">この状態へ戻す</button></div>`).join("")}`);$$("[data-rs]",$("#modalBody")).forEach(b=>b.onclick=()=>{if(!confirm("この復元ポイントへ戻しますか？"))return;let x=list.find(s=>s.id===b.dataset.rs);if(!x)return;checkpoint("復元前");try{ROOT=JSON.parse(x.data);ROOT.schemaVersion=SCHEMA_VERSION;ACTIVE_ID=ROOT.activeProfileId||ROOT.profiles[0].id;S=activeProfile().data;persistRoot();$("#modal").close();view="home";render();alert("復元しました")}catch(e){alert("復元できません："+e.message)}})}
function userSelector(startup=false){
  modal(`<h2>${startup?"利用者を選んで開始":"利用者"}</h2><p class="muted">共有PCなので、必ず自分の名前を選んでください。</p>${ROOT.profiles.map(p=>`<div class="user-row"><div><strong>${esc(p.name)}</strong>${p.id===ACTIVE_ID?' <span class="badge green">現在</span>':""}</div><button class="btn ${p.id===ACTIVE_ID?"green":"secondary"} small" data-su="${p.id}">${startup&&p.id===ACTIVE_ID?"この利用者で開始":"選択"}</button></div>`).join("")}<div class="section">利用者を追加</div><div class="field"><label>利用者名</label><input id="newUserName" placeholder="例：Aさん"></div><button class="btn full" id="addUser">利用者を追加</button>${startup?"":'<div class="section">管理</div><button class="btn secondary full" id="renameUser">現在の利用者名を変更</button><button class="btn red full" id="deleteUser" style="margin-top:8px">現在の利用者を削除</button>'}`);
  $$("[data-su]",$("#modalBody")).forEach(b=>b.onclick=()=>{$("#modal").close();switchProfile(b.dataset.su);lastActivity=Date.now()});
  $("#addUser").onclick=()=>{let name=$("#newUserName").value.trim();if(!name){alert("利用者名を入力してください");return}if(ROOT.profiles.some(p=>p.name===name)){alert("同じ名前があります");return}checkpoint("利用者追加前");let data=workspaceDefault();data.settings=clone(S.settings);data.products=ROOT.commonMaster.products.map(mp=>personalProductFromMaster(mp));let p=newProfile(name,data);ROOT.profiles.push(p);persistRoot();$("#modal").close();switchProfile(p.id)};
  $("#renameUser")?.addEventListener("click",()=>{let p=activeProfile(),name=prompt("新しい利用者名",p.name);if(!name||!name.trim())return;p.name=name.trim();persistRoot();$("#modal").close();render()});
  $("#deleteUser")?.addEventListener("click",async()=>{if(ROOT.profiles.length<=1){alert("最後の利用者は削除できません");return}if(!(await requireAdmin("利用者を削除")))return;let p=activeProfile(),typed=prompt(`誤削除防止のため「${p.name}」と入力してください。`);if(typed!==p.name){alert("一致しないため削除しません");return}checkpoint("利用者削除前");ROOT.profiles=ROOT.profiles.filter(x=>x.id!==p.id);ACTIVE_ID=ROOT.profiles[0].id;S=activeProfile().data;persistRoot();$("#modal").close();render()})
}
function navigate(to){
  if(to==="health"){healthDialog();return}
  healthReturn=false;view=to;render();window.scrollTo(0,0);
}

function mobileHelperPage(){
  const ua=navigator.userAgent||"";
  const ios=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  const android=/Android/i.test(ua);
  const rec=ios?"この端末では iPhone / iPad用ショートカットを推奨します。":android?"この端末では Android用ブックマークレットを推奨します。":"スマホ側でこのページを開き、端末に合う方法を1回だけ設定してください。";
  return `<button class="btn secondary small" data-nav="home">← ホーム</button>
  <div class="section">スマホ数量自動入力 <span class="master-badge">v${APP_VERSION}</span></div>
  <section class="card"><h3>初回だけ設定</h3><p>${esc(rec)}</p><div class="notice">スマホへ渡すのはこの発注ナビURLでOKです。各スマホで最初にこのヘルパーを1回設定してください。</div></section>
  <section class="card"><h3>iPhone / iPad（推奨：ショートカット）</h3>
    <ol><li>下のボタンでJavaScriptをコピー</li><li>ショートカットAppで新規作成</li><li>Safariの「WebページでJavaScriptを実行」を追加し、サンプルコードを全部消して貼り付け</li><li>共有シートに表示をON、名前を「Infomart数量入力」にする</li></ol>
    <button class="btn full" id="copyIosMobile">iPhone / iPad用JSをコピー</button>
    <div style="height:8px"></div><button class="btn secondary full" id="copyBookmarkMobile">Safariブックマークレット版をコピー</button>
  </section>
  <section class="card"><h3>Android</h3>
    <ol><li>Chromeで任意のページをブックマーク</li><li>ブックマーク名を「Infomart数量入力」に変更</li><li>URLを下のボタンでコピーした javascript: から始まる文字列へ置き換える</li><li>Infomart商品一覧でアドレスバーに「Infomart数量入力」と入力し、ブックマーク候補を実行</li></ol>
    <button class="btn full" id="copyAndroidMobile">Android用ブックマークレットをコピー</button>
  </section>
  <section class="card"><h3>普段の使い方</h3>
    <ol><li>発注ナビで「数量データをコピーしてInfomartを開く」</li><li>Infomartの商品一覧 <strong>order_my_catalog.page</strong> を開く</li><li>上で設定した「Infomart数量入力」を実行</li><li>商品コード・商品名・規格・発注先が一致した商品の数量欄だけ入力</li><li>別ページの商品が残っていれば、次ページを手動で開いてもう一度実行</li><li>全件入力後「入力結果コードをコピー」→発注ナビで照合</li><li>数量・納品日・金額を確認して本人が最終確定</li></ol>
    <div class="notice">数量データは作成から60分だけ有効です。ページ送り・納品日選択・注文確定は自動操作しません。InfomartのDOM構造や商品本人確認が一致しない場合は安全停止します。</div>
  </section>`;
}
async function copyMobileAsset(path,label){
  try{
    const r=await fetch(path,{cache:"no-store"});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const text=await r.text();
    if(await clip(text)){alert(`${label}をコピーしました。`);return}
    modal(`<h2>${esc(label)}</h2><p>自動コピーできなかったため、下をすべて選択してコピーしてください。</p><textarea id="mobileCopyFallback" readonly style="width:100%;min-height:260px">${esc(text)}</textarea>`);
    setTimeout(()=>{$("#mobileCopyFallback")?.select()},50);
  }catch(e){
    alert(`${label}を読み込めませんでした。GitHub Pagesの更新が完了してから、もう一度試してください。\n${e?.message||e}`);
  }
}

function paperPage(){
  return '<button class="btn secondary small" data-nav="home">← ホーム</button><div class="section">紙スケジュール</div><section class="card"><p>発注先を選んで日付表の確認・写真読込・手動入力を行います。</p><button class="btn secondary" data-nav="vendors">発注先を登録・編集</button></section>'+ROOT.commonMaster.vendors.map(v=>`<section class="card"><h3>${esc(v.name||"名称なし")}</h3><p>${esc(vendorScheduleSummary(v))}</p><button class="btn full" data-paper-open="${esc(v.id)}">紙スケジュールを開く</button></section>`).join('');
}
async function repairFinding(target){
  healthReturn=true;$("#modal").close();
  view=({vendor:"vendors",product:"products",preset:"presets",paper:"paper",users:"settings"})[target.kind]||target.kind;
  render();window.scrollTo(0,0);
  if(target.kind==="vendor"||target.kind==="product"){
    const profileId=ACTIVE_ID;
    if(!(await requireAdmin("システムチェックの問題を修正"))||profileId!==ACTIVE_ID)return;
    if(target.kind==="vendor"&&V(target.id))vendorDialog(target.id);
    if(target.kind==="product"&&MP(target.id))productMasterDialog(target.id);
  }else if(target.kind==="paper"&&V(target.id))scheduleViewDialog(target.id);
  else if(target.kind==="preset"&&S.presets.some(p=>p.id===target.id))presetDialog(target.id);
  else if(target.kind==="users")userSelector(false);
}
function healthDialog(){
  healthReturn=false;view="settings";render();
  const i=integrityCheck(),h=healthStatus();
  const summaryTargets=[{kind:"products"},{kind:"vendors"},{kind:"users"},{kind:"presets"},{kind:"backup"},{kind:"backup"},null,null,{kind:"paper"}];
  const targets=[];
  const button=target=>{const n=targets.push(target)-1;return `<button class="btn secondary small" data-fix="${n}">修正する</button>`};
  modal(`<h2>システムチェック</h2>${h.map((x,n)=>`<div class="health-grid"><div><strong>${esc(x.label)}</strong><br><span class="muted">${esc(x.detail)}</span></div><div class="${x.status==="OK"?"health-ok":x.status==="NG"?"health-bad":"health-warn"}">${esc(x.status)} ${x.status!=="OK"?button(summaryTargets[n]):""}</div></div>`).join("")}${["NG","注意"].map(status=>{const list=i.findings.filter(f=>f.status===status);return list.length?`<div class="section">${status==="NG"?"修正が必要":"注意"}</div>${list.map(f=>`<div class="card"><p>${esc(f.text)}</p>${button(f.target)}</div>`).join("")}`:""}).join("")}<p class="muted">Infomart DOMは数量入力ヘルパー実行時に毎回自己診断し、構造不一致なら停止します。</p>`);
  $$("[data-fix]",$("#modalBody")).forEach(b=>b.onclick=()=>repairFinding(targets[+b.dataset.fix]));
}

async function restoreInitialMaster(){
  if(!(await requireAdmin("初期マスターへ復元")))return;
  if(!BUNDLED_INITIAL_MASTER||!BUNDLED_INITIAL_MASTER.products?.length){alert("この配布版には初期商品マスターがまだ内蔵されていません。管理者が「現在の共通マスターを書き出す」で initial_master.json を作成し、配布版へ同梱してください。");return}
  if(!confirm("共通商品・発注先だけを配布時の初期状態へ戻します。\n個人プリセット・数量・発注間隔・履歴は残します。続けますか？"))return;
  applyMasterPackage(BUNDLED_INITIAL_MASTER,{reason:"初期マスター復元"});
  alert("共通マスターを初期状態へ戻しました。個人プリセットと履歴は保持しています。")
}

$("#importFile").addEventListener("change",async e=>{let f=e.target.files?.[0];if(!f)return;try{let o=JSON.parse(await f.text());checkpoint("バックアップ復元前");if(o?.type==="infomartOrderNav.multiuser"&&o.root?.profiles?.length){if(!confirm("全利用者バックアップで現在データを置き換えますか？"))return;ROOT=o.root;if(ROOT.schemaVersion!==SCHEMA_VERSION)ROOT=migrateImportedRoot(ROOT);ACTIVE_ID=ROOT.activeProfileId||ROOT.profiles[0].id;S=activeProfile().data;persistRoot();view="home";render();alert("復元しました")}else if(o?.type==="infomartOrderNav.profile"&&o.profile?.data){let p=newProfile(o.profile.name||"復元利用者",o.profile.data);ROOT.profiles.push(p);persistRoot();switchProfile(p.id);alert("利用者として復元しました")}else throw Error("対応していないバックアップです")}catch(err){alert("復元できません："+err.message)}e.target.value=""});
$("#masterImportFile").addEventListener("change",async e=>{let f=e.target.files?.[0];if(!f)return;try{let o=JSON.parse(await f.text());if(!(await requireAdmin("共通マスターを更新")))return;if(!confirm("個人プリセット・数量・発注間隔・履歴を残したまま、共通マスターだけ更新しますか？"))return;applyMasterPackage(o,{reason:"共通マスター更新"});alert("共通マスターを更新しました")}catch(err){alert("マスター更新に失敗："+err.message)}e.target.value=""});
function migrateImportedRoot(r){return r} // v1.3同形式以外は配布版の旧移行処理を利用


// Paper schedules: keep all results as unconfirmed, editable candidates.
let SCHEDULE_VENDOR_ID=null;
function normalizeOcrText(s){return String(s||'').normalize('NFKC').replace(/[ \t]+/g,' ').trim()}
function extractScheduleDates(line){
  const out=[];
  const s=normalizeOcrText(line).replace(/(\d)\s*[目円]/g,'$1日');
  for(const m of s.matchAll(/(?:(20\d{2})\s*[年/-]\s*)?(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/g)){
    if(+m[2]>=1&&+m[2]<=12&&+m[3]>=1&&+m[3]<=31)out.push({year:m[1]?+m[1]:null,month:+m[2],day:+m[3],index:m.index,length:m[0].length});
  }return out;
}
function extractScheduleClasses(line){return [...normalizeOcrText(line).matchAll(/(5|8|10)\s*日\s*前/g)].map(m=>`${+m[1]}日前`)}
function detectScheduleYear(text,fallback){
  const s=normalizeOcrText(text),m=s.match(/\b(20\d{2})\b/),r=s.match(/令和\s*(\d{1,2})\s*年/);
  return m?+m[1]:r?2018+(+r[1]):fallback;
}
function dateISOFromParts(y,m,d){const x=new Date(y,m-1,d,12);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?iso(x):null}
function schedulePair(a,b,year,cls='standard'){
  const oy=a.year||year,dy=b.year||(a.month===12&&b.month===1?oy+1:oy);
  const od=dateISOFromParts(oy,a.month,a.day),dd=dateISOFromParts(dy,b.month,b.day);
  if(!od||!dd||dd<od)return null;
  return {id:uid(),classKey:cls,orderDate:od,deliveryDate:dd,source:'ocr'};
}
function cleanScheduleEntries(entries){const seen=new Set();return entries.filter(x=>{const k=`${x.classKey}|${x.orderDate}|${x.deliveryDate}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.orderDate.localeCompare(b.orderDate)||a.classKey.localeCompare(b.classKey))}
function parseScheduleOcr(text,fallbackYear,layout='auto',forcedYear=false){
  const lines=String(text||'').split(/\r?\n/).map(normalizeOcrText).filter(Boolean);
  const year=forcedYear?+fallbackYear:detectScheduleYear(text,+fallbackYear),entries=[],warnings=[];
  let orders=[],deliveries=[],classes=[],mode=null;
  function flush(){
    if(orders.length||deliveries.length){
      if(orders.length!==deliveries.length)warnings.push('発注期限と納品日の数が一致しない表は自動登録候補から除外しました。');
      else for(let i=0;i<orders.length;i++){const x=schedulePair(orders[i],deliveries[i],year,classes[i]||'standard');if(x)entries.push(x)}
    }orders=[];deliveries=[];classes=[];mode=null;
  }
  if(layout==='pairs'||layout==='rows'){
    const dateLines=lines.filter(l=>!/20\d{2}\s*年.*(?:時|分)|令和.*年|発注スケジュール/.test(l));
    const dates=dateLines.flatMap(extractScheduleDates);
    if(layout==='pairs'){
      if(dates.length%2)warnings.push('日付が奇数です。末尾を手動確認してください。');
      if(dateLines.filter(l=>extractScheduleDates(l).length).every(l=>extractScheduleDates(l).length===2)){
        for(const l of dateLines){const ds=extractScheduleDates(l);if(ds.length===2){const x=schedulePair(ds[0],ds[1],year,extractScheduleClasses(l)[0]||'standard');if(x)entries.push(x)}}
      }else for(let i=0;i+1<dates.length;i+=2){let x=schedulePair(dates[i],dates[i+1],year);if(x)entries.push(x)}
    }else{
      let pending=[];
      for(const l of dateLines){const ds=extractScheduleDates(l);if(!ds.length)continue;if(!pending.length)pending=ds;else{orders=pending;deliveries=ds;flush();pending=[]}}
      if(pending.length)warnings.push('対応する納品日の行がありません。');
    }
    warnings.push('指定した読み順による候補です。区分と日付を写真で確認してください。');
  }else{
    for(const line of lines){
      const compact=line.replace(/\s/g,''),cls=extractScheduleClasses(line);
      if(cls.length){if(orders.length||deliveries.length)flush();classes.push(...cls);continue}
      // Both labels on one line are column-oriented OCR; do not guess the split.
      if(/発注/.test(compact)&&/納品/.test(compact)){flush();warnings.push('見出しが同じ行にあります。画像の位置情報、または読み順の指定を使ってください。');continue}
      if(/発注(?:期限|期眼|期日|締切)/.test(compact)){if(orders.length||deliveries.length)flush();mode='order'}
      else if(/納品[日目]?/.test(compact)){mode='delivery'}
      const ds=extractScheduleDates(line);
      if(mode==='order')orders.push(...ds);else if(mode==='delivery')deliveries.push(...ds);
    }flush();
  }
  if(!entries.length)warnings.push('自動抽出は0件です。読み順を変更するか、行を追加して手動入力できます。');
  const note=lines.filter(x=>/締.*切|午前中|発注.*各日/.test(x)).slice(0,5).join(' / ');
  return {year,entries:cleanScheduleEntries(entries),note,rawText:String(text||''),warnings:[...new Set(warnings)],yearReason:detectScheduleYear(text,0)?'紙面の年から推定（FAX送信年の場合もあります）':'年が読めないため現在年を仮設定'};
}
// Recover date positions from Tesseract word boxes, independently of text reading order.
function scheduleGeometry(data,year){
  const cells=[];
  for(const line of data.lines||[]){
    const words=line.words||[],spans=[];let text='';
    for(const w of words){const t=normalizeOcrText(w.text);spans.push({start:text.length,end:text.length+t.length,box:w.bbox});text+=t+' '}
    for(const d of extractScheduleDates(text)){
      const boxes=spans.filter(w=>w.end>d.index&&w.start<d.index+d.length).map(w=>w.box).filter(Boolean);
      if(!boxes.length)continue;
      const x0=Math.min(...boxes.map(b=>b.x0)),x1=Math.max(...boxes.map(b=>b.x1)),y0=Math.min(...boxes.map(b=>b.y0)),y1=Math.max(...boxes.map(b=>b.y1));
      cells.push({...d,x:(x0+x1)/2,y:(y0+y1)/2,h:y1-y0,w:x1-x0});
    }
  }
  // In a table, a date's vertically adjacent cell must share its column.
  const used=new Set(),entries=[];
  for(const a of cells.slice().sort((a,b)=>a.y-b.y)){
    if(used.has(a)||a.year)continue;
    const candidates=cells.filter(b=>!used.has(b)&&b!==a&&b.y>a.y+Math.min(a.h,b.h)*0.65&&b.y-a.y<Math.max(a.h,b.h)*4&&Math.abs(a.x-b.x)<Math.max(a.w,b.w)*0.45).sort((b,c)=>b.y-c.y);
    const b=candidates[0];if(!b)continue;
    let x=schedulePair(a,b,year);if(!x)continue;
    const days=Math.round((Date.parse(x.deliveryDate)-Date.parse(x.orderDate))/86400000);
    if(days>31)continue;
    // Special lead-time classes require both the label and matching date interval.
    if([5,8,10].includes(days)&&extractScheduleClasses(data.text).includes(`${days}日前`))x.classKey=`${days}日前`;
    entries.push(x);used.add(a);used.add(b);
  }return cleanScheduleEntries(entries);
}
function scheduleReviewDialog(vendorId,parsed,sourceName){
  const v=V(vendorId);if(!v)return;let rows=parsed.entries.map(x=>({...x}));
  modal(`<h2>${esc(v.name)}：紙スケジュール確認</h2><div class="notice">${esc(parsed.yearReason||'対象年を確認してください')}。対象年：${esc(parsed.year)}。<br><strong>全行を紙と見比べてください。保存すると既存の日付表を置き換えます。</strong></div><p>${esc((parsed.warnings||[]).join(' / '))}</p>${parsed.note?`<div class="schedule-warn">OCR注意書き：${esc(parsed.note)}<br>発注先の締切時刻も別途確認してください。</div>`:''}<div class="section">区分 ／ 発注期限 → 納品日</div><div id="scheduleRows"></div><button class="btn secondary" id="addScheduleRow">＋ 行を追加</button><details><summary>OCR生テキスト確認・修正／読み順の変更</summary><textarea id="scheduleRaw" rows="10" style="width:100%">${esc(parsed.rawText)}</textarea><label>対象年 <input id="scheduleYear" type="number" min="2000" max="2099" value="${parsed.year}"></label><select id="scheduleLayout"><option value="auto">見出しから復元</option><option value="rows">発注期限の行 → 納品日の行</option><option value="pairs">発注期限 → 納品日を交互に読む</option></select><button class="btn secondary" id="reparseSchedule">この年・読み順で候補を作り直す</button></details><label class="check"><input type="checkbox" id="scheduleConfirmed">対象年・区分・全日付・件数を紙と照合しました</label><button class="btn full" id="saveSchedule">確認した内容を保存</button>`);
  function draw(){
    $('#scheduleRows').innerHTML=rows.map((x,i)=>`<div class="schedule-row"><select data-sc="${i}" aria-label="区分">${[...new Set(['standard','5日前','8日前','10日前',x.classKey])].map(c=>`<option value="${esc(c)}" ${c===x.classKey?'selected':''}>${esc(scheduleClassLabel(c))}</option>`).join('')}</select><input type="date" aria-label="発注期限" data-so="${i}" value="${esc(x.orderDate)}"><input type="date" aria-label="納品日" data-sd="${i}" value="${esc(x.deliveryDate)}"><button class="btn red small" data-sdel="${i}">削除</button></div>`).join('')||'<div class="notice">候補0件。「行を追加」で手動入力できます。</div>';
    $$('[data-sdel]',$('#modalBody')).forEach(b=>b.onclick=()=>{capture();rows.splice(+b.dataset.sdel,1);draw();$('#scheduleConfirmed').checked=false});
  }
  function capture(){rows.forEach((x,i)=>Object.assign(x,{classKey:$(`[data-sc="${i}"]`).value,orderDate:$(`[data-so="${i}"]`).value,deliveryDate:$(`[data-sd="${i}"]`).value}))}
  draw();
  const importLabel=document.createElement('label');importLabel.className='field';importLabel.textContent='補助テキストから候補を読み込む（1行に発注期限・納品日・区分）';
  const importFile=document.createElement('input');importFile.type='file';importFile.accept='.txt,text/plain';importFile.id='scheduleTextFile';importLabel.appendChild(importFile);$('#scheduleRaw').before(importLabel);
  if(parsed.otherRaw){const details=document.createElement('details'),summary=document.createElement('summary'),raw=document.createElement('pre');summary.textContent='全OCR試行の生テキスト（参照用）';raw.textContent=parsed.otherRaw;raw.style.whiteSpace='pre-wrap';details.append(summary,raw);$('#scheduleRaw').after(details)}
  importFile.onchange=async()=>{const file=importFile.files?.[0];if(!file)return;const text=await file.text();if(!confirm('編集中の候補を補助テキストの内容で置き換えますか？'))return;scheduleReviewDialog(vendorId,parseScheduleOcr(text,+$('#scheduleYear').value,'pairs'),file.name)};
  $('#scheduleRows').oninput=()=>{$('#scheduleConfirmed').checked=false};
  $('#addScheduleRow').onclick=()=>{capture();rows.push({id:uid(),classKey:'standard',orderDate:'',deliveryDate:'',source:'manual'});draw();$('#scheduleConfirmed').checked=false};
  $('#reparseSchedule').onclick=()=>{const y=+$('#scheduleYear').value;if(!Number.isInteger(y)||y<2000||y>2099){alert('対象年を2000～2099で入力してください');return}if(!confirm('編集中の候補を作り直しますか？'))return;scheduleReviewDialog(vendorId,parseScheduleOcr($('#scheduleRaw').value,y,$('#scheduleLayout').value,true),sourceName)};
  $('#saveSchedule').onclick=async()=>{
    capture();if(!rows.length||rows.some(x=>!x.orderDate||!x.deliveryDate)){alert('全行の日付を入力してください。不要な行は削除できます。');return}
    if(rows.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x.orderDate)||!/^\d{4}-\d{2}-\d{2}$/.test(x.deliveryDate)||x.deliveryDate<x.orderDate)){alert('発注期限と納品日の前後関係を確認してください');return}
    const keys=new Set();for(const x of rows){const k=x.classKey+'|'+x.orderDate;if(keys.has(k)){alert('同じ区分・発注期限が重複しています。確認して1行にまとめてください。');return}keys.add(k)}
    if(!$('#scheduleConfirmed').checked){alert('紙と照合して確認欄にチェックしてください');return}
    const updated=rows.map(x=>({...x}));
    if(!(await requireAdmin('紙スケジュールを保存')))return;
    if(!confirm(`${updated.length}件で既存の日付表を置き換えます。保存しますか？`))return;
    checkpoint('紙スケジュール更新前');v.scheduleMode='dated';v.scheduleEntries=updated;v.scheduleUpdatedAt=new Date().toISOString();v.scheduleSourceName=sourceName||'手動入力';v.scheduleNote=parsed.note||'';ROOT.masterVersion++;syncMasterToProfiles();save('紙スケジュール更新');$('#modal').close();alert(`${updated.length}件を保存しました`);
  };
}
function scheduleImportDialog(vendorId,files){
  let angle=0,closed=false,worker=null,token=0;const urls=files.map(f=>URL.createObjectURL(f));
  modal(`<h2>紙スケジュール読込</h2><p>文字を上向きに回転してください。傾きも補正できます。</p><img id="schedulePreview" alt="選択した紙スケジュール" style="max-width:100%;max-height:45vh;object-fit:contain"><button id="scheduleRotate" class="btn secondary">90°回転</button><label>傾き（度）<input id="scheduleTilt" type="number" value="0" min="-15" max="15" step="1"></label><label class="check"><input id="scheduleContrast" type="checkbox" checked>グレースケール・コントラスト補正</label><p>複数画像には同じ補正を適用します。向きが異なる場合は別々に読み込んでください。</p><div id="scheduleOcrProgress"></div><button id="scheduleRun" class="btn">OCRを実行</button><button id="scheduleManual" class="btn secondary">OCRを使わず手動入力</button>`);
  const dialog=$('#modal'),preview=$('#schedulePreview');preview.src=urls[0];
  function cleanup(){closed=true;token++;urls.forEach(u=>URL.revokeObjectURL(u));if(worker)worker.terminate().catch(()=>{});dialog.removeEventListener('close',cleanup)}
  dialog.addEventListener('close',cleanup);
  function review(p){cleanup();scheduleReviewDialog(vendorId,p,files.map(f=>f.name).join(', '))}
  $('#scheduleRotate').onclick=()=>{angle=(angle+90)%360;preview.style.transform=`rotate(${angle}deg)`};
  $('#scheduleManual').onclick=()=>review(parseScheduleOcr('',new Date().getFullYear()));
  $('#scheduleRun').onclick=async()=>{
    const mine=++token,progress=$('#scheduleOcrProgress'),rotation=angle+(+$('#scheduleTilt').value||0),contrast=$('#scheduleContrast').checked;
    $('#scheduleRun').disabled=true;const results=[];let failure='';
    const timeout=(p,ms)=>{let timer;return Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('時間切れ')),ms))]).finally(()=>clearTimeout(timer))};
    try{
      if(!window.Tesseract)await timeout(loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'),30000);
      if(closed||mine!==token)return;
      const creating=Tesseract.createWorker('jpn+eng',1,{logger:m=>{if(!closed&&m.status)progress.textContent=`読み取り中 ${Math.round((m.progress||0)*100)}%`}});
      creating.then(w=>{if(closed||mine!==token)w.terminate().catch(()=>{})}).catch(()=>{});
      worker=await timeout(creating,90000);
      if(closed||mine!==token){await worker.terminate();return}
      for(let i=0;i<files.length;i++){
        const canvas=await prepareScheduleImage(urls[i],rotation,contrast);
        const attempts=[];
        for(const psm of ['3','11']){
          await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
          const r=await timeout(worker.recognize(canvas),90000);attempts.push(r.data);
          if(closed||mine!==token)return;
        }
        const score=d=>Math.max(parseScheduleOcr(d.text,new Date().getFullYear()).entries.length,scheduleGeometry(d,detectScheduleYear(d.text,new Date().getFullYear())).length);
        attempts.sort((a,b)=>score(b)-score(a));results.push(attempts[0]);
        results[results.length-1].allRaw=attempts.map((d,n)=>`【画像${i+1} 読取候補${n+1}】\n${d.text||''}`).join('\n');
      }
    }catch(err){failure=`OCRを完了できませんでした（${err.message||'読取エラー'}）。不足分は手動入力できます。`}
    if(closed||mine!==token)return;
    const raw=results.map(d=>d.text||'').join('\n\n'),p=parseScheduleOcr(raw,new Date().getFullYear());
    const candidates=results.flatMap(d=>{const q=parseScheduleOcr(d.text||'',p.year);const g=scheduleGeometry(d,q.year);return g.length>=q.entries.length?g:q.entries});
    p.entries=cleanScheduleEntries(candidates);p.warnings.push('画像の位置から推定した候補を含みます。抜け・誤認識を全行確認してください。');if(failure)p.warnings.push(failure);
    p.otherRaw=results.map(d=>d.allRaw||d.text||'').join('\n\n');review(p);
  };
}
async function prepareScheduleImage(url,degrees,contrast){
  const img=new Image();img.src=url;await img.decode();
  const scale=Math.min(2,2400/Math.max(img.width,img.height)),w=img.width*scale,h=img.height*scale,r=degrees*Math.PI/180;
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(Math.abs(w*Math.cos(r))+Math.abs(h*Math.sin(r)));canvas.height=Math.ceil(Math.abs(w*Math.sin(r))+Math.abs(h*Math.cos(r)));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(r);ctx.drawImage(img,-w/2,-h/2,w,h);
  if(contrast){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4){const a=pixels.data,v=Math.max(0,Math.min(255,((a[i]*.299+a[i+1]*.587+a[i+2]*.114)-128)*1.5+128));a[i]=a[i+1]=a[i+2]=v}ctx.putImageData(pixels,0,0)}
  return canvas;
}

function scheduleViewDialog(vendorId){
  const v=V(vendorId);if(!v)return;const list=(v.scheduleEntries||[]).slice().sort((a,b)=>a.orderDate.localeCompare(b.orderDate)||String(a.classKey).localeCompare(String(b.classKey)));
  modal(`<h2>${esc(v.name)}：日付スケジュール</h2><p><span class="master-badge">${esc(vendorScheduleSummary(v))}</span></p>${v.scheduleSourceName?`<p class="schedule-source">元画像：${esc(v.scheduleSourceName)}</p>`:""}${v.scheduleNote?`<div class="schedule-warn">${esc(v.scheduleNote)}</div>`:""}<div class="section">発注期限 → 納品日</div>${list.length?list.map(x=>`<div class="task"><div><strong>${esc(scheduleClassLabel(x.classKey||"standard"))}</strong><br>${esc(x.orderDate)} → ${esc(x.deliveryDate)}</div></div>`).join(""):'<div class="notice">日付データなし</div>'}<div style="height:10px"></div><div class="grid2"><button class="btn" id="schedulePhoto">写真から読み込む</button><button class="btn secondary" id="scheduleManual">日付を手動入力・編集</button></div><div style="height:10px"></div><button class="btn secondary full" id="clearDatedSchedule">通常ルール方式へ戻す</button>`);
  $("#schedulePhoto").onclick=async()=>{if(await requireAdmin("紙スケジュールを読み込む")){SCHEDULE_VENDOR_ID=vendorId;$("#scheduleOcrFiles").click()}};
  $("#scheduleManual").onclick=async()=>{if(await requireAdmin("紙スケジュールを手動入力・編集"))scheduleReviewDialog(vendorId,{entries:clone(v.scheduleEntries||[]),year:today().getFullYear(),yearReason:"対象年と日付を確認してください",rawText:"",warnings:[],note:v.scheduleNote||""},v.scheduleSourceName||"手動入力")};
  $("#clearDatedSchedule").onclick=async()=>{if(!(await requireAdmin("紙スケジュール方式を解除")))return;if(!confirm("日付データを残したまま通常ルールへ戻しますか？"))return;checkpoint("紙スケジュール方式解除前");v.scheduleMode="rule";ROOT.masterVersion++;syncMasterToProfiles();save("通常ルール方式へ変更");$("#modal").close()};
}
$("#scheduleOcrFiles").addEventListener("change",async e=>{
  const vendorId=SCHEDULE_VENDOR_ID;SCHEDULE_VENDOR_ID=null;const files=Array.from(e.target.files||[]);e.target.value="";
  if(!vendorId||!files.length)return;
  scheduleImportDialog(vendorId,files);
});
function loadScript(src){return new Promise((ok,ng)=>{let x=document.createElement("script");x.src=src;x.onload=ok;x.onerror=ng;document.head.appendChild(x)})}
$("#ocrFiles").addEventListener("change",e=>{const files=[...e.target.files];e.target.value="";if(files.length)screenshotProductImport(files)});
function validateDomRow(r){
  if(!r||typeof r.code!=='string'||!/^\d{7,13}$/.test(r.code)||typeof r.codeRaw!=='string'||r.codeRaw.trim()!==r.code)throw Error('商品コード不一致・空欄・桁数不正');
  if(!Array.isArray(r.cells)||r.cells.length!==6||r.cells.some(c=>typeof c.text!=='string')||r.cells[0].text.trim()!==r.code)throw Error('元の行と商品コードが一致しません');
  for(const [key,index] of [['name',1],['specification',2],['priceDisplay',3],['unitDisplay',4],['vendorDisplay',5]])if(typeof r[key]!=='string'||r[key]!==r.cells[index].text)throw Error('元の表示と項目が一致しません');
  if(!r.name.trim()||!r.vendorDisplay.trim())throw Error('商品名・取引先が空欄です');
  return r;
}
function readDomPackage(pkg){
  if(pkg?.type!=='infomartOrderNav.domMaster'||pkg.schemaVersion!==1||pkg.contract!=='slip-summary-a/six-cells/v1'||pkg.source?.origin!=='https://www2.infomart.co.jp'||pkg.source?.path!=='/trade/order_my_catalog.page'||!Array.isArray(pkg.rows)||pkg.rows.length>2000)throw Error('拡張機能の商品取り込みJSONではありません');
  const counts=new Map();pkg.rows.forEach(r=>counts.set(r?.code,(counts.get(r?.code)||0)+1));
  return pkg.rows.map(r=>{try{validateDomRow(r);if(counts.get(r.code)!==1)throw Error('ファイル内の商品コードが重複');return {row:r}}catch(e){return {row:r,error:e.message}}});
}
// Render only explicitly allowed inert nodes and CSS values, never imported HTML.
function renderDomTree(t,depth=0){
  if(typeof t==='string')return document.createTextNode(t);
  if(!t||depth>20)return document.createTextNode('');
  const el=document.createElement(['br','span','div','p','b','strong','small','em','sup','sub'].includes(t.tag)?t.tag:'span');
  if(t.quantitySlot===true)el.dataset.quantitySlot='true';
  for(const [k,v] of Object.entries(t.style||{})){
    if(['color','background-color','border-top-color','border-bottom-color'].includes(k)&&/^(#[0-9a-f]{3,8}|rgba?\([\d.,% ]+\)|transparent|[a-z]{1,20})$/i.test(v))el.style.setProperty(k,v);
    if(['font-size','border-top-width','border-bottom-width','padding-top','padding-right','padding-bottom','padding-left'].includes(k)&&/^\d{1,2}(\.\d+)?px$/.test(v))el.style.setProperty(k,v);
    if(k==='font-weight'&&/^(normal|bold|[1-9]00)$/.test(v))el.style.setProperty(k,v);
    if(k==='text-align'&&/^(left|right|center|start)$/.test(v))el.style.setProperty(k,v);
    if(['border-top-style','border-bottom-style'].includes(k)&&/^(none|solid|dotted|dashed)$/.test(v))el.style.setProperty(k,v);
  }
  (Array.isArray(t.children)?t.children.slice(0,1000):[]).forEach(c=>el.appendChild(renderDomTree(c,depth+1)));return el;
}
function showDomRow(row,container){
  const wrap=document.createElement('div');wrap.className='ifm-row-scroll';
  const table=document.createElement('table');table.className='ifm-source-row';const tr=table.insertRow();
  row.cells.forEach((c,i)=>{const td=tr.insertCell();td.style.width=Math.max(i===0?110:70,Math.min(500,Number(c.width)||120))+'px';if(i===0)td.style.whiteSpace='nowrap';
    // Text is authoritative. A presentation tree is used only if it carries identical text.
    const tree=renderDomTree(c.tree);
    const canonical=s=>s.replace(/\s/g,'');
    if(canonical(tree.textContent)===canonical(c.text)){td.appendChild(tree)}else td.textContent=c.text;
    if(i===4){td.style.background='#e6ffc4';td.dataset.quantityCell='true';td.title='通常数量（現在利用者の設定）'}
  });wrap.appendChild(table);container.appendChild(wrap);
}
function vendorOptions(){return '<option value="">発注先マスターを選択</option>'+ROOT.commonMaster.vendors.map(v=>`<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}
function importTransaction(action){
  const before=clone(ROOT),stored=localStorage.getItem(ROOT_KEY);
  try{action()}catch(err){ROOT=before;S=activeProfile().data;try{if(stored!==null)localStorage.setItem(ROOT_KEY,stored)}catch(_){}render();throw Error('保存できませんでした。追加を取り消しました。バックアップ後に空き容量を確認してください。 '+err.message)}
}
function domImportDialog(){
  modal('<h2>Infomartの商品行を取り込む</h2><p>① ログイン済み商品一覧で拡張の「商品マスターへ取り込む」を押す。<br>② 保存されたJSONをここで選択。ページごとに繰り返せます。</p><input id="domFiles" type="file" accept=".json,application/json" multiple><p>元の文字は読み取り専用です。登録済みコードは上書きせずスキップします。</p>');
  $('#domFiles').onchange=async e=>{
    const files=[...e.target.files];if(!files.length)return;
    try{const entries=[],reports=[];for(const f of files){if(f.size>15*1024*1024)throw Error('ファイルが大きすぎます');const pkg=JSON.parse(await f.text());entries.push(...readDomPackage(pkg));reports.push(`${f.name}：抽出時の除外 ${(pkg.failures||[]).length}行`)}domMasterReview(entries,reports)}catch(err){alert('取り込めません：'+err.message)}
  };
}
function domMasterReviewBase(entries,reports){
  const profileId=ACTIVE_ID,seen=new Set(ROOT.commonMaster.products.map(p=>p.code));let skipped=0;
  const items=entries.map(e=>{if(!e.error&&seen.has(e.row.code)){skipped++;return {...e,skip:true}}if(!e.error)seen.add(e.row.code);return e});
  modal(`<h2>商品マスターへ取り込む</h2><p>${esc(reports.join(" / "))}</p><p>重複スキップ ${skipped}件 ／ FAIL-CLOSED ${items.filter(x=>x.error).length}件</p><p class="muted">チェックしていない商品は完全に無視します。チェックした商品だけ、発注先と数量を確認して登録します。</p><div id="domGroups"></div><div id="domRows"></div><p id="domResult" role="status"></p>
    <div class="dom-sticky-bar"><strong id="domSelectedCount">選択中 0件</strong><select id="domBulkVendor" aria-label="選択中の商品へ発注先を一括割当">${vendorOptions()}</select><button class="btn" id="saveDomMasterTop">選択した商品を登録</button><button class="btn secondary small" id="clearDomSelection">選択解除</button></div>`);
  $("#modal").classList.add("ifm-wide");$("#modal").addEventListener("close",()=>$("#modal").classList.remove("ifm-wide"),{once:true});
  const updateSelection=()=>{const n=$$("[data-dom-c]:checked").length;const el=$("#domSelectedCount");if(el)el.textContent=`選択中 ${n}件`};
  const clearErrors=()=>$$(".dom-error-card").forEach(x=>x.classList.remove("dom-error-card"));
  const focusError=(i,msg)=>{clearErrors();const card=$(`#domCard-${i}`);card?.classList.add("dom-error-card");$("#domResult").textContent=msg;card?.scrollIntoView({behavior:"smooth",block:"center"})};

  const groups=[...new Set(items.filter(x=>!x.error&&!x.skip).map(x=>x.row.vendorDisplay))];
  groups.forEach(text=>{
    const label=document.createElement("label");label.className="field dom-group-assign";
    const title=document.createElement("span");title.textContent="同じ取引先表示へ一括割当："+text;
    const select=document.createElement("select");select.innerHTML=vendorOptions();
    select.onchange=()=>items.forEach((x,i)=>{const check=$(`[data-dom-c="${i}"]`);if(x.row?.vendorDisplay===text&&check?.checked&&$(`[data-dom-v="${i}"]`))$(`[data-dom-v="${i}"]`).value=select.value});
    label.append(title,select);$("#domGroups").appendChild(label)
  });

  items.forEach((x,i)=>{
    const card=document.createElement("section");card.className="card dom-import-card";card.id=`domCard-${i}`;
    const status=document.createElement("p");status.textContent=x.error?"FAIL-CLOSED："+x.error:x.skip?"登録済み／重複のためスキップ："+x.row.code:"商品コード "+x.row.code;card.appendChild(status);
    if(x.error){$("#domRows").appendChild(card);return}
    showDomRow(x.row,card);
    if(!x.skip){
      const input=document.createElement("input");input.type="number";input.min="0";input.step="any";input.value="0";input.dataset.domQ=i;input.setAttribute("aria-label","通常数量 "+x.row.code);input.style.cssText="width:80px;padding:3px;background:white;color:black;font-size:14px";
      const slot=card.querySelector("[data-quantity-slot]");if(slot)slot.replaceWith(input);else card.querySelector("[data-quantity-cell]").prepend(input);
      const controls=document.createElement("div");controls.className="ifm-controls";
      controls.innerHTML=`<label class="dom-check"><input type="checkbox" data-dom-c="${i}"> この行を追加</label><label>紐付け先 <select data-dom-v="${i}">${vendorOptions()}</select></label><button class="btn secondary small" type="button" data-dom-save-one="${i}">この商品だけ登録</button>`;
      card.appendChild(controls);
      $("[data-dom-c]",controls).onchange=updateSelection;
    }
    $("#domRows").appendChild(card)
  });

  const selectedIndices=()=>$$("[data-dom-c]:checked").map(c=>+c.dataset.domC);
  const saveDomSelection=async indices=>{
    const result=$("#domResult");result.textContent="";clearErrors();
    try{
      if(!indices.length)throw Error("追加する商品にチェックしてください。");
      if(ACTIVE_ID!==profileId)throw Error("利用者が変わりました。取り込みを開き直してください。");
      const selected=[];
      for(const i of indices){
        const x=items[i],vendorId=$(`[data-dom-v="${i}"]`)?.value||"",qty=$(`[data-dom-q="${i}"]`)?.value??"";
        validateDomRow(x.row);
        if(!ROOT.commonMaster.vendors.some(v=>v.id===vendorId)){focusError(i,"このチェック済み商品の発注先を選んでください。");return}
        if(qty===""||!Number.isFinite(+qty)||+qty<0||+qty>Number.MAX_SAFE_INTEGER){focusError(i,"このチェック済み商品の通常数量を確認してください。");return}
        selected.push({row:x.row,vendorId,qty});
      }
      if(!(await requireAdmin("DOMの商品を共通マスターへ追加")))return;
      checkpoint("DOM商品追加前");let n=0,duplicates=0;const added=new Set();
      importTransaction(()=>{
        for(const x of selected){if(ROOT.commonMaster.products.some(p=>p.code===x.row.code)){duplicates++;continue}ROOT.commonMaster.products.push({id:uid(),code:x.row.code,name:x.row.name,vendorId:x.vendorId,leadDaysOverride:null,scheduleClass:"standard",allowDecimalQty:false,domSource:clone(x.row)});added.add(x.row.code);n++}
        if(n){ROOT.masterVersion++;syncMasterToProfiles();for(const x of selected){const p=S.products.find(p=>p.code===x.row.code);if(p&&added.has(x.row.code))p.defaultQty=+x.qty}save("DOM商品追加")}
      });
      $("#modal").close();alert(`${n}件追加／登録済み ${duplicates}件スキップ。チェックしていない商品には変更していません。`);
    }catch(err){result.textContent=err.message}
  };

  $("#saveDomMasterTop").onclick=()=>saveDomSelection(selectedIndices());
  $("#clearDomSelection").onclick=()=>{$$("[data-dom-c]:checked").forEach(c=>c.checked=false);updateSelection()};
  $("#domBulkVendor").onchange=e=>{const v=e.target.value;if(!v)return;for(const i of selectedIndices()){const s=$(`[data-dom-v="${i}"]`);if(s)s.value=v}};
  $$("[data-dom-save-one]").forEach(b=>b.onclick=()=>{const i=+b.dataset.domSaveOne;const check=$(`[data-dom-c="${i}"]`);if(check)check.checked=true;updateSelection();saveDomSelection([i])});
  updateSelection();
}
const domStyle=document.createElement('style');domStyle.textContent='.modal.ifm-wide{width:calc(100vw - 32px);max-width:1400px}.ifm-row-scroll{overflow-x:auto}.ifm-source-row{border-collapse:collapse;table-layout:fixed;min-width:940px;background:white;color:#222;font-size:14px}.ifm-source-row td{border:1px solid #ccc;vertical-align:top;padding:6px;white-space:pre-wrap;overflow-wrap:anywhere}.ifm-controls{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-top:12px}.ifm-controls input[type=number]{width:100px}.ifm-controls input[type=checkbox]{width:auto}.dom-sticky-bar{position:sticky;bottom:0;z-index:5;display:grid;grid-template-columns:auto minmax(220px,1fr) auto auto;gap:8px;align-items:center;background:#f5f9ff;border:2px solid #a9c9ee;border-radius:14px;padding:10px;box-shadow:0 -5px 18px #102a4318}.dom-error-card{border:3px solid #d92d20!important;background:#fff5f4!important}.dom-check{font-weight:900}@media(max-width:760px){.dom-sticky-bar{grid-template-columns:1fr}.dom-sticky-bar>*{width:100%}}';document.head.appendChild(domStyle);

async function fetchInitialMaster(){
  try{
    const r=await fetch("./initial_master.json",{cache:"no-store"});
    if(r.ok){const o=await r.json();if(o?.type==="infomartOrderNav.initialMaster")BUNDLED_INITIAL_MASTER=o}
  }catch(_){}
}
function activity(){lastActivity=Date.now()}
["mousemove","mousedown","keydown","touchstart","scroll"].forEach(ev=>window.addEventListener(ev,activity,{passive:true}));
setInterval(()=>{if(Date.now()-lastActivity>IDLE_MS&&!$("#modal")?.open){ADMIN_UNTIL=0;view="home";render();userSelector(true);lastActivity=Date.now()}},30000);

function adminButton(){return adminActive()?"🔓":"🔒"}
$("#profileBtn").onclick=()=>userSelector(false);
$("#adminBtn").onclick=async()=>{if(adminActive())logoutAdmin();else await requireAdmin("管理者モードを開始")};
$("#settingsBtn").onclick=()=>{view=view==="settings"?"home":"settings";render()};

fetchInitialMaster();
autoSnapshot("起動時",false);
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
render();
setTimeout(()=>userSelector(true),250);

async function screenshotProductImport(files){
  const profileId=ACTIVE_ID;let closed=false,worker=null;
  modal('<h2>Infomart商品表のスクショ読取</h2><p>表の行と列を検出してから項目別に読み取ります。表全幅・罫線・薄緑の数量欄が写った画像を使用してください。欠けた行や対応しないレイアウトは登録しません。</p><p id="tableProgress" role="status">表を検出中…</p>');
  const progress=$('#tableProgress'),dialog=$('#modal');
  const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('読取タイムアウト')),ms)})]).finally(()=>clearTimeout(timer))};
  const cancel=()=>{closed=true;if(worker)worker.terminate().catch(()=>{})};dialog.addEventListener('close',cancel,{once:true});
  const items=[],reports=[];
  try{
    if(files.length>30)throw Error('一度に30枚まで選択してください');
    for(let page=0;page<files.length&&!closed;page++){
      const f=files[page];if(f.size>20*1024*1024){reports.push(f.name+'：20MB超のため除外');continue}
      const url=URL.createObjectURL(f),img=new Image();try{img.src=url;await img.decode()}finally{URL.revokeObjectURL(url)}
      if(img.naturalWidth*img.naturalHeight>16000000){reports.push(f.name+'：画像サイズ過大');continue}
      const source=document.createElement('canvas');source.width=img.naturalWidth;source.height=img.naturalHeight;source.getContext('2d').drawImage(img,0,0);
      const rows=InfomartTableOCR.detect(source.getContext('2d').getImageData(0,0,source.width,source.height));
      reports.push(f.name+'：完全な商品行 '+rows.length+'件（検出できない行は除外）');
      if(!rows.length)continue;
      if(!worker){
        if(!window.Tesseract)await bounded(loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'),30000);
        if(closed)break;
        const creating=Tesseract.createWorker('jpn+eng',1);creating.then(w=>{if(closed)w.terminate().catch(()=>{})},()=>{});
        worker=await bounded(creating,60000);
        if(closed)break;
      }
      for(let ri=0;ri<rows.length&&!closed;ri++){
        if(items.length>=200)throw Error('一度に200行までです。画像を分けてください');
        const row=rows[ri],raw={},confidence={};let codeCheck;
        progress.textContent=`画像 ${page+1}/${files.length}・商品行 ${ri+1}/${rows.length} を項目別に読取中`;
        for(let fi=0;fi<4&&!closed;fi++){
          // No digit whitelist: it could silently remove a URL/price prefix.
          await worker.setParameters({tessedit_pageseg_mode:fi===0?'7':'6',preserve_interword_spaces:'1'});
          const result=(await bounded(worker.recognize(InfomartTableOCR.crop(source,row.cells[fi],3)),90000)).data;
          const key=InfomartTableOCR.fields[fi];raw[key]=result.text;confidence[key]=Number(result.confidence)||0;
          if(fi===0){await worker.setParameters({tessedit_pageseg_mode:'6'});const again=(await bounded(worker.recognize(InfomartTableOCR.crop(source,row.cells[fi],2)),90000)).data;codeCheck=InfomartTableOCR.codeResult(result,again)}
        }
        if(closed)break;
        items.push({code:codeCheck.text,name:raw.name,specification:raw.specification,vendorDisplay:raw.vendorDisplay,codeValid:codeCheck.valid&&codeCheck.confidence>=85,confidence:{...confidence,code:codeCheck.confidence},raw,codeReason:codeCheck.reason,image:InfomartTableOCR.crop(source,row).toDataURL('image/png'),file:f.name,row:ri+1,geometry:row,manual:{}});
      }
    }
    if(!closed){dialog.removeEventListener('close',cancel);screenshotReview(items,reports,profileId)}
  }catch(e){if(!closed)progress.textContent='読取を停止しました：'+e.message+'。登録は行っていません。';closed=true}
  finally{if(worker)await worker.terminate().catch(()=>{})}
}
function screenshotReview(items,reports,profileId){
  modal(`<h2>元の商品行を確認して仮登録</h2><p>${esc(reports.join(' ／ '))}</p><p>画像が正本です。表示文字はOCR候補です。元画像と照合し、誤りがあれば手修正してください。「確認して登録」にチェックすると、表示中の全項目を確認した扱いになります。コードの読取不一致・低信頼は、元画像で確認してコード欄を入力し直すまで登録できません。</p><p>通常数量0・自動予定停止で仮登録します。PCのDOM取り込みで完全一致するコードの正式表示を後から補完できます。</p><div id="tableRows"></div><p id="tableResult" role="status"></p><button class="btn full" id="saveTableRows">選択した商品を仮登録</button>`);
  const controls=[];
  items.forEach((item,i)=>{
    const card=document.createElement('section');card.className='card';
    const title=document.createElement('p');title.textContent=`${item.file} ／ 商品行 ${item.row}`;
    const image=document.createElement('img');image.src=item.image;image.alt='元スクショの商品行（'+item.file+'・'+item.row+'行）';image.style.cssText='width:100%;height:auto;min-width:650px';
    const imageWrap=document.createElement('div');imageWrap.style.overflowX='auto';imageWrap.append(image);
    const status=document.createElement('p');status.setAttribute('role','status');
    card.append(title,imageWrap,status);
    const inputs={};const labels={code:'商品コード',name:'商品名',specification:'規格・単位',vendorDisplay:'取引先の元表示'};
    for(const key of InfomartTableOCR.fields){
      const label=document.createElement('label');label.className='field';const text=document.createElement('span');text.textContent=labels[key]+` — ${item.confidence[key]<85?'要確認（低信頼）':'要確認'} / OCR信頼度 ${Math.round(item.confidence[key])}%`;
      const input=document.createElement(key==='code'?'input':'textarea');input.value=item[key];if(key==='code'){input.inputMode='numeric';input.autocomplete='off'}
      input.addEventListener('input',()=>{item[key]=input.value;item.manual[key]=true;if(key==='code')item.codeValid=/^\d{7,13}$/.test(input.value);controls.forEach(c=>c.check.checked=false);refresh()});
      inputs[key]=input;label.append(text,input);card.append(label);
    }
    const actions=document.createElement('div');actions.className='ifm-controls';actions.innerHTML=`<label><input type="checkbox" data-table-check="${i}"> 元画像と全項目を確認して登録</label><label>通常数量 <input type="number" min="0" step="any" value="0" data-table-qty="${i}"></label><label>発注先マスター <select data-table-vendor="${i}">${vendorOptions()}</select></label>`;
    card.append(actions);$('#tableRows').append(card);controls.push({status,inputs,check:actions.querySelector('[type=checkbox]'),qty:actions.querySelector('[type=number]'),vendor:actions.querySelector('select')});
  });
  function refresh(){const states=InfomartTableOCR.classify(items,ROOT.commonMaster.products.map(p=>p.code));states.forEach((state,i)=>{controls[i].status.textContent=state;controls[i].check.disabled=!state.startsWith('要確認');if(controls[i].check.disabled)controls[i].check.checked=false});return states}refresh();
  if(!items.length)$('#tableResult').textContent='対応する完全な商品行がありません。表の左右端と行の上下罫線が写ったスクショを選んでください。PCではDOM取り込みを利用できます。';
  $('#saveTableRows').onclick=async()=>{
    const result=$('#tableResult'),button=$('#saveTableRows');button.disabled=true;
    try{
      if(ACTIVE_ID!==profileId)throw Error('利用者が変わりました。取り込みを開き直してください');
      const selected=controls.map((c,i)=>c.check.checked?i:-1).filter(i=>i>=0);if(!selected.length)throw Error('元画像を確認し、登録する行にチェックしてください');
      const states=InfomartTableOCR.classify(items,ROOT.commonMaster.products.map(p=>p.code));
      for(const i of selected){const c=controls[i];if(!states[i].startsWith('要確認'))throw Error(states[i]);if(!ROOT.commonMaster.vendors.some(v=>v.id===c.vendor.value))throw Error('発注先マスターを選択してください');if(c.qty.value===''||!Number.isFinite(+c.qty.value)||+c.qty.value<0||+c.qty.value>Number.MAX_SAFE_INTEGER)throw Error('通常数量を確認してください')}
      if(!(await requireAdmin('商品行画像とOCR候補を共通マスターへ仮登録')))return;
      if(ACTIVE_ID!==profileId)throw Error('利用者が変わりました');
      const before=clone(ROOT);checkpoint('商品表スクショ仮登録前');
      try{
        for(const i of selected){const x=items[i],c=controls[i];if(ROOT.commonMaster.products.some(p=>p.code===x.code))throw Error('登録中にコードが重複しました');ROOT.commonMaster.products.push({id:uid(),code:x.code,name:x.name,specification:x.specification,vendorDisplay:x.vendorDisplay,vendorId:c.vendor.value,leadDaysOverride:null,scheduleClass:'standard',allowDecimalQty:false,imageSource:x.image,codeAuthority:'image-reviewed-provisional',screenshotSource:{schemaVersion:1,file:x.file,row:x.row,geometry:x.geometry,raw:x.raw,confidence:x.confidence,manual:x.manual,reviewedAt:new Date().toISOString()},domSyncStatus:'pending'})}
        ROOT.masterVersion++;syncMasterToProfiles(false);for(const i of selected){const p=S.products.find(p=>p.code===items[i].code);p.defaultQty=+controls[i].qty.value;p.active=false;p.confirmed=false}save('商品表スクショ仮登録');
      }catch(e){ROOT=before;S=activeProfile().data;throw Error('保存できませんでした（空き容量を含め確認してください）：'+e.message)}
      $('#modal').close();alert(`${selected.length}件を画像付きで仮登録しました。DOM未照合・自動予定停止です。`);
    }catch(e){result.textContent=e.message;refresh()}finally{button.disabled=false}
  };
}



// Reconcile only screenshot-provisional products, by exact code, preserving personal settings.
function planScreenshotDomSync(entries,products){
  const updates=[],errors=[];
  for(const p of products.filter(p=>p.domSyncStatus==='pending'||p.codeAuthority==='manual-image-unverified')){
    const matches=entries.filter(e=>e.row?.code===p.code);if(!matches.length)continue;
    if(products.filter(x=>x.code===p.code).length!==1||matches.some(e=>e.error)){errors.push(p.code+'：コード重複・抽出エラー');continue}
    try{matches.forEach(e=>validateDomRow(e.row))}catch(e){errors.push(p.code+'：'+e.message);continue}
    const row=matches[0].row;
    if(matches.some(e=>['name','specification','priceDisplay','unitDisplay','vendorDisplay'].some(k=>e.row[k]!==row[k]))){errors.push(p.code+'：ページ間のDOM表示不一致');continue}
    updates.push({id:p.id,row});
  }
  return {updates,errors};
}
async function domMasterReview(entries,reports){
  const profileId=ACTIVE_ID,plan=planScreenshotDomSync(entries,ROOT.commonMaster.products);
  if(plan.errors.length)reports.push('照合FAIL-CLOSED：'+plan.errors.join(' ／ '));
  if(plan.updates.length){
    if(!(await requireAdmin('仮登録商品の完全一致コードをDOM正式表示で補完')))return;
    if(ACTIVE_ID!==profileId){alert('利用者が変わりました。取り込みを開き直してください');return}
    const before=clone(ROOT);checkpoint('仮登録商品のDOM照合前');
    try{
      for(const u of plan.updates){const p=ROOT.commonMaster.products.find(p=>p.id===u.id);if(!p||p.code!==u.row.code)throw Error('照合中に商品コードが変わりました');
        p.screenshotReviewBeforeDom={name:p.name,specification:p.specification||'',vendorDisplay:p.vendorDisplay||''};
        Object.assign(p,{name:u.row.name,specification:u.row.specification,vendorDisplay:u.row.vendorDisplay,domSource:clone(u.row),domSyncStatus:'matched',codeAuthority:'dom-exact',domMatchedAt:new Date().toISOString()});
      }
      ROOT.masterVersion++;syncMasterToProfiles(false);save('仮登録商品のDOM完全一致照合');reports.push('仮登録からDOM正式表示へ補完 '+plan.updates.length+'件（数量・発注先割当・個人設定を維持）');
    }catch(e){ROOT=before;S=activeProfile().data;alert('DOM補完は保存できませんでした：'+e.message);return}
  }
  domMasterReviewBase(entries,reports);
}


})();