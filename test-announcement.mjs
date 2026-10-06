import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker from './server.mjs';

const client=await readFile(new URL('./client.js',import.meta.url),'utf8');
const elements=new Map();
const document={querySelector:s=>{if(!elements.has(s))elements.set(s,{value:'',classList:{add(){},remove(){}},replaceChildren(...children){this.children=children;},select(){},focus(){}});return elements.get(s);},createElement:()=>({})};
const scope=vm.createContext({document,Intl,Date,Map,Array,Number,Promise});
vm.runInContext(client.slice(0,client.indexOf('function message(')),scope);
assert.equal(scope.formatVotingDate('2026-10-06T12:00:00Z'),'06 ตุลาคม 2026 · 19:00 น.');
assert.equal(scope.formatVotingDate('2026-10-05T17:00:00Z'),'06 ตุลาคม 2026 · 00:00 น.');
scope.setDeadlineFields('2026-10-06T12:00:00Z');assert.equal(elements.get('#adminEndDateInput').value,'2026-10-06');assert.equal(elements.get('#adminEndHour').value,'19');assert.equal(elements.get('#adminEndMinute').value,'00');
assert.equal(elements.get('#adminEndHour').children.length,24);assert.equal(elements.get('#adminEndMinute').children.length,60);
assert.equal(new Date(`${elements.get('#adminEndDateInput').value}T19:00:00+07:00`).toISOString(),'2026-10-06T12:00:00.000Z');

const origin='https://trueid-voting.chawapon-rr.chatgpt.site';
const env={JIRA_CLIENT_SECRET:'mock-secret',VOTING_ENV:'test',CANDIDATE_SOURCE:'chat_members_only',GOOGLE_CHAT_SPACE_ID:'AAQA0MkG6JM',GOOGLE_CHAT_SPACE_NAME:'Test room',GOOGLE_CHAT_WEBHOOK_URL:'https://chat.googleapis.com/v1/spaces/AAQA0MkG6JM/messages?key=mock&token=mock'};
function request(admin=true,host=origin){const value=Buffer.from(JSON.stringify({id:'test-admin',admin,exp:Date.now()+600000})).toString('base64url'),sig=createHmac('sha256',env.JIRA_CLIENT_SECRET).update('session:'+value).digest('hex');return new Request(origin+'/api/announcement',{method:'POST',headers:{Cookie:'tv_session='+value+'.'+sig,Origin:host},body:'{}'});}
let mode='ok',sent=0,writes=[],config={exists:true,status:'open',activityId:'activity-1',topic:'Vote <users/all>',endAt:'2030-10-06T12:00:00Z',chatSpaceId:'AAQA0MkG6JM'};
const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=String(input);
  if(url.startsWith('https://script.google.com/')){
    if(!options)return Response.json(config);
    const envelope=JSON.parse(options.body);assert.equal(envelope.signature,createHmac('sha256',env.JIRA_CLIENT_SECRET).update(envelope.payload).digest('hex'));const body=JSON.parse(envelope.payload);writes.push(body);
    if(body.action==='claimAnnouncement')return Response.json({ok:true,alreadySent:mode==='duplicate'});
    return Response.json({ok:true});
  }
  assert.equal(url,env.GOOGLE_CHAT_WEBHOOK_URL,'Only selected-room webhook is used');
  sent++;const message=JSON.parse(options.body);assert.ok(message.text.includes(origin+'/#vote'));assert.ok(message.text.includes('06 ตุลาคม 2030 · 19:00'));assert.ok(!message.text.includes('<users/'),'Announcement never adds user mentions');
  if(mode==='timeout')throw Error('mock transport timeout');
  if(mode==='bad-receipt')return Response.json({name:'spaces/WRONG/messages/mock'});
  return Response.json({name:'spaces/AAQA0MkG6JM/messages/mock'});
};
try{
  assert.equal((await worker.fetch(new Request(origin+'/api/announcement',{method:'POST'}),env)).status,401);
  assert.equal((await worker.fetch(request(false),env)).status,403);
  assert.equal((await worker.fetch(request(true,'https://other.example'),env)).status,403);assert.equal(sent,0);
  const ok=await (await worker.fetch(request(),env)).json();assert.equal(ok.ok,true);assert.equal(sent,1);assert.equal(writes.at(-1).status,'sent');
  mode='duplicate';const duplicate=await (await worker.fetch(request(),env)).json();assert.equal(duplicate.alreadySent,true);assert.equal(sent,1);
  mode='timeout';assert.equal((await worker.fetch(request(),env)).status,502);assert.equal(writes.at(-1).status,'unknown');
  mode='bad-receipt';assert.equal((await worker.fetch(request(),env)).status,502);assert.equal(writes.at(-1).status,'unknown');
  const count=sent;assert.equal((await worker.fetch(request(),{...env,GOOGLE_CHAT_SPACE_ID:'AAQASHHP1Y4'})).status,400);assert.equal(sent,count,'Environment mismatch cannot send');
  config={...config,status:'closed'};assert.equal((await worker.fetch(request(),env)).status,400);assert.equal(sent,count);
}finally{globalThis.fetch=original;}
console.log('PASS: full-month Gregorian dates, 24-hour Bangkok time, date round-trip, announcement auth/CSRF, correct-room guard, no mentions, deduplication and ambiguous receipts; all transport mocked.');
