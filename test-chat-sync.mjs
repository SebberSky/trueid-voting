import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';
import worker from './server.mjs';

const props=new Map(),sheets=new Map();
function sheet(name){
  const item={rows:[],getLastRow(){return this.rows.length;},clearContents(){this.rows=[];},appendRow(row){this.rows.push([...row]);},getDataRange(){return {getValues:()=>this.rows.map(r=>[...r])};},getRange(row,col,height=1,width=1){return {setValues:values=>{for(let i=0;i<height;i++){item.rows[row-1+i]??=[];for(let j=0;j<width;j++)item.rows[row-1+i][col-1+j]=values[i][j];}},setValue:value=>{item.rows[row-1]??=[];item.rows[row-1][col-1]=value;}};}};
  sheets.set(name,item);return item;
}
const ss={getSheetByName:name=>sheets.get(name),insertSheet:sheet};
const context=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>ss},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},ContentService:{createTextOutput:value=>({value,setMimeType(){return this;}}),MimeType:{JSON:'JSON'}},Utilities:{getUuid:()=> 'event-test'},Date,JSON});
vm.runInContext(await readFile(new URL('./Code.gs',import.meta.url),'utf8'),context);
context.setup();
context.registerClient_({accountId:'jira-existing',name:'Existing user',email:'first@muze.co.th'});
const roster=[{email:'first@muze.co.th',name:'First person',chatUserId:'users/111'},{email:'second@truedigital.com',name:'Second person',chatUserId:'users/222'}];
context.syncChatMembers_({spaceId:'AAQASHHP1Y4',members:roster});
assert.equal(context.getConfig_().candidateCount,2);
assert.equal(context.getConfig_().exists,false);
assert.equal(sheets.get('Candidates').rows[1][0],'jira-existing');
context.registerClient_({accountId:'jira-second',name:'Second person',email:'second@truedigital.com'});
assert.equal(context.getConfig_().candidateCount,2,'Jira login must not duplicate roster user');
context.syncChatMembers_({spaceId:'AAQASHHP1Y4',members:roster});
assert.equal(sheets.get('Candidates').rows.length,3,'Repeated sync must be idempotent');
sheets.get('Votes').appendRow(['time','voter','jira-existing','voter@muze.co.th']);
context.syncChatMembers_({spaceId:'AAQASHHP1Y4',members:[roster[0]]});
assert.equal(context.getConfig_().candidateCount,1);
assert.equal(sheets.get('Votes').rows.length,2,'Votes must survive removed members');
context.registerClient_({accountId:'jira-second',name:'Second person',email:'second@truedigital.com'});
assert.equal(context.getConfig_().candidateCount,1,'Login cannot reactivate departed member');
assert.equal(context.chatStatus_().count,1);
assert.throws(()=>context.syncChatMembers_({spaceId:'AAQASHHP1Y4',members:[roster[0],roster[0]]}));
assert.throws(()=>context.syncChatMembers_({spaceId:'AAQASHHP1Y4',members:[]}));
assert.equal(context.chatStatus_().count,1,'Invalid sync preserves roster');

const env={JIRA_CLIENT_SECRET:'test-secret',GOOGLE_CHAT_CLIENT_ID:'test-client',GOOGLE_CHAT_CLIENT_SECRET:'test-client-secret',GOOGLE_CHAT_REFRESH_TOKEN:'test-refresh',GOOGLE_CHAT_SPACE_ID:'AAQASHHP1Y4'};
function userCookie(admin=true){const data={id:'test-user',email:'test@muze.co.th',admin,exp:Date.now()+60000};const value=Buffer.from(JSON.stringify(data)).toString('base64url');return 'tv_session='+value+'.'+createHmac('sha256',env.JIRA_CLIENT_SECRET).update('session:'+value).digest('hex');}
function request(path,admin=true,origin='https://trueid-voting.chawapon-rr.chatgpt.site'){return new Request('https://trueid-voting.chawapon-rr.chatgpt.site'+path,{method:'POST',headers:{Cookie:userCookie(admin),Origin:origin,'Content-Type':'application/json'},body:'{}'});}
const oldFetch=globalThis.fetch;let writes=[],mode='ok',chatRequests=0;
globalThis.fetch=async(input,options)=>{
  const url=String(input);
  if(url.startsWith('https://script.google.com/')){const wrapped=JSON.parse(options.body),body=JSON.parse(wrapped.payload);assert.equal(wrapped.signature,createHmac('sha256',env.JIRA_CLIENT_SECRET).update(wrapped.payload).digest('hex'));if(body.action==='getChatConnection')return Response.json({ok:true,refreshToken:''});writes.push(body);return Response.json({ok:true,count:body.members?.length||0});}
  if(url==='https://oauth2.googleapis.com/token'){assert.equal(new URLSearchParams(options.body).get('grant_type'),'refresh_token');return mode==='expired'?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'test-access'});}
  if(url.startsWith('https://chat.googleapis.com/')){chatRequests++;if(new URL(url).searchParams.has('pageToken'))return mode==='page-fails'?Response.json({error:{}},{status:503}):Response.json({memberships:[{state:'JOINED',member:{type:'HUMAN',email:roster[1].email,displayName:roster[1].name,name:roster[1].chatUserId}}]});return Response.json({memberships:[{state:'JOINED',member:{type:'HUMAN',email:roster[0].email,displayName:roster[0].name,name:roster[0].chatUserId}}],nextPageToken:'second-page'});}
  throw Error('Unexpected request');
};
try{
  for(const path of ['/api/chat/status','/api/chat/sync','/api/chat/connect'])assert.equal((await worker.fetch(new Request('https://trueid-voting.chawapon-rr.chatgpt.site'+path),env)).status,401);
  assert.equal((await worker.fetch(request('/api/chat/sync',false),env)).status,403);
  assert.equal((await worker.fetch(request('/api/chat/sync',true,'https://other.example'),env)).status,403);
  const result=await (await worker.fetch(request('/api/chat/sync'),env)).json();
  assert.equal(result.count,2);assert.equal(result.pages,2);assert.equal(chatRequests,2);assert.equal(writes.length,1);assert.equal(writes[0].action,'syncChatMembers');
  assert.equal(JSON.stringify(result).includes('test-access'),false);
  mode='expired';writes=[];assert.equal((await worker.fetch(request('/api/chat/sync'),env)).status,400);assert.equal(writes.length,0);
  mode='page-fails';writes=[];assert.equal((await worker.fetch(request('/api/chat/sync'),env)).status,400);assert.equal(writes.length,0,'Partial pages must not replace roster');
}finally{globalThis.fetch=oldFetch;}
console.log('PASS: member sync, stable candidate IDs, no duplicates, removals, history, pagination, token expiry, admin authorization and CSRF');
