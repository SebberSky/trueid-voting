import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {context,app,admin,sub,env,request,worker} from './test-activities.mjs';
context.SpreadsheetApp.flush=()=>{};
vm.runInContext(await readFile('Maintenance.gs','utf8'),context);
context.demoteChawaponToClient();
const former={id:'chawapon-jira',email:'chawapon.k@muze.co.th',name:'Chawapon'};
assert.equal(app('profile',former).user.role,'client');assert.equal(app('profile',former).user.admin,false);
assert.equal(app('profile',admin).user.rootAdmin,true);assert.equal(app('profile',sub).user.role,'subadmin');
assert.throws(()=>app('create',former,{topic:'Forbidden',endAt:'2030-12-06T12:00:00Z',awards:['Gold']}),/ไม่มีสิทธิ์/);
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{assert.ok(String(url).startsWith('https://script.google.com/'));return Response.json(JSON.parse(context.doPost({postData:{contents:opts.body}}).value));};
try{
  const profile=await (await worker.fetch(request('/api/session',former),env)).json();
  assert.equal(profile.user.role,'client');assert.equal(profile.user.admin,false,'Existing signed cookie with admin:true cannot retain access');
  assert.equal((await worker.fetch(request('/api/chat/status',former),env)).status,403);
  assert.equal((await worker.fetch(request('/api/announcement',former,{activityId:'any'}),env)).status,403);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS: former admin is client, persisted role, stale admin cookie denied, remaining root/subadmin preserved. No live writes or Chat messages.');
