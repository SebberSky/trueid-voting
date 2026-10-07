// Loaded with Code.gs. New sheets are additive: legacy Config/Votes remain intact.
const ROOT_ADMINS = ['kittisak.bua@truedigital.com'];
const ACTIVITY_HEADERS = ['id','topic','endAt','status','awards','candidates','createdAt','createdBy','closedAt','closeReason','startAt','allowAdminVote'];
const BALLOT_HEADERS = ['activityId','voterId','voterEmail','candidateId','votedAt','candidateName','key'];
let appRolesCache=null;
function appRows_(name) {
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return sheet ? sheet.getDataRange().getValues().slice(1).filter(r=>r[0]) : [];
}
function appRole_(email) {
  email=String(email||'').toLowerCase();
  if(ROOT_ADMINS.includes(email))return 'admin';
  if(!appRolesCache)appRolesCache=new Set(appRows_('Roles').filter(r=>r[1]==='subadmin').map(r=>String(r[0]).toLowerCase()));
  return appRolesCache.has(email)?'subadmin':'client';
}
function appCandidates_() {
  const active=new Set(getCandidates_().filter(c=>c.active).map(c=>c.candidateId));
  return appRows_(SHEETS.candidates).filter(r=>active.has(String(r[0]))).map(r=>({id:String(r[0]),name:String(r[1]),email:String(r[4]||'').toLowerCase(),chatUserId:String(r[5]||'')}));
}
function appActivity_(r,index) {
  return {id:String(r[0]),topic:String(r[1]),endAt:new Date(r[2]).toISOString(),status:String(r[3]),awards:JSON.parse(r[4]||'[]'),candidates:JSON.parse(r[5]||'[]'),createdAt:String(r[6]),createdBy:String(r[7]),closedAt:String(r[8]||''),closeReason:String(r[9]||''),startAt:r[10]?new Date(r[10]).toISOString():'',allowAdminVote:r[11]===true||String(r[11]).toLowerCase()==='true',row:index+2};
}
function appSave_(a) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Activities').getRange(a.row,1,1,ACTIVITY_HEADERS.length).setValues([[a.id,safeSheetText_(a.topic),a.endAt,a.status,JSON.stringify(a.awards),JSON.stringify(a.candidates),a.createdAt,a.createdBy,a.closedAt,a.closeReason,a.startAt||'',a.allowAdminVote===true]]);
}
function appMigrate_() {
  const ss=SpreadsheetApp.getActiveSpreadsheet(),props=PropertiesService.getScriptProperties();
  ensureSheet_(ss,'Activities',[ACTIVITY_HEADERS]);ensureSheet_(ss,'ActivityVotes',[BALLOT_HEADERS]);ensureSheet_(ss,'Roles',[['email','role','updatedAt','updatedBy']]);
  ss.getSheetByName('Activities').getRange(1,1,1,ACTIVITY_HEADERS.length).setValues([ACTIVITY_HEADERS]);
  if(props.getProperty('ACTIVITIES_V2_MIGRATED'))return;
  const legacy=getConfig_();
  if(legacy.exists){
    if(!appRows_('Activities').some(r=>String(r[0])===legacy.activityId)){
      ss.getSheetByName('Activities').appendRow([legacy.activityId,safeSheetText_(legacy.topic),new Date(legacy.endAt).toISOString(),legacy.status,JSON.stringify(legacy.awards),JSON.stringify(appCandidates_()),new Date().toISOString(),'legacy','','']);
    }
    const keys=new Set(appRows_('ActivityVotes').map(r=>String(r[6])));
    const candidates=appCandidates_();
    appRows_(SHEETS.votes).forEach((r,i)=>{
      const key='legacy:'+legacy.activityId+':'+i;
      if(!keys.has(key))ss.getSheetByName('ActivityVotes').appendRow([legacy.activityId,String(r[1]),String(r[3]||'').toLowerCase(),String(r[2]),new Date(r[0]).toISOString(),candidates.find(c=>c.id===String(r[2]))?.name||String(r[2]),key]);
    });
  }
  props.setProperty('ACTIVITIES_V2_MIGRATED','1');
}
function appIdentity_(candidate,actor) {
  return Boolean(actor&&(candidate.id===actor.id||(actor.email&&candidate.email===String(actor.email).toLowerCase())));
}
function appStats_(a,ballots) {
  const votes=ballots.filter(r=>String(r[0])===a.id);
  const eligible=a.candidates.filter(c=>a.allowAdminVote||appRole_(c.email)==='client');
  const completed=eligible.filter(c=>votes.some(r=>appIdentity_(c,{id:String(r[1]),email:String(r[2])}))).length;
  return {votes,eligible,total:eligible.length,completed};
}
function appClose_(a,reason) {
  a.status='closed';a.closeReason=reason;a.closedAt=reason==='deadline'?a.endAt:new Date().toISOString();appSave_(a);
  if(typeof cancelClosedReminders_==='function')cancelClosedReminders_(a.id);
}
function appReconcile_(a,ballots) {
  if(a.status==='closed')return;
  if(a.status==='scheduled'&&Date.parse(a.startAt)<=Date.now()){a.status='open';appSave_(a);}
  const stats=appStats_(a,ballots);
  if(Date.parse(a.endAt)<=Date.now())appClose_(a,'deadline');
  else if(a.status==='open'&&stats.total>0&&stats.completed>=stats.total)appClose_(a,'all_voted');
}
function appPublic_(a,ballots,actor) {
  const stats=appStats_(a,ballots),counts={};
  stats.votes.forEach(r=>counts[String(r[3])]=(counts[String(r[3])]||0)+1);
  const results=a.candidates.map(c=>({id:c.id,name:c.name,votes:counts[c.id]||0,isSelf:appIdentity_(c,actor)})).sort((a,b)=>b.votes-a.votes||a.name.localeCompare(b.name,'th'));
  let previous=-1,rank=0;const ties={};results.forEach(r=>ties[r.votes]=(ties[r.votes]||0)+1);
  results.forEach((r,i)=>{if(r.votes!==previous)rank=i+1;previous=r.votes;r.rank=rank;r.tied=ties[r.votes]>1;r.award=r.votes>0?a.awards[rank-1]||'':'';});
  const mine=actor?stats.votes.find(r=>String(r[1])===actor.id||(actor.email&&String(r[2]).toLowerCase()===actor.email)):null;
  const myVote=mine?{candidateId:String(mine[3]),name:String(mine[5]),votedAt:new Date(mine[4]).toISOString()}:null;
  const role=actor?appRole_(actor.email):null,eligible=actor&&stats.eligible.some(c=>appIdentity_(c,actor));
  return {id:a.id,topic:a.topic,startAt:a.startAt||'',allowAdminVote:a.allowAdminVote===true,endAt:a.endAt,status:a.status,awards:a.awards,createdAt:a.createdAt,closedAt:a.closedAt,closeReason:a.closeReason,total:stats.total,completed:stats.completed,ballotCount:stats.votes.length,results,myVote,canVote:Boolean(eligible&&(role==='client'||a.allowAdminVote)&&!myVote&&a.status==='open'),voteBlockedReason:!actor?'login':role!=='client'&&!a.allowAdminVote?'admin':myVote?'voted':a.status==='scheduled'?'scheduled':a.status!=='open'?'closed':!eligible?'ineligible':'',candidates:a.candidates.map(c=>({id:c.id,name:c.name,isSelf:appIdentity_(c,actor)}))};
}
function app_(body) {
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    appMigrate_();
    appRolesCache=null;
    const actor=body.actor ? {id:String(body.actor.id||''),email:String(body.actor.email||'').toLowerCase(),name:String(body.actor.name||'')} : null;
    const role=actor?appRole_(actor.email):null,manage=role==='admin'||role==='subadmin',op=body.op||'dashboard';
    let activities=appRows_('Activities').map(appActivity_),ballots=appRows_('ActivityVotes');
    activities.forEach(a=>appReconcile_(a,ballots));
    if(!['dashboard','profile','history'].includes(op)&&!actor?.id)throw Error('กรุณาเข้าสู่ระบบก่อน');
    if(['create','update','close','config','reminderAdd','reminderCancel','reminderEnable','reminderDisable','reminderInterval','reminderStop'].includes(op)&&!manage)throw Error('ไม่มีสิทธิ์ผู้ดูแล');
    let a=activities.find(a=>a.id===String(body.activityId||''));
    if(op==='create'||op==='update'){
      const topic=String(body.topic||'').trim(),endAt=String(body.endAt||''),awards=Array.isArray(body.awards)?body.awards.map(String).map(x=>x.trim()).filter(Boolean):[];
      if(!topic||topic.length>200||!Number.isFinite(Date.parse(endAt))||Date.parse(endAt)<=Date.now()||!awards.length||awards.length>50||awards.some(x=>x.length>200))throw Error('กรุณาระบุหัวข้อ วันสิ้นสุดในอนาคต และรางวัล 1–50 อันดับ');
      const startAt=body.startAt===undefined?(a?.startAt||''):String(body.startAt||''),allowAdminVote=body.allowAdminVote===undefined?(a?.allowAdminVote===true):body.allowAdminVote===true;
      if(startAt&&(!Number.isFinite(Date.parse(startAt))||Date.parse(startAt)>=Date.parse(endAt)))throw Error('เวลาเริ่มต้องอยู่ก่อนเวลาสิ้นสุด');
      const startChanged=op==='create'||(startAt?new Date(startAt).toISOString():'')!==(a?.startAt||'');
      if(startChanged&&startAt&&Date.parse(startAt)<=Date.now())throw Error('เวลาเริ่มต้องอยู่ในอนาคต ไม่สามารถกำหนดย้อนหลังได้');
      const reminderMinutes=body.reminderIntervalMinutes===undefined?undefined:Number(body.reminderIntervalMinutes),plan=reminderMinutes===undefined?null:reminderPlans_().find(p=>p.activityId===a?.id);
      if(reminderMinutes!==undefined&&(!Number.isInteger(reminderMinutes)||reminderMinutes<0||reminderMinutes>10080))throw Error('ช่วงเตือนต้องเป็นจำนวนเต็ม 1 นาที ถึง 7 วัน หรือ 0 เพื่อปิด');
      const changeReminder=reminderMinutes>0&&(plan?.status!=='active'||Number(plan.intervalMinutes)!==reminderMinutes);
      if(changeReminder)validateReminderInterval_(reminderMinutes,{startAt,endAt,status:'open'});
      if(op==='update'){
        if(!a||a.status==='closed')throw Error('แก้ไขได้เฉพาะกิจกรรมที่ยังเปิดอยู่หรือรอเริ่ม');
        if(a.status==='open'&&startChanged)throw Error('กิจกรรมเริ่มแล้ว เปลี่ยนเวลาเริ่มไม่ได้');
        if(ballots.some(r=>String(r[0])===a.id)&&startAt!==a.startAt)throw Error('เปลี่ยนเวลาเริ่มไม่ได้เมื่อมีการโหวตแล้ว');
        a.topic=topic;a.endAt=new Date(endAt).toISOString();a.awards=awards;a.startAt=startAt?new Date(startAt).toISOString():'';a.allowAdminVote=allowAdminVote;a.status=Date.parse(a.startAt)>Date.now()?'scheduled':'open';appSave_(a);appReconcile_(a,ballots);
      }else{
        const candidates=appCandidates_();
        if(candidates.filter(c=>allowAdminVote||appRole_(c.email)==='client').length<2)throw Error('ต้องมีผู้มีสิทธิ์อย่างน้อย 2 คน เพื่อให้โหวตโดยไม่เลือกตัวเองได้');
        a={id:Utilities.getUuid(),topic,startAt:startAt?new Date(startAt).toISOString():'',allowAdminVote,endAt:new Date(endAt).toISOString(),status:Date.parse(startAt)>Date.now()?'scheduled':'open',awards,candidates,createdAt:new Date().toISOString(),createdBy:actor.email,closedAt:'',closeReason:'',row:activities.length+2};
        appSave_(a);activities.push(a);
      }
      if(changeReminder&&a.status!=='closed')saveReminderInterval_({intervalMinutes:reminderMinutes},a,actor);
      if(reminderMinutes===0&&plan)stopReminderInterval_(a);
    }else if(op==='vote'){
      if(role!=='client'&&!a?.allowAdminVote)throw Error('แอดมินและ Subadmin ไม่สามารถโหวตได้ในกิจกรรมนี้');
      if(a?.status==='scheduled')throw Error('ยังไม่ถึงเวลาเริ่มโหวต');
      if(!a||a.status!=='open')throw Error('กิจกรรมนี้ปิดโหวตแล้ว');
      const stats=appStats_(a,ballots);
      if(!stats.eligible.some(c=>appIdentity_(c,actor)))throw Error('บัญชีนี้ไม่มีสิทธิ์ในกิจกรรมนี้');
      if(stats.votes.some(r=>String(r[1])===actor.id||(actor.email&&String(r[2]).toLowerCase()===actor.email)))throw Error('คุณโหวตในกิจกรรมนี้แล้ว');
      const candidate=a.candidates.find(c=>c.id===String(body.candidateId));
      if(!candidate)throw Error('ไม่พบผู้เข้าชิง');
      if(appIdentity_(candidate,actor))throw Error('ไม่สามารถโหวตตัวเองได้');
      const vote=[a.id,actor.id,actor.email,candidate.id,new Date().toISOString(),candidate.name,Utilities.getUuid()];
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ActivityVotes').appendRow(vote);ballots.push(vote);appReconcile_(a,ballots);
    }else if(op==='close'){
      if(!a)throw Error('ไม่พบกิจกรรม');if(a.status!=='closed')appClose_(a,'manual');
    }else if(op==='setRole'){
      if(role!=='admin')throw Error('เฉพาะแอดมินหลักเท่านั้นที่จัดการสิทธิ์ได้');
      const email=String(body.email||'').trim().toLowerCase();
      if(ROOT_ADMINS.includes(email)||!appRows_(SHEETS.candidates).some(r=>String(r[4]).toLowerCase()===email))throw Error('เลือก Client ที่มีในระบบและไม่ใช่แอดมินหลัก');
      if(!['client','subadmin'].includes(body.role))throw Error('สิทธิ์ไม่ถูกต้อง');
      const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roles'),roles=appRows_('Roles'),index=roles.findIndex(r=>String(r[0]).toLowerCase()===email);
      const row=[email,body.role,new Date().toISOString(),actor.email];if(index<0)sheet.appendRow(row);else sheet.getRange(index+2,1,1,4).setValues([row]);
      appRolesCache=null;
      activities.forEach(a=>appReconcile_(a,ballots));
    }else if(op==='reminderEnable'){
      reminderEnable_(body);
    }else if(op==='reminderDisable'){
      reminderDisable_();
    }else if(op==='reminderAdd'){
      saveVoteReminder_(body,a,actor);
    }else if(op==='reminderCancel'){
      cancelVoteReminder_(body,a);
    }else if(op==='reminderInterval'){
      saveReminderInterval_(body,a,actor);
    }else if(op==='reminderStop'){
      stopReminderInterval_(a);
    }else if(!['dashboard','profile','history','config'].includes(op))throw Error('Unknown operation');
    if(op==='config'){
      if(!a)throw Error('ไม่พบกิจกรรม');
      return {...getVotingEnvironment_(),exists:true,activityId:a.id,topic:a.topic,startAt:a.startAt,endAt:a.endAt,status:a.status,awards:a.awards};
    }
    const user=actor?{...actor,role,admin:manage,rootAdmin:role==='admin'}:null;
    if(op==='profile')return {ok:true,user};
    if(op==='history'&&!actor)throw Error('กรุณาเข้าสู่ระบบก่อน');
    const history=actor?ballots.filter(r=>String(r[1])===actor.id||(actor.email&&String(r[2]).toLowerCase()===actor.email)).map(r=>({activityId:String(r[0]),topic:activities.find(a=>a.id===String(r[0]))?.topic||'กิจกรรมเดิม',candidateName:String(r[5]),votedAt:new Date(r[4]).toISOString(),status:activities.find(a=>a.id===String(r[0]))?.status||'closed'})).sort((a,b)=>Date.parse(b.votedAt)-Date.parse(a.votedAt)):[];
    return {ok:true,user,...(manage&&typeof reminderEngine_==='function'?{reminderEngine:reminderEngine_()}:{}),activities:activities.map(a=>({...appPublic_(a,ballots,actor),...(manage&&typeof reminderView_==='function'?{reminders:reminderView_(a.id),reminderInterval:reminderIntervalView_(a.id),closureNotification:closureNotificationView_(a.id)}:{})})).reverse(),history,selectedId:a?.id||body.activityId||'',roleMembers:role==='admin'?appRows_(SHEETS.candidates).map(r=>({id:String(r[0]),name:String(r[1]),email:String(r[4]),role:appRole_(r[4])})).filter(c=>c.email):[]};
  }finally{lock.releaseLock();}
}
