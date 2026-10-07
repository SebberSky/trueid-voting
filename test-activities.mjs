import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import worker from './server.mjs';
const sheets=new Map(),props=new Map();let locks=0;
function sheet(name){
  const item={rows:[],getLastRow(){return this.rows.length;},appendRow(r){this.rows.push([...r]);},clearContents(){this.rows=[];},getDataRange(){return {getValues:()=>this.rows.map(r=>[...r])};},getRange(row,col,h=1,w=1){return {setValues:values=>{assert.equal(values.length,h);for(let i=0;i<h;i++){assert.equal(values[i].length,w);item.rows[row+i-1]??=[];for(let j=0;j<w;j++)item.rows[row+i-1][col+j-1]=values[i][j];}},setValue:value=>{item.rows[row-1]??=[];item.rows[row-1][col-1]=value;}};}};
  sheets.set(name,item);return item;
}
const ss={getSheetByName:name=>sheets.get(name),insertSheet:sheet};
const context=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>ss},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locks,0,'No nested locks');locks++;},releaseLock(){locks--;}})},ContentService:{createTextOutput:value=>({value,setMimeType(){return this;}}),MimeType:{JSON:'JSON'}},Utilities:{getUuid:randomUUID,computeHmacSha256Signature:(v,s)=>[...createHmac('sha256',s).update(v).digest()],Charset:{UTF_8:'UTF_8'}},Date,JSON});
vm.runInContext((await readFile('Code.gs','utf8'))+'\n'+(await readFile('Activities.gs','utf8'))+'\n'+(await readFile('VoteReminders.gs','utf8')),context);
context.setup();
const admin={id:'admin-jira',email:'kittisak.bua@truedigital.com',name:'Admin'},alice={id:'alice-jira',email:'alice@muze.co.th',name:'Alice'},bob={id:'bob-jira',email:'bob@truedigital.com',name:'Bob'},sub={id:'sub-jira',email:'sub@muze.co.th',name:'Sub'};
for(const a of [admin,alice,bob,sub])context.registerClient_({accountId:a.id,name:a.name,email:a.email});
context.syncChatMembers_({spaceId:'AAQA0MkG6JM',environment:'test',members:[admin,alice,bob,sub].map((a,i)=>({...a,chatUserId:'users/'+(i+100)}))});
// Legacy real data is migrated once, keeping original sheets untouched.
const legacy=context.saveConfig_({topic:'Original',endAt:'2030-10-06T12:00:00Z',awards:['First','Second']}).config;
sheets.get('Votes').appendRow(['2026-10-06T11:00:00Z',alice.id,bob.id,alice.email]);
const original=JSON.stringify(sheets.get('Votes').rows);
function app(op,actor=admin,extra={}){return context.app_({op,actor,...extra});}
let d=app('dashboard',alice);assert.equal(d.activities.length,1);assert.equal(d.activities[0].myVote.name,bob.name);assert.equal(d.activities[0].canVote,false);
app('dashboard',alice);assert.equal(sheets.get('ActivityVotes').rows.length,2);assert.equal(JSON.stringify(sheets.get('Votes').rows),original);
assert.throws(()=>app('vote',alice,{activityId:legacy.activityId,candidateId:sub.id}),/โหวต.*แล้ว/);
assert.throws(()=>app('vote',admin,{activityId:legacy.activityId,candidateId:bob.id}),/ไม่สามารถโหวต/);
assert.throws(()=>app('vote',bob,{activityId:legacy.activityId,candidateId:bob.id}),/ตัวเอง/);
assert.throws(()=>app('create',alice,{topic:'No',endAt:'2030-01-01',awards:['x']}),/สิทธิ์/);
app('setRole',admin,{email:sub.email,role:'subadmin'});assert.equal(app('profile',sub).user.role,'subadmin');
assert.throws(()=>app('setRole',sub,{email:bob.email,role:'subadmin'}),/แอดมินหลัก/);
assert.throws(()=>app('setRole',admin,{email:admin.email,role:'client'}));
const created=app('create',sub,{topic:'New activity',endAt:'2030-12-06T12:00:00Z',awards:['Gold','Silver']});const id=created.selectedId;
assert.notEqual(id,legacy.activityId);assert.equal(created.activities.length,2);assert.equal(created.activities[0].total,2);assert.equal(created.activities[0].ballotCount,0);
assert.throws(()=>app('vote',sub,{activityId:id,candidateId:alice.id}),/ไม่สามารถโหวต/);
assert.throws(()=>app('vote',{id:'outsider',email:'outside@muze.co.th'},{activityId:id,candidateId:alice.id}),/ไม่มีสิทธิ์/);
app('vote',alice,{activityId:id,candidateId:bob.id});
d=app('dashboard',alice);let a=d.activities.find(a=>a.id===id);assert.equal(a.myVote.name,'Bob');assert.equal(a.canVote,false);assert.equal(a.results[0].id,bob.id);assert.equal(a.status,'open');
assert.throws(()=>app('vote',alice,{activityId:id,candidateId:sub.id}),/โหวต.*แล้ว/);
d=app('vote',bob,{activityId:id,candidateId:alice.id});a=d.activities.find(a=>a.id===id);
assert.equal(a.status,'closed');assert.equal(a.closeReason,'all_voted');assert.equal(a.completed,2);assert.equal(a.results[0].rank,1);assert.equal(a.results[1].rank,1);assert.equal(a.results[0].award,'Gold');assert.equal(a.results[1].tied,true);
assert.throws(()=>app('update',admin,{activityId:id,topic:'Cannot reopen',endAt:'2031-01-01',awards:['x']}),/ยังเปิด/);
const aliceHistory=app('history',alice).history;assert.equal(aliceHistory.length,2);assert.ok(aliceHistory.every(h=>h.candidateName==='Bob'));assert.equal(app('history',admin).history.length,0);
assert.equal(app('dashboard',null).history.length,0);assert.ok(!JSON.stringify(app('dashboard',bob).activities).includes(alice.email),'Public activities contain no candidate email/voter list');
const manual=app('create',admin,{topic:'Manual',endAt:'2030-12-06T12:00:00Z',awards:['Gold']}).selectedId;
assert.equal(app('close',sub,{activityId:manual}).activities.find(a=>a.id===manual).closeReason,'manual');
const timed=app('create',admin,{topic:'Timed',endAt:'2030-12-06T12:00:00Z',awards:['Gold']}).selectedId;
const index=sheets.get('Activities').rows.findIndex(r=>r[0]===timed);sheets.get('Activities').rows[index][2]='2020-01-01T00:00:00Z';
assert.equal(app('dashboard',admin).activities.find(a=>a.id===timed).closeReason,'deadline');
const env={JIRA_CLIENT_SECRET:'mock-secret',VOTING_ENV:'test',CANDIDATE_SOURCE:'chat_members_only',GOOGLE_CHAT_SPACE_ID:'AAQA0MkG6JM',GOOGLE_CHAT_SPACE_NAME:'Test room',GOOGLE_CHAT_WEBHOOK_URL:'https://chat.googleapis.com/v1/spaces/AAQA0MkG6JM/messages?key=fake&token=fake'},origin='https://trueid-voting.chawapon-rr.chatgpt.site';
props.set('JIRA_CLIENT_SECRET',env.JIRA_CLIENT_SECRET);
function cookie(actor){const value=Buffer.from(JSON.stringify({...actor,admin:true,exp:Date.now()+60000})).toString('base64url');return 'tv_session='+value+'.'+createHmac('sha256',env.JIRA_CLIENT_SECRET).update('session:'+value).digest('hex');}
function request(path,actor,body,source=origin){return new Request(origin+path,{method:body?'POST':'GET',headers:{...(actor?{Cookie:cookie(actor)}:{}),Origin:source,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
const savedFetch=globalThis.fetch;let messages=0;
globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://script.google.com/')){const result=context.doPost({postData:{contents:options.body}});return Response.json(JSON.parse(result.value));}
  if(String(url).startsWith('https://chat.googleapis.com/')){messages++;assert.ok(String(url).includes('AAQA0MkG6JM'));const text=JSON.parse(options.body).text;assert.ok(text.includes('?activity='));assert.equal((text.match(/<users\/all>/g)||[]).length,1);return Response.json({name:'spaces/AAQA0MkG6JM/messages/mock'});}
  throw Error('Unexpected real transport');
};
try{
  assert.equal((await worker.fetch(request('/api/app',null,{op:'vote'}),env)).status,401);
  assert.equal((await worker.fetch(request('/api/app',alice,{op:'vote'},'https://evil.example'),env)).status,403);
  // Signed cookie admin flag is ignored; live role comes from Sheets.
  const profile=await (await worker.fetch(request('/api/session',alice),env)).json();assert.equal(profile.user.admin,false);
  const attack=await (await worker.fetch(request('/api/app',alice,{op:'create',actor:admin,topic:'Spoof',endAt:'2030-12-06',awards:['x']}),env)).json();assert.equal(attack.ok,false);
  const c=await (await worker.fetch(request('/api/app',admin,{op:'create',topic:'Announcement',endAt:'2030-12-06T12:00:00Z',awards:['x']}),env)).json();
  assert.equal(c.ok,true);
  assert.equal((await worker.fetch(request('/api/announcement',alice,{activityId:c.selectedId}),env)).status,403);assert.equal(messages,0);
  assert.equal((await worker.fetch(request('/api/announcement',admin,{activityId:c.selectedId}),env)).status,200);
  assert.equal((await worker.fetch(request('/api/announcement',admin,{activityId:c.selectedId}),env)).status,200);assert.equal(messages,1,'Announcement deduplication per activity');
  assert.equal((await worker.fetch(request('/api/data',null),env)).status,200);
  const anonymous=await (await worker.fetch(request('/api/data',null),env)).json();assert.equal(anonymous.history.length,0);
}finally{globalThis.fetch=savedFetch;}
assert.equal(locks,0);
console.log('PASS: additive/idempotent migration, isolated activities, admin/subadmin guards, self-vote and duplicate rejection, persisted own ballot/history, tie ranks, completion/manual/deadline closure, CSRF and spoofed roles, private history, activity links and mocked announcement deduplication.');
export {context,sheets,props,app,admin,alice,bob,sub,env,request,worker};
