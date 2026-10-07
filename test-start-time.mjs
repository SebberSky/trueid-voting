import assert from 'node:assert/strict';
import {context,sheets,props,app,admin,alice,bob,sub,env,request,worker} from './test-activities.mjs';
let now=Date.now();const NativeDate=Date;
context.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const start=new Date(now+120000).toISOString(),end=new Date(now+3600000).toISOString();
const create=extra=>app('create',admin,{topic:'Scheduled',startAt:start,endAt:end,awards:['Gold'],...extra});
let d=create({allowAdminVote:true}),id=d.selectedId,a=d.activities.find(a=>a.id===id);
assert.equal(a.status,'scheduled');assert.equal(a.allowAdminVote,true);assert.equal(a.total,4);assert.equal(a.canVote,false);
assert.throws(()=>app('vote',alice,{activityId:id,candidateId:bob.id}),/เวลาเริ่ม/);
assert.throws(()=>app('vote',admin,{activityId:id,candidateId:bob.id}),/เวลาเริ่ม/);
assert.throws(()=>create({startAt:end}),/เวลาเริ่ม/);assert.throws(()=>create({startAt:'invalid'}),/เวลาเริ่ม/);
assert.throws(()=>create({startAt:new Date(now-60000).toISOString()}),/ย้อนหลัง/);
assert.throws(()=>create({startAt:new Date(now).toISOString()}),/ย้อนหลัง/);
const immediate=create({startAt:''}).selectedId;
assert.equal(app('dashboard',admin).activities.find(a=>a.id===immediate).status,'open','Default is immediate with no scheduled timestamp');
assert.throws(()=>app('update',admin,{activityId:immediate,topic:'No reschedule',startAt:start,endAt:end,awards:['x']}),/กิจกรรมเริ่มแล้ว/);
assert.throws(()=>app('update',admin,{activityId:id,topic:'No backdate',startAt:new Date(now-60000).toISOString(),endAt:end,awards:['x']}),/ย้อนหลัง/);
now+=120000;
d=app('dashboard',admin);a=d.activities.find(a=>a.id===id);assert.equal(a.status,'open');assert.equal(a.canVote,true);
assert.throws(()=>app('vote',admin,{activityId:id,candidateId:admin.id}),/ตัวเอง/);
app('vote',admin,{activityId:id,candidateId:bob.id});assert.equal(app('dashboard',admin).activities.find(a=>a.id===id).myVote.name,bob.name);
assert.throws(()=>app('vote',admin,{activityId:id,candidateId:alice.id}),/แล้ว/);
app('vote',sub,{activityId:id,candidateId:alice.id});
assert.throws(()=>app('update',admin,{activityId:id,topic:'Changed',startAt:'',endAt:end,awards:['x']}),/เวลาเริ่ม/);
app('vote',alice,{activityId:id,candidateId:bob.id});d=app('vote',bob,{activityId:id,candidateId:alice.id});assert.equal(d.activities.find(a=>a.id===id).closeReason,'all_voted');
const noAdmin=create({startAt:'',allowAdminVote:false}).selectedId;assert.equal(app('dashboard',admin).activities.find(a=>a.id===noAdmin).canVote,false);assert.throws(()=>app('vote',admin,{activityId:noAdmin,candidateId:bob.id}),/ไม่สามารถ/);
assert.equal(app('dashboard',alice).activities.find(a=>a.id===noAdmin).total,2);
// Existing activity columns are preserved and default to immediate/admin-disabled.
const legacy=sheets.get('Activities').rows.find(r=>r[7]==='legacy');assert.ok(legacy);assert.equal(app('dashboard',admin).activities.find(a=>a.id===legacy[0]).allowAdminVote,false);
// The clock still opens scheduled voting while chat reminders are paused.
context.LockService={getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})};
const tickId=create({startAt:new Date(now+60000).toISOString()}).selectedId;props.set('VOTE_REMINDERS_ENABLED','false');now+=60000;context.runVoteReminderTick();assert.equal(sheets.get('Activities').rows.find(r=>r[0]===tickId)[3],'open');
app('update',admin,{activityId:tickId,topic:'Rename after opening',endAt:end,awards:['x']});
assert.throws(()=>app('update',admin,{activityId:tickId,topic:'Cannot rewrite start',startAt:'',endAt:end,awards:['x']}),/กิจกรรมเริ่มแล้ว/);
const futureId=create({startAt:new Date(now+60000).toISOString()}).selectedId;app('close',admin,{activityId:futureId});now+=60000;context.runVoteReminderTick();assert.equal(sheets.get('Activities').rows.find(r=>r[0]===futureId)[3],'closed','Clock never reopens closed activities');
// Reminder time must be after the scheduled opening.
props.set('VOTE_REMINDERS_ENABLED','true');props.set('REMINDER_WEBHOOK_test',env.GOOGLE_CHAT_WEBHOOK_URL);
const remindId=create({startAt:new Date(now+120000).toISOString()}).selectedId;
assert.throws(()=>app('reminderAdd',admin,{activityId:remindId,sendAt:new Date(now+60000).toISOString()}),/เวลาเริ่ม/);
app('reminderAdd',admin,{activityId:remindId,sendAt:new Date(now+180000).toISOString()});context.runVoteReminderTick();assert.equal(sheets.get('VoteReminders').rows.find(r=>r[1]===remindId)[3],'pending');
const savedFetch=globalThis.fetch;globalThis.fetch=async(url,opts)=>{assert.ok(String(url).startsWith('https://script.google.com/'));return Response.json(JSON.parse(context.doPost({postData:{contents:opts.body}}).value));};
try{const r=await (await worker.fetch(request('/api/app',admin,{op:'create',topic:'HTTP scheduled',startAt:new Date(now+120000).toISOString(),endAt:end,awards:['x'],allowAdminVote:true}),env)).json();assert.equal(r.ok,true);assert.equal(r.activities.find(a=>a.id===r.selectedId).status,'scheduled');assert.equal(r.activities.find(a=>a.id===r.selectedId).allowAdminVote,true);}finally{globalThis.fetch=savedFetch;}
console.log('PASS: future opening gates, exact-start activation, paused-clock activation, per-activity Admin/Subadmin voting, self/duplicate rejection, closure and preserved legacy defaults; no live data or Chat calls.');
