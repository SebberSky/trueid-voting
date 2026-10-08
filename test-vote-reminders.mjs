import assert from 'node:assert/strict';
import {context,sheets,app,admin,alice,bob} from './test-activities.mjs';

const activityId=app('create',admin,{topic:'Current vote status',endAt:'2030-12-06T12:00:00Z',awards:['Gold']}).selectedId;
const current=()=>context.appActivity_(sheets.get('Activities').rows.find(r=>r[0]===activityId));
const ballots=()=>context.appRows_('ActivityVotes');
assert.equal(app('dashboard',alice).activities.find(a=>a.id===activityId).myVote,null);
app('vote',alice,{activityId,candidateId:bob.id});
for(let refresh=0;refresh<3;refresh++){
  const activity=app('dashboard',alice).activities.find(a=>a.id===activityId);
  assert.equal(activity.myVote.name,bob.name);
  assert.equal(activity.canVote,false);
}
assert.throws(()=>app('vote',alice,{activityId,candidateId:bob.id}),/โหวต.*แล้ว/);
const people=context.reminderPeople_(current(),ballots());
assert.deepEqual(Array.from(people,p=>p.chatUserId),['users/102']);
app('vote',bob,{activityId,candidateId:alice.id});
const closed=app('dashboard',admin).activities.find(a=>a.id===activityId);
assert.equal(closed.status,'closed');
assert.equal(closed.closeReason,'all_voted');
assert.equal(context.reminderPeople_(current(),ballots()).length,0);
console.log('PASS: current ballots persist on refresh, duplicate voting is blocked, latest voters are excluded from reminders and completion closes voting. All transport mocked.');
