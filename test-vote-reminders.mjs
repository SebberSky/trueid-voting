import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// All services, including UrlFetchApp, are mocks. No webhook or network is called.
const sheets=new Map(),props=new Map(),sent=[];let sequence=0,locked=false,mode='ok';
let now=Date.parse('2030-01-01T00:00:00Z');
class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function sheet(name){const item={rows:[],getLastRow(){return this.rows.length;},clearContents(){this.rows=[];},appendRow(row){this.rows.push([...row]);},getDataRange(){return{getValues:()=>this.rows.map(r=>[...r])};},getRange(row,col,height=1,width=1){return{setValues:values=>{for(let i=0;i<height;i++){item.rows[row-1+i]??=[];for(let j=0;j<width;j++)item.rows[row-1+i][col-1+j]=values[i][j];}},setValue:value=>{item.rows[row-1]??=[];item.rows[row-1][col-1]=value;}};}};sheets.set(name,item);return item;}
const ss={getSheetByName:name=>sheets.get(name),insertSheet:sheet};
const context=vm.createContext({Map,Set,Date:Clock,JSON,SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true;},tryLock(){if(locked)return false;locked=true;return true;},releaseLock(){locked=false;}})},Utilities:{getUuid:()=> 'id-'+(++sequence),formatDate:()=> '01/01/2030 09:00'},ContentService:{createTextOutput:value=>({value,setMimeType(){return this;}}),MimeType:{JSON:'JSON'}},UrlFetchApp:{fetch(url,options){assert.equal(locked,true,'Votes and reminders share lock');assert.ok(url.includes('/AAQASHHP1Y4/messages'));sent.push(JSON.parse(options.payload));if(mode==='timeout')throw Error('Secret-containing transport error must not be logged');return{getResponseCode:()=>mode==='fail'?403:200,getContentText:()=>JSON.stringify({name:'spaces/AAQASHHP1Y4/messages/mock-'+sent.length})};}}});
for(const file of ['Code.gs','VoteReminders.gs'])vm.runInContext(await readFile(new URL(file,import.meta.url),'utf8'),context);
context.setup();
assert.throws(()=>context.saveVoteReminder_({sendAt:'2030-01-01T00:01:00Z'}));
context.saveConfig_({topic:'Real topic',endAt:'2030-01-01T02:00:00Z',awards:['First'],status:'open'});
const members=[1,2,3].map(i=>({email:`person${i}@muze.co.th`,name:'Person '+i,chatUserId:'users/'+i}));
context.syncChatMembers_({spaceId:'AAQASHHP1Y4',members});
sheets.get('Votes').appendRow([new Clock(),'jira-person1','users/2','PERSON1@MUZE.CO.TH']);
assert.equal(context.getClientVoteStatus_({voterId:'jira-person1',voterEmail:'person1@muze.co.th'}).hasVoted,true);
assert.equal(context.getClientVoteStatus_({voterId:'jira-person2',voterEmail:'person2@muze.co.th'}).hasVoted,false);
assert.equal(context.getReminderVoteStatus_().voted,1);
assert.throws(()=>context.saveVoteReminder_({sendAt:'2030-01-01T00:01:00'}),'Explicit timezone required');
context.saveVoteReminder_({sendAt:'2030-01-01T00:01:00Z'});
assert.throws(()=>context.saveVoteReminder_({sendAt:'2030-01-01T00:01:00Z'}),'Duplicate time rejected');
assert.equal(context.runVoteReminderTick().disabled,true);assert.equal(sent.length,0);
props.set('VOTE_REMINDERS_ENABLED','true');props.set('GOOGLE_CHAT_WEBHOOK_URL','https://chat.googleapis.com/v1/spaces/AAQASHHP1Y4/messages?key=mock&token=mock');
assert.equal(context.runVoteReminderTick().due,false);
// Person 2 votes AFTER scheduling: the latest status must exclude them at send time.
sheets.get('Votes').appendRow([new Clock(),'jira-person2','users/1','person2@muze.co.th']);
now+=60000;assert.equal(context.runVoteReminderTick().mentioned,1);
assert.ok(sent[0].text.includes('<users/3>'));assert.ok(!sent[0].text.includes('<users/1>'));assert.ok(!sent[0].text.includes('<users/2>'));
context.runVoteReminderTick();assert.equal(sent.length,1,'No duplicate sends');
context.saveVoteReminder_({sendAt:'2030-01-01T00:02:00Z'});now+=60000;mode='timeout';
assert.equal(context.runVoteReminderTick().status,'unknown');context.runVoteReminderTick();assert.equal(sent.length,2,'No retry on ambiguous delivery');
context.saveVoteReminder_({sendAt:'2030-01-01T00:03:00Z'});now+=60000;mode='fail';assert.equal(context.runVoteReminderTick().status,'failed');
context.saveVoteReminder_({sendAt:'2030-01-01T00:04:00Z'});now+=12*60000;assert.equal(context.runVoteReminderTick().status,'skipped');
// Cancel and no-event/no-vote cases never send.
const cancelled=context.saveVoteReminder_({sendAt:'2030-01-01T00:20:00Z'}).reminder;context.cancelVoteReminder_({id:cancelled.id});
assert.ok(context.listVoteReminders_().reminders.some(r=>r.status==='cancelled'));
sheets.get('Votes').appendRow([new Clock(),'unknown-jira','users/1','']);
context.saveVoteReminder_({sendAt:'2030-01-01T00:21:00Z'});now=Date.parse('2030-01-01T00:21:00Z');assert.equal(context.runVoteReminderTick().status,'blocked');
assert.equal(sent.length,3,'Unmapped voter IDs must block tags');
assert.equal(context.getReminderVoteStatus_().unresolvedVotes,1);
const config=context.getConfig_(),claim={activityId:config.activityId,topic:config.topic,endAt:config.endAt,environment:config.environment,spaceId:config.chatSpaceId,fingerprint:'a'.repeat(64),requestId:'test-announcement'};
assert.equal(context.claimAnnouncement_(claim).alreadySent,false);
assert.throws(()=>context.claimAnnouncement_({...claim,requestId:'duplicate'}),'Concurrent announcement must be blocked');
assert.throws(()=>context.finishAnnouncement_({requestId:'wrong',status:'sent',messageName:'spaces/AAQASHHP1Y4/messages/mock'}));
context.finishAnnouncement_({requestId:claim.requestId,status:'sent',messageName:'spaces/AAQASHHP1Y4/messages/mock'});
assert.equal(context.claimAnnouncement_({...claim,requestId:'again'}).alreadySent,true);
assert.throws(()=>context.claimAnnouncement_({...claim,topic:'changed'}),'Stale event snapshot must not be announced');
console.log('PASS: vote-status lookup, latest-vote exclusion, timezone validation, scheduled sends, deduplication, cancellation, late/disabled guards, ambiguous-delivery handling and unmapped voter safety; all transport mocked.');
