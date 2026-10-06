// Explicitly authorized test-room only. Credentials arrive on hidden stdin, never in files/argv.
const TEST_SPACE='AAQA0MkG6JM';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let input='';
process.stdin.on('data',async chunk=>{
  input+=chunk;if(!input.includes('\n'))return;
  process.stdin.pause();
  try {
    const options=JSON.parse(input.trim());input='';
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:options.clientId,client_secret:options.clientSecret,refresh_token:options.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
    const token=await tokenResponse.json();if(!tokenResponse.ok||!token.access_token)throw Error('Google token refresh failed: HTTP '+tokenResponse.status);
    const members=[],seen=new Set();let page='';
    do {
      const url=new URL('https://chat.googleapis.com/v1/spaces/'+TEST_SPACE+'/members');url.searchParams.set('pageSize','1000');if(page)url.searchParams.set('pageToken',page);
      const response=await fetch(url,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
      const result=await response.json();if(!response.ok)throw Error('Read test-room members failed: HTTP '+response.status);
      for(const m of result.memberships||[])if(m.state==='JOINED'&&m.member?.type==='HUMAN'&&/^users\/\d+$/.test(m.member.name||'')&&!seen.has(m.member.name)){seen.add(m.member.name);members.push({chatUserId:m.member.name,name:m.member.displayName||'',email:m.member.email||''});}
      page=result.nextPageToken||'';
    }while(page);
    if(options.mode==='list'){console.log(JSON.stringify({spaceId:TEST_SPACE,members}));process.exit(0);}
    if(options.mode!=='send')throw Error('Unknown mode');
    const target=members.find(m=>m.chatUserId===options.targetId);if(!target)throw Error('Target is not an active human member of the test room');
    const webhook=new URL(options.webhook);
    if(webhook.origin!=='https://chat.googleapis.com'||webhook.pathname!=='/v1/spaces/'+TEST_SPACE+'/messages'||!webhook.searchParams.get('key')||!webhook.searchParams.get('token'))throw Error('Only the explicitly authorized test-room webhook is allowed');
    const response=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'TrueID Voting — ทดสอบการแจ้งเตือน\n<'+target.chatUserId+'>\nทดสอบแท็กเฉพาะสมาชิกห้องนี้ ไม่มีการบันทึกโหวตหรือส่งข้อความเข้าห้องจริง'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Test message failed: HTTP '+response.status+'; do not automatically retry');
    const receipt=await response.json();if(!String(receipt.name||'').startsWith('spaces/'+TEST_SPACE+'/messages/'))throw Error('No valid receipt; do not automatically retry');
    console.log(JSON.stringify({spaceId:TEST_SPACE,tagged:target,messageName:receipt.name,text:receipt.text,annotations:receipt.annotations||[]}));process.exit(0);
  }catch(error){console.log(JSON.stringify({error:error.message}));process.exit(1);}
});
