const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../personal-cloud.js'),copy=x=>JSON.parse(JSON.stringify(x));
const master={products:[{id:'p1',code:'00123456789',name:'商品',allowDecimalQty:false}]};
const data={products:[{...master.products[0],defaultQty:2,intervalMode:'n',intervalDays:7,firstOrderDate:'2026-10-03',active:false,confirmed:false}],presets:[{id:'r1',name:'週次',items:[{productId:'p1',qty:4}]}],history:[{key:'h'}],infomartTrade:{days:[{x:1}]},pendingRun:{id:'run'},quantityOverrides:{day:8},settings:{infomartUrl:'local'}};
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),section=source.slice(source.indexOf('// v1.8.0: explicit synchronization'),source.indexOf('function cloudMemberRows(){'));
function harness({remote=null,binding=false,failBackup=false,onRequest=null,failPersist=false}={}){
 const root={cloud:{projectUrl:'https://example.supabase.co',orgId:'org',session:{user:{id:'u1'}}},commonMaster:copy(master),profiles:[{id:'local',name:'利用者',data:copy(data)}]},effects={alerts:[],requests:[],checkpoints:[],renders:0};
 let store='initial',snap=null;let row=copy(remote),version=row?.version||0;
 const context=vm.createContext({ROOT:root,S:root.profiles[0].data,PersonalCloud:core,JSON,Date,Number,Error,uid:()=> 'snapshot',SNAP_KEY:'snap',ROOT_KEY:'root',localStorage:{getItem:k=>k==='root'?store:snap,setItem:(k,v)=>{if(failBackup)throw Error('quota');if(k==='root')store=v;else snap=v}},getSnapshots:()=>[],activeProfile:()=>root.profiles[0],cloudLoggedIn:()=>true,cloudSanitizeProjectUrl:x=>x,cloudEnsureFreshSession:async()=>{},cloudRemoteMasterRow:async()=>({master_version:1,payload:copy(master)}),validateMasterPackage:p=>p,cloudRequest:async(path,opts)=>{effects.requests.push({path,opts});if(onRequest)await onRequest(context,path);if(!opts)return row?[row]:[];if(opts.body.p_expected_version!==version)throw Error('personal_version_conflict');version++;row={user_id:'u1',org_id:'org',version,updated_at:'now',payload:copy(opts.body.p_payload)};return row},persistRoot:()=>{if(failPersist)throw Error('disk');store=JSON.stringify(root)},render:()=>effects.renders++,alert:x=>effects.alerts.push(x),confirm:()=>true,esc:x=>String(x)});
 vm.runInContext(section,context);if(binding)root.profiles[0].personalCloud={identity:context.personalIdentity(),version:1};
 return {context,root,effects,get row(){return row},run:a=>context.personalSync(a),changeStore:()=>{store='other tab'}};
}
const remote={user_id:'u1',org_id:'org',version:1,payload:core.project(data,master),updated_at:'now'};
test('projection exports only four allowed categories; leading zero codes retained',()=>{const p=core.project(data,master);assert.deepEqual(Object.keys(p),['schema','products','presets']);assert.equal(p.products[0].code,'00123456789');assert.equal(JSON.stringify(p).includes('pendingRun'),false);assert.equal('active' in p.products[0],false)});
test('download replaces four fields and presets; preserves all local-only data and flags',()=>{const p=core.project(data,master);p.products[0].defaultQty=9;p.presets=[];const next=core.apply(data,p,master);assert.equal(next.products[0].defaultQty,9);for(const k of ['history','infomartTrade','pendingRun','quantityOverrides','settings'])assert.deepEqual(next[k],data[k]);assert.equal(next.products[0].active,false);assert.deepEqual(data.presets.length,1)});
test('unknown, mismatched, duplicate identities, malformed dates, nonfinite and fractional quantities fail closed',()=>{for(const mutate of [p=>p.products[0].code='wrong',p=>p.products.push(copy(p.products[0])),p=>p.products[0].firstOrderDate='2026-02-30',p=>p.products[0].defaultQty=Infinity,p=>p.products[0].defaultQty=1.1,p=>p.history=[],p=>p.presets[0].items[0].productId='deleted']){const p=core.project(data,master);mutate(p);assert.throws(()=>core.apply(data,p,master))}assert.throws(()=>core.project(data,{products:[...master.products,...master.products]}))});
test('first upload preserves local data; repeated upload uses CAS version and does not rerun migration',async()=>{const h=harness(),before=copy(h.context.S);await h.run('upload');assert.deepEqual(h.context.S,before);assert.equal(h.row.version,1);await h.run('upload');assert.equal(h.row.version,2);assert.equal(h.effects.alerts.length,0);assert.equal(h.effects.requests.filter(x=>x.opts).at(-1).opts.body.p_expected_version,1)});
test('existing cloud blocks first upload and stale bound version; no write or local deletion',async()=>{for(const binding of [false,true]){const h=harness({remote:{...remote,version:2},binding});await h.run('upload');assert.match(h.effects.alerts[0],/personal_version_conflict/);assert.equal(h.effects.requests.filter(x=>x.opts).length,0);assert.deepEqual(h.context.S,data)}});
test('new device explicitly downloads existing cloud into selected profile',async()=>{const h=harness({remote});await h.run('download');assert.equal(h.root.profiles[0].personalCloud.version,1);assert.equal(h.effects.alerts.length,0);assert.deepEqual(h.context.S.history,data.history)});
test('local broken preset does not prevent safe cloud download',async()=>{const h=harness({remote});h.context.S.presets[0].items[0].productId='missing';await h.run('download');assert.equal(h.effects.alerts.length,0);assert.equal(h.context.S.presets[0].items[0].productId,'p1')});
test('account and profile binding mismatch blocks reads and writes',async()=>{const h=harness({binding:true});h.root.cloud.session.user.id='u2';await h.run('upload');assert.equal(h.effects.requests.length,0);assert.match(h.effects.alerts[0],/別のクラウド/)});
test('account changes during request do not attach cloud payload or version',async()=>{const h=harness({remote,onRequest:(c)=>{c.ROOT.cloud.session.user.id='u2'}});await h.run('download');assert.equal(h.root.profiles[0].personalCloud,undefined);assert.deepEqual(h.context.S,data);assert.match(h.effects.alerts[0],/処理中/)});
test('local edits and master changes during request block apply',async()=>{for(const change of [c=>c.S.products[0].defaultQty=77,c=>c.ROOT.commonMaster.products=[]]){const h=harness({remote,onRequest:change});await h.run('download');assert.equal(h.root.profiles[0].personalCloud,undefined);assert.match(h.effects.alerts[0],/処理中/)}});
test('cross-tab storage update blocks reflection',async()=>{let h;h=harness({remote,onRequest:()=>h.changeStore()});await h.run('download');assert.match(h.effects.alerts[0],/処理中/);assert.equal(h.root.profiles[0].personalCloud,undefined)});
test('backup failure and persistence failure preserve local data; no upload when backup fails',async()=>{for(const action of ['upload','download']){const h=harness({remote:action==='download'?remote:null,failBackup:true});await h.run(action);assert.deepEqual(h.context.S,data);assert.equal(h.effects.requests.filter(x=>x.opts).length,0);assert.match(h.effects.alerts[0],/quota/)}const h=harness({remote,failPersist:true});await h.run('download');assert.deepEqual(h.context.S,data);assert.equal(h.root.profiles[0].personalCloud,undefined)});
test('deleted remote product cannot resurrect master or replace local data',async()=>{const h=harness({remote:{...remote,payload:{...remote.payload,products:[{...remote.payload.products[0],productId:'deleted'}]}}});await h.run('download');assert.deepEqual(h.context.S,data);assert.deepEqual(h.root.commonMaster,master);assert.ok(h.effects.alerts.length)});
test('server conflict after preflight preserves local binding and edits',async()=>{const h=harness({onRequest:(c,path)=>{if(path.includes('/rpc/'))throw Error('personal_version_conflict')}});await h.run('upload');assert.equal(h.root.profiles[0].personalCloud,undefined);assert.deepEqual(h.context.S,data)});
test('latest check renders the unregistered result without writing or changing local data',async()=>{
 const h=harness(),before=copy(h.root);await h.run('check');
 assert.match(h.context.personalCloudCard(),/クラウド未登録：初回アップロードできます。/);
 assert.equal(h.effects.alerts.length,0);assert.equal(h.effects.requests.filter(x=>x.opts).length,0);
 assert.equal(h.effects.renders,1);assert.deepEqual(h.root,before);
});
test('latest check renders matching and conflicting cloud versions',async()=>{
 for(const version of [1,2]){const h=harness({remote:{...remote,version},binding:true});await h.run('check');const html=h.context.personalCloudCard();assert.ok(html.includes(`クラウド v${version} / この端末 v1`));assert.equal(html.includes('：差分があります。'),version===2);assert.equal(h.effects.requests.filter(x=>x.opts).length,0)}
});
test('latest check failure appears in the same users card without a write',async()=>{
 const h=harness({onRequest:()=>{throw Error('network_read_failed')}});await h.run('check');
 assert.match(h.context.personalCloudCard(),/network_read_failed/);assert.equal(h.effects.alerts[0],'network_read_failed');assert.deepEqual(h.context.S,data);assert.equal(h.effects.requests.filter(x=>x.opts).length,0);
});
test('upload and download results appear in their users card',async()=>{
 const upload=harness();await upload.run('upload');assert.match(upload.context.personalCloudCard(),/保存済み v1/);
 const download=harness({remote});await download.run('download');assert.match(download.context.personalCloudCard(),/取得済み v1/);
});
test('completed result is hidden after switching account, organization or local profile',async()=>{
 for(const change of [h=>{h.root.cloud.session.user.id='u2'},h=>{h.root.cloud.orgId='other-org'},h=>{h.root.profiles.unshift({id:'other-profile',name:'別利用者',data:copy(data)})}]){
  const h=harness();await h.run('check');change(h);const html=h.context.personalCloudCard();assert.doesNotMatch(html,/クラウド未登録：初回アップロードできます。/);assert.match(html,/未同期：初回アップロード、またはクラウドから取得してください。/);
 }
});
test('account switch during a read does not bind the old request error to the new account',async()=>{
 const h=harness({onRequest:c=>{c.ROOT.cloud.session.user.id='u2'}});await h.run('check');
 assert.match(h.effects.alerts[0],/処理中/);assert.doesNotMatch(h.context.personalCloudCard(),/反映を停止しました/);assert.deepEqual(h.context.S,data);
});
test('cancelling a different account upload does not relabel the prior accounts result',async()=>{
 const h=harness();await h.run('check');h.root.cloud.session.user.id='u2';h.context.confirm=()=>false;await h.run('upload');
 assert.doesNotMatch(h.context.personalCloudCard(),/クラウド未登録：初回アップロードできます。/);assert.equal(h.effects.requests.filter(x=>x.opts).length,0);assert.deepEqual(h.context.S,data);
});
test('account, profile, edits and other-tab changes during final authentication stop the RPC before transport',async()=>{
 for(const change of [h=>{h.root.cloud.session.user.id='u2'},h=>{h.root.profiles.unshift({id:'other',name:'別利用者',data:copy(data)});h.context.S=h.root.profiles[0].data},h=>{h.context.S.products[0].defaultQty=77},h=>h.changeStore()]){
  const h=harness(),sent=[];let authCalls=0;
  h.context.cloudConfigured=()=>true;
  h.context.cloudEnsureFreshSession=async()=>{if(++authCalls===3)change(h)};
  h.context.fetch=async(url,opts)=>{sent.push({url,opts});return {ok:true,text:async()=>JSON.stringify(opts.method==='POST'?{user_id:h.root.cloud.session.user.id,org_id:'org',version:1,updated_at:'now'}:[])}};
  vm.runInContext(source.slice(source.indexOf('async function cloudRequest('),source.indexOf('async function cloudAudit(')),h.context);
  await h.run('upload');
  assert.equal(sent.filter(x=>x.opts.method==='POST').length,0,'changed context must not receive the previous users payload');
  assert.equal(h.root.profiles.some(p=>p.personalCloud),false);
  assert.match(h.effects.alerts[0],/処理中/);
 }
});
test('late refresh success or failure cannot replace or clear a newly selected account',async()=>{
 for(const success of [true,false]){
  let finish,persists=0;
  const oldSession={expires_at:0,refresh_token:'old-refresh',user:{id:'u1'}},nextSession={access_token:'new-access',user:{id:'u2'}};
  const root={cloud:{session:oldSession,orgId:'org',role:'owner',members:['new-member'],stores:['new-store']}};
  const context=vm.createContext({ROOT:root,Date,Error,cloudLoggedIn:()=>true,cloudAuthRaw:()=>new Promise((resolve,reject)=>{finish=()=>success?resolve({access_token:'old-access',user:{id:'u1'}}):reject(Error('refresh_failed'))}),persistRoot:()=>persists++});
  vm.runInContext(source.slice(source.indexOf('function cloudStoreSession('),source.indexOf('async function cloudRequest(')),context);
  const pending=context.cloudEnsureFreshSession();root.cloud.session=nextSession;
  finish();await assert.rejects(pending);
  assert.equal(root.cloud.session,nextSession);assert.equal(root.cloud.orgId,'org');assert.equal(root.cloud.role,'owner');assert.equal(persists,0);
 }
});
test('upload persistence failure restores the previous binding and explains that the server may already be saved',async()=>{
 for(const bound of [false,true]){
  const h=harness({remote:bound?remote:null,binding:bound,failPersist:true}),before=copy(h.root.profiles[0].personalCloud??null);
  await h.run('upload');
  assert.deepEqual(h.root.profiles[0].personalCloud??null,before);
  assert.deepEqual(h.context.S,data);assert.equal(h.row.version,bound?2:1);
  assert.match(h.effects.alerts[0],/端末.*保存|同期情報/);assert.match(h.effects.alerts[0],/確認・取得/);
  assert.doesNotMatch(h.context.personalCloudCard(),/保存済み v/);
 }
});
test('ordinary refresh still succeeds and a failed refresh only clears its own session',async()=>{
 for(const success of [true,false]){
  let persists=0;
  const root={cloud:{projectUrl:'https://example.supabase.co',publicKey:'public',session:{expires_at:0,refresh_token:'refresh',user:{id:'u1'}},orgId:'org',role:'owner',members:[],stores:[]}};
  const context=vm.createContext({ROOT:root,Date,Error,cloudLoggedIn:()=>true,cloudAuthRaw:async()=>{if(!success)throw Error('refresh_failed');return {access_token:'new-access',refresh_token:'next-refresh',expires_in:3600,user:{id:'u1'}}},persistRoot:()=>persists++});
  vm.runInContext(source.slice(source.indexOf('function cloudStoreSession('),source.indexOf('async function cloudRequest(')),context);
  if(success){await context.cloudEnsureFreshSession();assert.equal(root.cloud.session.access_token,'new-access');assert.equal(root.cloud.orgId,'org')}
  else {await assert.rejects(context.cloudEnsureFreshSession(),/refresh_failed/);assert.equal(root.cloud.session,null);assert.equal(root.cloud.orgId,'')}
  assert.equal(persists,1);
 }
});
test('real request transport saves normally and a lost acknowledgement is never automatically retried',async()=>{
 for(const loseReply of [false,true]){
  const h=harness();let row=null,writes=0;
  h.context.cloudConfigured=()=>true;
  h.context.fetch=async(url,opts)=>{
   if(opts.method==='POST'){
    const body=JSON.parse(opts.body);assert.equal(body.p_expected_version,0);writes++;
    row={user_id:'u1',org_id:'org',version:1,updated_at:'now',payload:body.p_payload};
    if(loseReply)throw Error('network_reply_lost');
   }
   return {ok:true,text:async()=>JSON.stringify(opts.method==='POST'?row:row?[row]:[])};
  };
  vm.runInContext(source.slice(source.indexOf('async function cloudRequest('),source.indexOf('async function cloudAudit(')),h.context);
  await h.run('upload');assert.equal(writes,1);assert.deepEqual(h.context.S,data);
  if(loseReply){assert.equal(h.root.profiles[0].personalCloud,undefined);await h.run('upload');assert.equal(writes,1);assert.match(h.effects.alerts.at(-1),/personal_version_conflict/);await h.run('download')}
  assert.equal(h.root.profiles[0].personalCloud.version,1);assert.deepEqual(h.context.S,data);
 }
});
test('duplicate clicks while a request is pending cannot dispatch a second save',async()=>{
 let release,reads=0;
 const gate=new Promise(resolve=>{release=resolve}),h=harness({onRequest:async()=>{reads++;await gate}});
 const pending=h.run('upload');await Promise.resolve();await Promise.resolve();await h.run('upload');
 release();await pending;
 assert.equal(h.effects.requests.filter(x=>x.opts).length,1);assert.equal(h.row.version,1);assert.equal(reads,2);
});
