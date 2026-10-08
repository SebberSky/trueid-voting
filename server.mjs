const ORIGIN = 'https://trueid-voting.chawapon-rr.chatgpt.site';
const SHEET = 'https://script.google.com/macros/s/AKfycbxOSQQdiI2e07sRRkQ7mltkTadgF4gwVMxgwpzfGyZJ33P8MzDwWw21c4Nv8ZSgl_Yi/exec';
const ADMINS = ['kittisak.bua@truedigital.com'];
const CHAT_DOMAINS = new Set(['muze.co.th', 'truedigital.com']);
const CHAT_CALLBACK = ORIGIN+'/oauth/google-chat/callback';
const CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.memberships.readonly';
function votingEnvironment(env) {return {environment:env.VOTING_ENV||'production',candidateSource:env.CANDIDATE_SOURCE||'client_and_chat',spaceName:env.GOOGLE_CHAT_SPACE_NAME||'Google Chat'};}
function syncBody(env,members) {return {action:'syncChatMembers',members,spaceId:env.GOOGLE_CHAT_SPACE_ID,environment:votingEnvironment(env).environment,candidateSource:votingEnvironment(env).candidateSource,syncedAt:new Date().toISOString()};}
function announcementDeadline(value) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('th-TH-u-ca-gregory',{timeZone:'Asia/Bangkok',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${p.day} ${p.month} ${p.year} · ${p.hour}:${p.minute} น.`;
}
const enc = new TextEncoder();
const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const cookies = r => Object.fromEntries((r.headers.get('Cookie') || '').split(';').map(x => x.trim().split('=')));
const b64 = s => btoa(String.fromCharCode(...enc.encode(s))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign','verify']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
}
async function sign(data, env) { const value = b64(JSON.stringify(data)); return value + '.' + await hmac('session:'+value, env.JIRA_CLIENT_SECRET); }
async function session(req, env) {
  try {
    const [value, sig] = (cookies(req).tv_session || '').split('.');
    if (!value || !sig || sig !== await hmac('session:'+value, env.JIRA_CLIENT_SECRET)) return null;
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0))));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function redirect(url, values=[]) { const headers = new Headers({'Location':url, 'Cache-Control':'no-store'}); values.forEach(v => headers.append('Set-Cookie',v)); return new Response(null,{status:302,headers}); }
function authError(message) { return new Response(`<!doctype html><html lang="th"><meta charset="utf-8"><title>TrueID Voting</title><main style="font:18px system-ui;max-width:600px;margin:80px auto;padding:24px"><h1>เข้าสู่ระบบไม่สำเร็จ</h1><p>${message}</p><a href="/auth/login">ลองเข้าสู่ระบบอีกครั้ง</a></main></html>`,{status:400,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}); }
async function sheetWrite(body,env) {
  const payload=JSON.stringify(body);
  const response=await fetch(SHEET,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({payload,signature:await hmac(payload,env.JIRA_CLIENT_SECRET)})});
  if(!response.ok)throw Error('Google Sheet ไม่ตอบกลับ');
  const result=await response.json();
  if(result.ok===false)throw Error(result.error||'บันทึกข้อมูลไม่สำเร็จ');
  return result;
}
async function currentUser(req,env) {
  const actor=await session(req,env);
  return actor ? (await sheetWrite({action:'app',op:'profile',actor},env)).user : null;
}
async function fetchChatMembers(env, replacementRefreshToken) {
  const stored=replacementRefreshToken?null:await sheetWrite({action:'getChatConnection'},env);
  const refreshToken=replacementRefreshToken||stored?.refreshToken||env.GOOGLE_CHAT_REFRESH_TOKEN;
  if (!env.GOOGLE_CHAT_CLIENT_ID || !env.GOOGLE_CHAT_CLIENT_SECRET || !refreshToken || !env.GOOGLE_CHAT_SPACE_ID) throw Error('ยังไม่ได้เชื่อมต่อ Google Chat');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.GOOGLE_CHAT_CLIENT_ID,client_secret:env.GOOGLE_CHAT_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'}),
    signal:AbortSignal.timeout(15000)
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw Error(token.error==='invalid_grant' ? 'สิทธิ์ Google Chat หมดอายุหรือถูกถอน กรุณาเชื่อมต่อบัญชีผู้ดูแลใหม่' : 'Google ไม่อนุญาตให้ต่ออายุการเชื่อมต่อ Chat');
  const members = [], seenPages = new Set(), seenIds = new Set(), seenEmails = new Set();
  let pageToken = '', pages = 0, skipped = 0;
  do {
    const target = new URL('https://chat.googleapis.com/v1/spaces/'+encodeURIComponent(env.GOOGLE_CHAT_SPACE_ID)+'/members');
    target.searchParams.set('pageSize','1000');target.searchParams.set('filter','member.type = "HUMAN"');
    if(pageToken)target.searchParams.set('pageToken',pageToken);
    const response = await fetch(target,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
    const result = await response.json();
    if (!response.ok) throw Error(response.status===403 ? 'บัญชีที่เชื่อมต่อไม่มีสิทธิ์อ่านสมาชิกห้อง Chat หรือถูกนโยบายองค์กรบล็อก' : 'อ่านสมาชิก Google Chat ไม่สำเร็จ ('+response.status+')');
    for (const membership of result.memberships || []) {
      if(membership.state!=='JOINED'||membership.member?.type!=='HUMAN')continue;
      const member=membership.member,email=String(member.email||'').trim().toLowerCase();
      if(!CHAT_DOMAINS.has(email.split('@')[1])||!/^users\/\d+$/.test(member.name||'')){skipped++;continue;}
      if(seenIds.has(member.name))continue;
      if(seenEmails.has(email))throw Error('พบอีเมลซ้ำในรายชื่อสมาชิก จึงยังไม่เปลี่ยนข้อมูลเดิม');
      seenIds.add(member.name);seenEmails.add(email);members.push({email,name:String(member.displayName||email),chatUserId:member.name});
    }
    pages++;pageToken=result.nextPageToken||'';
    if(pageToken&&(seenPages.has(pageToken)||pages>=100))throw Error('ดึงสมาชิกไม่ครบทุกหน้า จึงยังไม่เปลี่ยนข้อมูลเดิม');
    seenPages.add(pageToken);
  } while(pageToken);
  if(!members.length)throw Error('ไม่พบสมาชิกที่ใช้ได้ จึงเก็บรายชื่อเดิมไว้');
  return {members,pages,skipped};
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/auth/google-chat') {
        const user=await currentUser(req,env);
        if(!user)return json({error:'กรุณาเข้าสู่ระบบด้วย Jira ก่อน'},401);
        if(!user.admin)return json({error:'เฉพาะผู้ดูแลเท่านั้น'},403);
        if(!env.GOOGLE_CHAT_CLIENT_ID||!env.GOOGLE_CHAT_CLIENT_SECRET)return redirect('/?chat=unconfigured');
        const state=crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID();
        const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
        const value=b64(JSON.stringify({state,verifier,userId:user.id,exp:Date.now()+600000}));
        const proof=value+'.'+await hmac('chat-oauth:'+value,env.JIRA_CLIENT_SECRET);
        const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        target.search=new URLSearchParams({client_id:env.GOOGLE_CHAT_CLIENT_ID,redirect_uri:CHAT_CALLBACK,response_type:'code',scope:CHAT_SCOPE,access_type:'offline',prompt:'consent select_account',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
        return redirect(target.toString(),[cookie('tv_chat_oauth',proof,600)]);
      }
      if (url.pathname === '/oauth/google-chat/callback') {
        const finish=status=>redirect('/?chat='+status+'#memberAdmin',[cookie('tv_chat_oauth','',0)]);
        const user=await currentUser(req,env);
        if(!user?.admin)return finish('expired');
        try {
          const [value,sig]=(cookies(req).tv_chat_oauth||'').split('.');
          if(!value||!sig||sig!==await hmac('chat-oauth:'+value,env.JIRA_CLIENT_SECRET))return finish('expired');
          const proof=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));
          if(proof.exp<=Date.now()||proof.userId!==user.id||!url.searchParams.get('state')||proof.state!==url.searchParams.get('state'))return finish('expired');
          if(url.searchParams.has('error'))return finish('denied');
          const code=url.searchParams.get('code');if(!code)return finish('failed');
          const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CHAT_CLIENT_ID,client_secret:env.GOOGLE_CHAT_CLIENT_SECRET,code,code_verifier:proof.verifier,redirect_uri:CHAT_CALLBACK,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
          const token=await response.json();
          if(!response.ok||!token.refresh_token)return finish('failed');
          // Verify access to the intended room before replacing the working connection.
          const latest=await fetchChatMembers(env,token.refresh_token);
          await sheetWrite({action:'saveChatConnection',refreshToken:token.refresh_token},env);
          await sheetWrite(syncBody(env,latest.members),env);
          return finish('connected');
        }catch{return finish('failed');}
      }
      if (url.pathname === '/auth/login') {
        if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET) return authError('ยังไม่ได้ตั้งค่าการเชื่อมต่อ Jira');
        const state = crypto.randomUUID();
        const target = new URL('https://auth.atlassian.com/authorize');
        target.search = new URLSearchParams({audience:'api.atlassian.com',client_id:env.JIRA_CLIENT_ID,scope:'read:me read:jira-user',redirect_uri:ORIGIN+'/oauth/callback',state,response_type:'code',prompt:'consent'}).toString();
        const activity=url.searchParams.get('activity')||'';
        return redirect(target.toString(),[cookie('tv_oauth_state',state,600),cookie('tv_login_activity',/^[a-zA-Z0-9_-]{1,80}$/.test(activity)?activity:'',600)]);
      }
      if (url.pathname === '/oauth/callback') {
        if (url.searchParams.has('error')) return authError('การอนุญาตเข้าถึงบัญชี Jira ถูกยกเลิก');
        if (!url.searchParams.get('state') || url.searchParams.get('state') !== cookies(req).tv_oauth_state) return authError('คำขอเข้าสู่ระบบหมดอายุ กรุณาเริ่มเข้าสู่ระบบใหม่');
        const tokenResponse = await fetch('https://auth.atlassian.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:env.JIRA_CLIENT_ID,client_secret:env.JIRA_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:ORIGIN+'/oauth/callback'})});
        const token = await tokenResponse.json();
        if (!tokenResponse.ok || !token.access_token) return authError('Jira ยืนยันบัญชีไม่สำเร็จ (token '+tokenResponse.status+')');
        const profileResponse = await fetch('https://api.atlassian.com/me',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'}});
        const profile = await profileResponse.json();
        if (!profileResponse.ok || !profile.account_id) return authError('อ่านข้อมูลบัญชี Jira ไม่สำเร็จ ('+profileResponse.status+')');
        const email = String(profile.email || '').toLowerCase();
        const user = {id:profile.account_id,email,name:profile.name || email,admin:ADMINS.includes(email),exp:Date.now()+8*3600000};
        await sheetWrite({action:'registerClient',accountId:user.id,name:user.name,email:user.email},env);
        const activity=cookies(req).tv_login_activity||'';
        return redirect(/^[a-zA-Z0-9_-]{1,80}$/.test(activity)?'/?activity='+encodeURIComponent(activity)+'#vote':'/#activities',[cookie('tv_session',await sign(user,env),8*3600),cookie('tv_oauth_state','',0),cookie('tv_login_activity','',0)]);
      }
      if (url.pathname === '/auth/logout' && req.method === 'POST') {
        if (req.headers.get('Origin') !== ORIGIN) return json({error:'Forbidden'},403);
        return redirect('/',[cookie('tv_session','',0)]);
      }
      if (url.pathname === '/api/session') {
        const actor=await session(req,env);
        if(actor)await sheetWrite({action:'registerClient',accountId:actor.id,name:actor.name,email:actor.email},env);
        return json({user:actor?(await sheetWrite({action:'app',op:'profile',actor},env)).user:null});
      }
      if (['/api/chat/status','/api/chat/sync','/api/chat/connect'].includes(url.pathname)) {
        const user=await currentUser(req,env);
        if(!user)return json({ok:false,error:'กรุณาเข้าสู่ระบบก่อน'},401);
        if(!user.admin)return json({ok:false,error:'เฉพาะผู้ดูแลเท่านั้น'},403);
        const configured=Boolean(env.GOOGLE_CHAT_CLIENT_ID&&env.GOOGLE_CHAT_CLIENT_SECRET&&env.GOOGLE_CHAT_SPACE_ID);
        if(url.pathname==='/api/chat/status'&&req.method==='GET') {
          const status=await sheetWrite({action:'chatStatus'},env);
          const mode=votingEnvironment(env),needsSync=status.chatSpaceId!==env.GOOGLE_CHAT_SPACE_ID||status.candidateSource!==mode.candidateSource;
          return json({...status,...mode,...(needsSync?{count:0,members:[],syncedAt:null}:{}),needsSync,connected:configured&&Boolean(env.GOOGLE_CHAT_REFRESH_TOKEN||status.hasSavedConnection)});
        }
        if(['/api/chat/sync','/api/chat/connect'].includes(url.pathname)&&req.method==='POST') {
          if(req.headers.get('Origin')!==ORIGIN)return json({ok:false,error:'Forbidden'},403);
          try {
            let replacement;
            if(url.pathname==='/api/chat/connect'){
              const body=await req.json();replacement=String(body.refreshToken||'').trim();
              if(replacement.length<20||replacement.length>4096)throw Error('กรุณาระบุ Refresh token ที่ถูกต้อง');
            }
            const latest=await fetchChatMembers(env,replacement);
            if(replacement)await sheetWrite({action:'saveChatConnection',refreshToken:replacement},env);
            const result=await sheetWrite(syncBody(env,latest.members),env);
            return json({...result,pages:latest.pages,skipped:latest.skipped});
          }catch(e){return json({ok:false,error:e.message},400);}
        }
        return json({ok:false,error:'Method not allowed'},405);
      }
      if (url.pathname === '/api/announcement') {
        if(req.method!=='POST')return json({error:'Method not allowed'},405);
        const user=await currentUser(req,env);
        if(!user)return json({error:'กรุณาเข้าสู่ระบบก่อน'},401);
        if(!user.admin||req.headers.get('Origin')!==ORIGIN)return json({error:'เฉพาะผู้ดูแลจากเว็บนี้เท่านั้น'},403);
        const body=await req.json();
        const config=await sheetWrite({action:'app',op:'config',actor:user,activityId:body.activityId},env),mode=votingEnvironment(env);
        if(!config.exists||config.status!=='open'||!Number.isFinite(Date.parse(config.endAt))||Date.parse(config.endAt)<=Date.now())return json({error:'ต้องมีกิจกรรมที่เปิดโหวตและยังไม่สิ้นสุดก่อนประกาศ'},400);
        const expected={test:'AAQA0MkG6JM',production:'AAQASHHP1Y4'}[mode.environment];
        let target;
        try{target=new URL(env.GOOGLE_CHAT_WEBHOOK_URL);}catch{return json({error:'ยังไม่ได้ตั้งค่า webhook ของห้องนี้'},400);}
        if(!expected||env.GOOGLE_CHAT_SPACE_ID!==expected||config.chatSpaceId!==expected||target.origin!=='https://chat.googleapis.com'||target.pathname!=='/v1/spaces/'+expected+'/messages'||!target.searchParams.get('key')||!target.searchParams.get('token'))return json({error:'ห้องหรือ webhook ไม่ตรงกับ environment หยุดส่งเพื่อความปลอดภัย'},400);
        const fingerprint=await hmac(JSON.stringify([config.activityId,config.topic,config.endAt,mode.environment,expected]),env.JIRA_CLIENT_SECRET),requestId=crypto.randomUUID();
        const claim=await sheetWrite({action:'claimAnnouncement',activityId:config.activityId,topic:config.topic,endAt:config.endAt,environment:mode.environment,spaceId:expected,fingerprint,requestId},env);
        if(claim.alreadySent)return json({ok:true,alreadySent:true});
        const finish=state=>sheetWrite({action:'finishAnnouncement',activityId:config.activityId,requestId,...state},env);
        const topic=String(config.topic).slice(0,200).replace(/[<>]/g,'');
        const text=`<users/all>\nTrueID Voting — เปิดโหวต\n${topic}\nทุกบัญชีโหวตได้ครั้งเดียวต่อกิจกรรม\nสิ้นสุด ${announcementDeadline(config.endAt)} (เวลาไทย)\n${ORIGIN}/?activity=${encodeURIComponent(config.activityId)}#vote`;
        let response;
        try{response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(15000)});}
        catch{await finish({status:'unknown'});return json({error:'ยังยืนยันการส่งไม่ได้ กรุณาตรวจในห้องแชทก่อน ไม่ส่งซ้ำอัตโนมัติ'},502);}
        if(!response.ok){await finish({status:response.status>=500?'unknown':'failed'});return json({error:'Chat ตอบกลับ HTTP '+response.status+' ไม่ส่งซ้ำอัตโนมัติ'},502);}
        let receipt;try{receipt=await response.json();}catch{receipt=null;}
        if(!String(receipt?.name||'').startsWith('spaces/'+expected+'/messages/')){await finish({status:'unknown'});return json({error:'ไม่มีใบยืนยันจาก Chat กรุณาตรวจในห้องก่อน ไม่ส่งซ้ำอัตโนมัติ'},502);}
        try{await finish({status:'sent',messageName:receipt.name});}
        catch{return json({error:'Chat รับข้อความแล้ว แต่บันทึกสถานะไม่สำเร็จ กรุณาตรวจในห้องก่อน ไม่ส่งซ้ำ'},502);}
        return json({ok:true,alreadySent:false,spaceName:mode.spaceName});
      }
      if (url.pathname === '/api/data') {
        const actor=await session(req,env),mode=votingEnvironment(env);
        const result=await sheetWrite({action:'app',op:'dashboard',actor,activityId:url.searchParams.get('activity')||''},env);
        return json({...result,...mode});
      }
      if (['/api/app','/api/sheet'].includes(url.pathname) && req.method === 'POST') {
        if (req.headers.get('Origin') !== ORIGIN) return json({ok:false,error:'Forbidden'},403);
        const user = await session(req,env);
        if (!user) return json({ok:false,error:'กรุณาเข้าสู่ระบบด้วย Jira ก่อน'},401);
        const body = await req.json();
        const op=url.pathname==='/api/sheet'?(body.action==='vote'?'vote':body.action==='saveConfig'?(body.activityId?'update':'create'):''):body.op;
        if(!['create','update','vote','close','setRole','history','reminderAdd','reminderCancel','reminderEnable','reminderDisable','reminderInterval','reminderStop'].includes(op))return json({ok:false,error:'Unknown action'},400);
        // Identity and role are never accepted from browser input.
        const payload={action:'app',op,actor:{id:user.id,email:user.email,name:user.name},activityId:body.activityId,candidateId:body.candidateId,topic:body.topic,startAt:body.startAt,allowAdminVote:body.allowAdminVote,endAt:body.endAt,awards:body.awards,email:body.email,role:body.role,sendAt:body.sendAt,reminderId:body.reminderId,intervalMinutes:body.intervalMinutes,reminderIntervalMinutes:body.reminderIntervalMinutes};
        if(op==='reminderEnable'){
          const mode=votingEnvironment(env);payload.environment=mode.environment;payload.spaceId=env.GOOGLE_CHAT_SPACE_ID;payload.webhook=env.GOOGLE_CHAT_WEBHOOK_URL;
        }
        try {return json(await sheetWrite(payload,env));}catch(e){return json({ok:false,error:e.message},400);}
      }
      if (url.pathname.startsWith('/api/')) return json({error:'Not found'},404);
      if (url.pathname === '/client.js') return new Response(CLIENT,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
      return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    } catch { return url.pathname.startsWith('/api/') ? json({ok:false,error:'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่'},502) : authError('เชื่อมต่อ Jira ไม่สำเร็จ กรุณาลองใหม่'); }
  }
};
