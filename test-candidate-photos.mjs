import assert from 'node:assert/strict';
import {context,sheets,props,app,admin,alice,bob,sub,env,request,worker} from './test-activities.mjs';
const people=[admin,alice,bob,sub].map((p,i)=>({...p,chatUserId:'users/'+(100+i),avatarUrl:'https://lh3.googleusercontent.com/member-'+i}));
const originalVotes=JSON.stringify(sheets.get('ActivityVotes').rows);
const originalCandidates=sheets.get('Candidates').rows.slice(1).map(r=>JSON.stringify(r.slice(0,7)));
assert.throws(()=>context.updateCandidateAvatars_({spaceId:'wrong',members:people}),/source/);
const photos=context.updateCandidateAvatars_({spaceId:env.GOOGLE_CHAT_SPACE_ID,members:people}).photos;
assert.equal(photos.length,4);
assert.equal(JSON.stringify(sheets.get('ActivityVotes').rows),originalVotes);
assert.deepEqual(sheets.get('Candidates').rows.slice(1).map(r=>JSON.stringify(r.slice(0,7))),originalCandidates);
assert.equal(app('dashboard',alice).activities[0].candidates.find(c=>c.id===bob.id).avatarUrl,people[2].avatarUrl);
assert.equal(context.safeAvatarUrl_('javascript:alert(1)'),'');
assert.equal(context.safeAvatarUrl_('https://evil.example/photo'),'');
assert.equal(context.safeAvatarUrl_('https://googleusercontent.com.evil.example/photo'),'');
const duplicateActivity={id:'duplicate',topic:'Same name',status:'open',endAt:'2030-12-06T12:00:00Z',awards:[],candidates:[{id:'one',name:'Alex',email:'alex.one@muze.co.th'},{id:'two',name:'alex',email:'alex.two@muze.co.th'}]};
const privateChoices=context.appPublic_(duplicateActivity,[],alice).candidates;
assert.equal(privateChoices[0].disambiguator,'alex.one@muze.co.th');
assert.equal(privateChoices[1].disambiguator,'alex.two@muze.co.th');
assert.ok(context.appPublic_(duplicateActivity,[],null).candidates.every(c=>c.disambiguator===''));
context.updateCandidateAvatars_({spaceId:env.GOOGLE_CHAT_SPACE_ID,members:people.map(p=>({...p,avatarUrl:''}))});
assert.equal(sheets.get('Candidates').rows.find(r=>r[0]===bob.id)[7],people[2].avatarUrl);
const savedFetch=globalThis.fetch;let chatCalls=0;
const photoEnv={...env,GOOGLE_CHAT_CLIENT_ID:'mock-id',GOOGLE_CHAT_CLIENT_SECRET:'mock-secret',GOOGLE_CHAT_REFRESH_TOKEN:'mock-refresh-token'};
globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://script.google.com/'))return Response.json(JSON.parse(context.doPost({postData:{contents:options.body}}).value));
  if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock-access'});
  if(String(url).startsWith('https://chat.googleapis.com/')){chatCalls++;return Response.json({memberships:people.map(p=>({state:'JOINED',member:{type:'HUMAN',name:p.chatUserId,email:p.email,displayName:p.name,avatarUrl:p.avatarUrl}}))});}
  throw Error('Unexpected network request');
};
try{
  assert.equal((await worker.fetch(request('/api/candidate-photos',null),photoEnv)).status,401);
  const result=await(await worker.fetch(request('/api/candidate-photos',alice),photoEnv)).json();
  assert.equal(result.photos.length,4);assert.ok(result.photos.every(p=>Object.keys(p).sort().join(',')==='avatarUrl,id'));
  await worker.fetch(request('/api/candidate-photos',alice),photoEnv);assert.equal(chatCalls,1);
}finally{globalThis.fetch=savedFetch;}
console.log('PASS: real avatar URLs, safe hosts, existing activity enrichment, preserved ballots/identities, member-only photo endpoint and caching. All network mocked.');
