import assert from 'node:assert/strict';
import {context,sheets,props,app,admin,alice,bob,sub,env,request,worker} from './test-activities.mjs';
// Closure transport has its own focused integration test.
context.runClosureNotificationTick_=()=>{};
let clockCount=0,held=false,deliveries=[],failure='';
context.ScriptApp={getProjectTriggers:()=>clockCount?[{getHandlerFunction:()=> 'runVoteReminderTick'}]:[],newTrigger:name=>{assert.equal(name,'runVoteReminderTick');return {timeBased(){return this;},everyMinutes(n){assert.equal(n,1);return this;},create(){clockCount++;}};}};
context.LockService={getScriptLock:()=>({waitLock(){assert.equal(held,false);held=true;},tryLock(){if(held)return false;held=true;return true;},releaseLock(){held=false;}})};
context.SpreadsheetApp.flush=()=>assert.equal(held,true,'Flush before send holds vote lock');
context.Utilities.formatDate=()=> '07 October 2030 19:00';
context.UrlFetchApp={fetch:(url,opts)=>{
  assert.equal(held,true,'Vote lock held during real-send simulation');assert.equal(url,env.GOOGLE_CHAT_WEBHOOK_URL);
  const message=JSON.parse(opts.payload).text;assert.ok(!message.includes('<users/all>'));deliveries.push(message);
  if(failure==='timeout')throw Error('timeout');
  return {getResponseCode:()=>failure==='http'?503:200,getContentText:()=>JSON.stringify({name:'spaces/AAQA0MkG6JM/messages/mock-'+deliveries.length})};
}};
const cfg={environment:'test',spaceId:env.GOOGLE_CHAT_SPACE_ID,webhook:env.GOOGLE_CHAT_WEBHOOK_URL};
assert.throws(()=>app('reminderEnable',alice,cfg),/สิทธิ์/);
assert.throws(()=>app('reminderEnable',admin,{...cfg,webhook:'https://evil.example'}),/Webhook/);
app('reminderEnable',admin,cfg);app('reminderEnable',sub,cfg);assert.equal(clockCount,1);
assert.equal(app('dashboard',admin).reminderEngine.enabled,true);
const make=()=>app('create',admin,{topic:'Reminder <users/all>',endAt:'2030-12-06T12:00:00Z',awards:['Gold']}).selectedId;
const id=make(),id2=make();
const future=new Date(Date.now()+120000).toISOString();
const add=(activityId=id,sendAt=future)=>app('reminderAdd',admin,{activityId,sendAt});
add();assert.throws(()=>add(),/เวลาเตือนนี้/);assert.throws(()=>add(id,'2030-12-07T12:00:00Z'),/ก่อนปิด/);assert.throws(()=>add(id,'2020-01-01T12:00:00Z'),/อนาคต/);
assert.throws(()=>app('reminderAdd',alice,{activityId:id,sendAt:future}),/สิทธิ์/);
const privateData=app('dashboard',alice);assert.equal(privateData.reminderEngine,undefined);assert.equal(privateData.activities.find(a=>a.id===id).reminders,undefined);
assert.ok(!JSON.stringify(app('dashboard',admin)).includes('key=fake'));
let row=sheets.get('VoteReminders').rows.find(r=>r[1]===id);row[2]=new Date(Date.now()-1000).toISOString();
app('vote',alice,{activityId:id,candidateId:bob.id});context.runVoteReminderTick();
assert.equal(deliveries.length,1);assert.ok(deliveries[0].includes('<users/102>'));assert.ok(!deliveries[0].includes('<users/101>'));assert.ok(!deliveries[0].includes('<users/100>'));assert.ok(!deliveries[0].includes('<users/103>'));assert.ok(deliveries[0].includes('?activity='+id+'#vote'));
context.runVoteReminderTick();assert.equal(deliveries.length,1,'No duplicate send');
add(id2);row=sheets.get('VoteReminders').rows.find(r=>r[1]===id2);const rid=row[0];
assert.throws(()=>app('reminderCancel',admin,{activityId:id,reminderId:rid}),/ยกเลิก/);
app('reminderCancel',sub,{activityId:id2,reminderId:rid});assert.equal(row[3],'cancelled');
const closed=make();add(closed);row=sheets.get('VoteReminders').rows.find(r=>r[1]===closed);row[2]=new Date(Date.now()-1000).toISOString();app('close',admin,{activityId:closed});context.runVoteReminderTick();assert.equal(row[3],'skipped');assert.equal(deliveries.length,1);
const uncertain=make();add(uncertain);row=sheets.get('VoteReminders').rows.find(r=>r[1]===uncertain);row[2]=new Date(Date.now()-1000).toISOString();failure='timeout';context.runVoteReminderTick();assert.equal(row[3],'unknown');failure='';context.runVoteReminderTick();assert.equal(deliveries.length,2);
const stale=make();add(stale);row=sheets.get('VoteReminders').rows.find(r=>r[1]===stale);row[2]=new Date(Date.now()-11*60000).toISOString();context.runVoteReminderTick();assert.equal(row[3],'skipped');
const wrongRoom=make();add(wrongRoom);row=sheets.get('VoteReminders').rows.find(r=>r[1]===wrongRoom);row[10]='AAQASHHP1Y4';row[2]=new Date(Date.now()-1000).toISOString();context.runVoteReminderTick();assert.equal(row[3],'skipped');
app('reminderDisable',admin);assert.equal(context.runVoteReminderTick().disabled,true);assert.throws(()=>add(make()),/เปิดระบบ/);
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{assert.ok(String(url).startsWith('https://script.google.com/'));return Response.json(JSON.parse(context.doPost({postData:{contents:opts.body}}).value));};
try{
  const bad=await (await worker.fetch(request('/api/app',alice,{op:'reminderEnable',actor:admin,webhook:'https://evil.example'}),env)).json();assert.equal(bad.ok,false);
  assert.equal((await worker.fetch(request('/api/app',admin,{op:'reminderEnable'},'https://evil.example'),env)).status,403);
  const result=await (await worker.fetch(request('/api/app',admin,{op:'reminderEnable',webhook:'https://evil.example',spaceId:'evil'}),env)).json();assert.equal(result.reminderEngine.enabled,true,'Worker injects trusted target, ignores browser secrets');
}finally{globalThis.fetch=oldFetch;}
assert.equal(held,false);
console.log('PASS: one-minute engine, actual non-voter IDs only, admin exclusion, activity isolation, private queues, room binding, timing validation, cancellation, closure, missed schedules, pause, CSRF and no ambiguous retry. All Chat transport mocked.');
