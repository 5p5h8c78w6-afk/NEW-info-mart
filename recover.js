/* Recovery helper: no analytics, storage, automatic requests, or database APIs. */
(function(root){
  'use strict';
  const BASE='https://wgsoxtphhclgdqcomnpd.supabase.co';
  const OWNER='b0d3d5ec-c90d-4161-b859-390745711b74';
  function parseLink(value){
    let u; try{u=new URL(value.trim());}catch{throw Error('メール内のリンクをコピーして貼り付けてください。');}
    if(u.origin!==BASE||u.username||u.password||u.pathname!=='/auth/v1/verify'||u.hash||
       u.searchParams.getAll('type').length!==1||u.searchParams.get('type')!=='recovery'||
       u.searchParams.getAll('token').length!==1||! /^[A-Za-z0-9_-]{20,512}$/.test(u.searchParams.get('token')||'')){
      throw Error('対象プロジェクトの未使用のパスワード再設定リンクが必要です。');
    }
    return u.searchParams.get('token');
  }
  function checkKey(value){
    const key=value.trim();
    if(/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key))return key;
    try{const s=key.split('.');if(s.length!==3)throw Error();const p=s[1].replace(/-/g,'+').replace(/_/g,'/');
      const data=JSON.parse(atob(p+'='.repeat((4-p.length%4)%4)));
      if(data.role==='anon'&&data.ref==='wgsoxtphhclgdqcomnpd')return key;
    }catch{}
    throw Error('対象のPublishable keyまたはanon keyを入力してください。Secret / service_roleは使えません。');
  }
  function createClient(fetcher){
    let key='',token='';
    function clear(){key='';token='';}
    async function request(path,method,body,bearer){
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
      try{
        const headers={apikey:key,'Content-Type':'application/json'};if(bearer)headers.Authorization='Bearer '+bearer;
        const r=await fetcher(BASE+'/auth/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
        if(!r.ok)throw Error(path==='/verify'?'リンクが期限切れ・使用済み、または本人確認に失敗しました。':method==='PUT'?'変更できませんでした。パスワードの条件や再認証の必要性を確認してください。':'利用者を確認できませんでした。');
        return await r.json();
      }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('通信を確認できません。変更ボタンを押した後なら、新しいパスワードでのログイン結果を先に確認してください。');throw e;}
      finally{clearTimeout(timer);}
    }
    async function verify(publicKey,link){
      clear();key=checkKey(publicKey);const hash=parseLink(link);
      try{
        const data=await request('/verify','POST',{token_hash:hash,type:'recovery'});
        if(!data.access_token)throw Error('本人確認情報を取得できませんでした。');
        const user=await request('/user','GET',undefined,data.access_token);
        if(user.id!==OWNER)throw Error('確認済みの所有者と異なるアカウントです。変更しません。');
        token=data.access_token;
        const email=String(user.email||'');const at=email.indexOf('@');
        return at>0?email[0]+'***'+email.slice(at):'確認済みの所有者';
      }catch(e){clear();throw e;}
    }
    async function save(password,repeat){
      if(!token)throw Error('先にリンクで本人確認してください。');
      if(password.length<12||password!==repeat)throw Error('12文字以上で、同じパスワードを2回入力してください。');
      // Always discard session after an attempted update, including an ambiguous network failure.
      try{await request('/user','PUT',{password},token);}finally{clear();}
    }
    return {verify,save,clear};
  }
  if(typeof module==='object'&&module.exports)module.exports={parseLink,checkKey,createClient};
  if(!root.document)return;
  const $=id=>document.getElementById(id),client=createClient(root.fetch.bind(root));let busy=false;
  $('verify').onclick=async()=>{
    if(busy)return;busy=true;$('verify').disabled=true;
    try{const identity=await client.verify($('key').value,$('link').value);$('verifySection').hidden=true;$('passwordSection').hidden=false;$('identity').textContent='変更対象：'+identity;$('status').textContent='本人確認済み。新しいパスワードを入力してください。';$('password').focus();}
    catch(e){$('status').textContent=e.message;}finally{$('key').value='';$('link').value='';busy=false;$('verify').disabled=false;}
  };
  $('save').onclick=async()=>{
    if(busy)return;
    if($('password').value.length<12||$('password').value!==$('repeat').value){$('status').textContent='12文字以上で、同じパスワードを2回入力してください。';return;}
    busy=true;$('save').disabled=true;
    try{await client.save($('password').value,$('repeat').value);$('passwordSection').hidden=true;$('status').textContent='変更が完了しました。iPhoneのパスワード管理に保存し、発注ナビでメールアドレスと新しいパスワードを使ってログインしてください。';}
    catch(e){$('passwordSection').hidden=true;$('verifySection').hidden=false;$('status').textContent=e.message+' 再試行する場合は新しい再設定メールが必要です。';}
    finally{$('password').value='';$('repeat').value='';busy=false;$('save').disabled=false;}
  };
  root.addEventListener('pagehide',()=>{client.clear();for(const id of ['key','link','password','repeat'])$(id).value='';});
  root.addEventListener('pageshow',e=>{if(e.persisted){$('verifySection').hidden=false;$('passwordSection').hidden=true;$('status').textContent='本人確認情報を破棄しました。未使用の新しいリンクが必要です。';}});
})(globalThis);
