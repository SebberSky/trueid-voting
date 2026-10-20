import assert from 'node:assert/strict';
import {context,props,app,admin,env} from './test-activities.mjs';

let now=Date.parse('2026-10-23T16:58:00Z'),deliveries=0,closures=0,crossMidnight=false,held=false;
const NativeDate=Date;
context.Date=class extends NativeDate{
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return now;}
};
const acquireLock=()=>{assert.equal(held,false);held=true;return true;};
context.LockService={getScriptLock:()=>({tryLock:acquireLock,releaseLock(){assert.equal(held,true);held=false;},waitLock:acquireLock})};
context.SpreadsheetApp.flush=()=>{if(crossMidnight)now=Date.parse('2026-10-30T17:00:00Z');};
context.Utilities.formatDate=()=>'';
context.runClosureNotificationTick_=()=>{closures++;};
context.UrlFetchApp={fetch:()=>{
  deliveries++;
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({name:'spaces/AAQA0MkG6JM/messages/mock-'+deliveries})};
}};
props.set('VOTE_REMINDERS_ENABLED','true');
props.set('REMINDER_WEBHOOK_test',env.GOOGLE_CHAT_WEBHOOK_URL);
for(const [time,weekday] of [
  ['2026-10-23T16:59:59Z',true],
  ['2026-10-23T17:00:00Z',false],
  ['2026-10-24T17:00:00Z',false],
  ['2026-10-25T16:59:59Z',false],
  ['2026-10-25T17:00:00Z',true]
])assert.equal(context.reminderWeekday_(Date.parse(time)),weekday,time);
const id=app('create',admin,{topic:'Weekdays',endAt:'2026-10-29T12:00:00Z',awards:['Gold'],reminderIntervalMinutes:1}).selectedId;
now+=60000;context.runVoteReminderTick();assert.equal(deliveries,1,'Friday Bangkok sends normally');
now+=60000;context.runVoteReminderTick();assert.equal(deliveries,1,'Saturday Bangkok, despite UTC Friday');
now=Date.parse('2026-10-25T10:00:00Z');context.runVoteReminderTick();assert.equal(deliveries,1,'Sunday blocked');
assert.equal(closures,3,'Closure processing still runs on weekends');
now=Date.parse('2026-10-25T17:00:00Z');context.runVoteReminderTick();assert.equal(deliveries,1,'Monday skips overdue weekend cycles');
now+=60000;context.runVoteReminderTick();assert.equal(deliveries,2,'Monday resumes without manual changes');
context.runVoteReminderTick();assert.equal(deliveries,2,'No catch-up duplicates');
now=Date.parse('2026-10-30T16:58:00Z');
app('create',admin,{topic:'Midnight boundary',endAt:'2026-11-03T12:00:00Z',awards:['Gold'],reminderIntervalMinutes:1});
now+=60000;crossMidnight=true;context.runVoteReminderTick();
assert.equal(deliveries,2,'No delivery when persistence crosses into Saturday');
assert.equal(context.reminderRows_().filter(r=>r.status==='sending').length,0,'Unsent weekend row is not left ambiguous');
assert.equal(held,false,'Reminder processing releases its lock');
assert.ok(id);
console.log('PASS: Bangkok weekday boundaries, weekend silence, closure processing, Monday recovery without backlog, midnight send guard. All Chat calls mocked.');
