(function(root){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const fail=()=>{throw new Error('個人同期データが不正、または共通マスターにない商品があります。設定・プリセットを確認してください。')};
  function keys(x,allowed){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail()}
  function masterIndex(master){
    const ids=new Map(),codes=new Set();
    for(const p of master.products){if(!p.id||typeof p.code!=='string'||!p.code||ids.has(p.id)||codes.has(p.code))fail();ids.set(p.id,p);codes.add(p.code)}
    return ids;
  }
  function validate(payload,master){
    keys(payload,['schema','products','presets']);
    if(payload.schema!==1||!Array.isArray(payload.products)||!Array.isArray(payload.presets))fail();
    const ids=masterIndex(master),seen=new Set(),presets=new Set();
    const ref=x=>{const m=ids.get(x.productId);if(!m||m.code!==x.code)fail();return m};
    const qty=(q,m)=>{if(typeof q!=='number'||!Number.isFinite(q)||q<0||q>1000000000||(m.allowDecimalQty!==true&&!Number.isInteger(q)))fail()};
    for(const p of payload.products){
      keys(p,['productId','code','defaultQty','intervalMode','intervalDays','firstOrderDate']);
      const m=ref(p);if(seen.has(p.productId))fail();seen.add(p.productId);qty(p.defaultQty,m);
      if(!['daily','n'].includes(p.intervalMode)||!Number.isInteger(p.intervalDays)||p.intervalDays<1||p.intervalDays>60||(p.intervalMode==='daily'&&p.intervalDays!==1))fail();
      if(typeof p.firstOrderDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.firstOrderDate))fail();
      const d=new Date(p.firstOrderDate+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==p.firstOrderDate)fail();
    }
    for(const p of payload.presets){
      keys(p,['id','name','items']);if(typeof p.id!=='string'||!p.id||presets.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!Array.isArray(p.items)||!p.items.length)fail();presets.add(p.id);
      const items=new Set();for(const i of p.items){keys(i,['productId','code','qty']);const m=ref(i);if(items.has(i.productId))fail();items.add(i.productId);qty(i.qty,m)}
    }
    return copy(payload);
  }
  function project(data,master){
    const ids=masterIndex(master);
    const payload={schema:1,products:data.products.filter(p=>ids.get(p.id)?.code===p.code).map(p=>({productId:p.id,code:p.code,defaultQty:p.defaultQty,intervalMode:p.intervalMode,intervalDays:p.intervalDays,firstOrderDate:p.firstOrderDate})),presets:data.presets.map(p=>({id:p.id,name:p.name,items:p.items.map(i=>({productId:i.productId,code:ids.get(i.productId)?.code,qty:i.qty}))}))};
    return validate(payload,master);
  }
  function apply(data,payload,master){
    const valid=validate(payload,master),settings=new Map(valid.products.map(p=>[p.productId,p])),next=copy(data);
    next.products=next.products.map(p=>{const v=settings.get(p.id);return v&&p.code===v.code?{...p,defaultQty:v.defaultQty,intervalMode:v.intervalMode,intervalDays:v.intervalDays,firstOrderDate:v.firstOrderDate}:p});
    next.presets=valid.presets.map(p=>({...p,items:p.items.map(i=>({productId:i.productId,qty:i.qty}))}));
    return next;
  }
  const api={validate,project,apply};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PersonalCloud=api;
})(typeof globalThis==='object'?globalThis:this);
