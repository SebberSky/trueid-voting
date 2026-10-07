// Multi-activity reminders. Votes and reminders share one lock at send time.
const REMINDER_SHEET='VoteReminders';
const REMINDER_HEADERS=['id','activityId','sendAt','status','mentionedIds','lastAttemptAt','sentAt','messageNames','error','environment','spaceId','createdBy','planId'];
const REMINDER_PLAN_SHEET='VoteReminderIntervals';
const REMINDER_PLAN_HEADERS=['id','activityId','intervalMinutes','nextAt','status','environment','spaceId','createdBy','updatedAt','lastStatus','lastSentAt','error'];
const REMINDER_SITE='https://trueid-voting.chawapon-rr.chatgpt.site/';
const REMINDER_GRACE_MS=10*60*1000;
function reminderRows_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();ensureSheet_(ss,REMINDER_SHEET,[REMINDER_HEADERS]);
  return ss.getSheetByName(REMINDER_SHEET).getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>Object.fromEntries(REMINDER_HEADERS.map((key,i)=>[key,r[i]||''])));
}
function saveReminderRows_(rows){
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REMINDER_SHEET).getRange(1,1,rows.length+1,REMINDER_HEADERS.length).setValues([REMINDER_HEADERS,...rows.map(r=>REMINDER_HEADERS.map(k=>r[k]||''))]);
}
function reminderWebhook_(mode,url){
  const expected={test:'AAQA0MkG6JM',production:'AAQASHHP1Y4'}[mode.environment];
  if(!expected||mode.chatSpaceId!==expected||typeof url!=='string'||!url.startsWith('https://chat.googleapis.com/v1/spaces/'+expected+'/messages?')||!/[?&]key=[^&]+/.test(url)||!/[?&]token=[^&]+/.test(url))throw Error('Webhook ไม่ตรงกับห้องและ environment');
  return url;
}
function reminderEngine_(){
  const props=PropertiesService.getScriptProperties();
  return {enabled:props.getProperty('VOTE_REMINDERS_ENABLED')==='true',lastTickAt:props.getProperty('REMINDER_LAST_TICK_AT')||null};
}
function reminderPlans_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();ensureSheet_(ss,REMINDER_PLAN_SHEET,[REMINDER_PLAN_HEADERS]);
  return ss.getSheetByName(REMINDER_PLAN_SHEET).getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>Object.fromEntries(REMINDER_PLAN_HEADERS.map((key,i)=>[key,r[i]||''])));
}
function saveReminderPlans_(plans){
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REMINDER_PLAN_SHEET).getRange(1,1,plans.length+1,REMINDER_PLAN_HEADERS.length).setValues([REMINDER_PLAN_HEADERS,...plans.map(p=>REMINDER_PLAN_HEADERS.map(k=>p[k]||''))]);
}
function reminderIntervalView_(activityId){
  const p=reminderPlans_().find(p=>p.activityId===activityId);
  const own=p?reminderRows_().filter(r=>r.planId===p.id):[],last=own[own.length-1];
  if(last){p.lastStatus=last.status;p.lastSentAt=last.sentAt||p.lastSentAt;p.error=last.error||p.error;}
  return p?{intervalMinutes:Number(p.intervalMinutes),nextAt:p.nextAt,status:p.status,lastStatus:p.lastStatus,lastSentAt:p.lastSentAt,error:p.error}:null;
}
function validateReminderInterval_(minutes,activity){
  const mode=getVotingEnvironment_();
  if(!reminderEngine_().enabled)throw Error('เปิดระบบเตือนก่อน');
  if(!activity||activity.status==='closed')throw Error('กิจกรรมนี้ปิดโหวตแล้ว');
  if(!Number.isInteger(minutes)||minutes<1||minutes>10080)throw Error('ช่วงเตือนต้องเป็น 1–10080 นาที (ไม่เกิน 7 วัน)');
  const next=Math.max(Date.now(),Date.parse(activity.startAt)||0)+minutes*60000;
  if(next>=Date.parse(activity.endAt))throw Error('ช่วงเตือนยาวเกินเวลาที่เหลือก่อนปิดโหวต');
  reminderWebhook_(mode,PropertiesService.getScriptProperties().getProperty('REMINDER_WEBHOOK_'+mode.environment));
  return next;
}
function saveReminderInterval_(body,activity,actor){
  const minutes=Number(body.intervalMinutes),mode=getVotingEnvironment_(),plans=reminderPlans_(),rows=reminderRows_(),next=validateReminderInterval_(minutes,activity);
  let p=plans.find(p=>p.activityId===activity.id);
  if(!p){p={id:Utilities.getUuid(),activityId:activity.id};plans.push(p);}
  // Replacing a cadence cancels unsent work, never discards past receipts.
  for(const r of rows)if(r.activityId===activity.id&&['pending','partial'].includes(r.status))r.status='cancelled';
  Object.assign(p,{id:Utilities.getUuid(),intervalMinutes:minutes,nextAt:new Date(next).toISOString(),status:'active',environment:mode.environment,spaceId:mode.chatSpaceId,createdBy:actor.email,updatedAt:new Date().toISOString(),lastStatus:'',lastSentAt:'',error:''});
  saveReminderRows_(rows);saveReminderPlans_(plans);
}
function stopReminderInterval_(activity){
  const plans=reminderPlans_(),p=plans.find(p=>p.activityId===activity?.id);
  if(!p)throw Error('ยังไม่มีการตั้งเตือนซ้ำ');
  p.status='stopped';p.nextAt='';p.updatedAt=new Date().toISOString();
  const rows=reminderRows_();for(const r of rows)if(r.planId===p.id&&['pending','partial'].includes(r.status))r.status='cancelled';
  saveReminderRows_(rows);saveReminderPlans_(plans);
}
function queueReminderIntervals_(activities,rows,mode,now){
  const plans=reminderPlans_();
  for(const p of plans){
    if(p.status!=='active')continue;
    const a=activities.find(a=>a.id===p.activityId);
    if(!a||a.status==='closed'){p.status='closed';p.nextAt='';continue;}
    if(p.environment!==mode.environment||p.spaceId!==mode.chatSpaceId){p.status='blocked';p.error='ห้องเปลี่ยนแล้ว กรุณาบันทึกช่วงเตือนใหม่';continue;}
    const own=rows.filter(r=>r.planId===p.id),last=own[own.length-1];
    if(last){p.lastStatus=last.status;p.lastSentAt=last.sentAt||p.lastSentAt;p.error=last.error||'';}
    if(own.some(r=>['unknown','failed','blocked'].includes(r.status))){p.status='blocked';p.nextAt='';continue;}
    if(own.some(r=>['pending','partial','sending'].includes(r.status)))continue;
    const interval=Number(p.intervalMinutes)*60000,start=Date.parse(a.startAt)||0;
    if(Date.parse(p.nextAt)<start+interval)p.nextAt=new Date(start+interval).toISOString();
    const due=Date.parse(p.nextAt);
    if(due>=Date.parse(a.endAt)){p.status='finished';p.nextAt='';continue;}
    if(!Number.isFinite(due)||due>now||a.status!=='open')continue;
    if(now-due>REMINDER_GRACE_MS){p.lastStatus='skipped';p.error='ข้ามรอบที่เลยเวลานาน ไม่ส่งข้อความย้อนหลังติดกัน';p.nextAt=new Date(now+interval).toISOString();continue;}
    rows.push({id:Utilities.getUuid(),activityId:a.id,sendAt:new Date(due).toISOString(),status:'pending',mentionedIds:'[]',messageNames:'[]',environment:mode.environment,spaceId:mode.chatSpaceId,createdBy:p.createdBy,planId:p.id});
    p.nextAt=new Date(now+interval).toISOString();
  }
  saveReminderPlans_(plans);
}
function reminderView_(activityId){
  return reminderRows_().filter(r=>r.activityId===activityId).map(r=>({id:r.id,sendAt:r.sendAt,status:r.status,sentAt:r.sentAt,error:r.error,mentioned:JSON.parse(r.mentionedIds||'[]').length}));
}
function reminderEnable_(body){
  const mode=getVotingEnvironment_();
  if(body.environment!==mode.environment||body.spaceId!==mode.chatSpaceId)throw Error('ห้องเปลี่ยนแล้ว กรุณารีเฟรช');
  const url=reminderWebhook_(mode,body.webhook),props=PropertiesService.getScriptProperties();
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='runVoteReminderTick'))ScriptApp.newTrigger('runVoteReminderTick').timeBased().everyMinutes(1).create();
  props.setProperty('REMINDER_WEBHOOK_'+mode.environment,url);props.setProperty('VOTE_REMINDERS_ENABLED','true');
  return reminderEngine_();
}
function reminderDisable_(){
  PropertiesService.getScriptProperties().setProperty('VOTE_REMINDERS_ENABLED','false');
  return reminderEngine_();
}
function saveVoteReminder_(body,activity,actor){
  const time=Date.parse(String(body.sendAt||'')),mode=getVotingEnvironment_(),rows=reminderRows_();
  if(!reminderEngine_().enabled)throw Error('เปิดระบบตั้งเวลาเตือนก่อน');
  if(!activity||activity.status==='closed')throw Error('ตั้งเวลาได้เฉพาะกิจกรรมที่เปิดโหวตหรือรอเริ่ม');
  if(!/(Z|[+-]\d{2}:\d{2})$/.test(String(body.sendAt||''))||!Number.isFinite(time)||time<=Date.now()||time>=Date.parse(activity.endAt))throw Error('เวลาเตือนต้องอยู่ในอนาคตและก่อนปิดโหวต');
  if(activity.startAt&&time<Date.parse(activity.startAt))throw Error('เวลาเตือนต้องไม่อยู่ก่อนเวลาเริ่มโหวต');
  reminderWebhook_(mode,PropertiesService.getScriptProperties().getProperty('REMINDER_WEBHOOK_'+mode.environment));
  if(rows.filter(r=>['pending','partial'].includes(r.status)).length>=50)throw Error('มีเวลาเตือนรอส่งครบ 50 รายการแล้ว');
  if(rows.some(r=>r.activityId===activity.id&&Date.parse(r.sendAt)===time&&r.status!=='cancelled'))throw Error('มีเวลาเตือนนี้แล้ว');
  rows.push({id:Utilities.getUuid(),activityId:activity.id,sendAt:new Date(time).toISOString(),status:'pending',mentionedIds:'[]',messageNames:'[]',environment:mode.environment,spaceId:mode.chatSpaceId,createdBy:actor.email});saveReminderRows_(rows);
}
function cancelVoteReminder_(body,activity){
  const rows=reminderRows_(),row=rows.find(r=>r.id===body.reminderId&&r.activityId===activity?.id);
  if(!row||!['pending','partial'].includes(row.status))throw Error('ยกเลิกได้เฉพาะรายการที่ยังรอส่ง');
  row.status='cancelled';saveReminderRows_(rows);
}
function reminderPeople_(activity,ballots){
  const stats=appStats_(activity,ballots),active=appRows_(SHEETS.chatMembers).filter(r=>r[2]&&String(r[3]).toUpperCase()!=='FALSE');
  return stats.eligible.filter(c=>!stats.votes.some(r=>appIdentity_(c,{id:String(r[1]),email:String(r[2])}))).map(c=>{
    const member=active.find(r=>String(r[0]).toLowerCase()===c.email||(c.chatUserId&&String(r[2])===c.chatUserId));
    return {id:c.id,chatUserId:member?String(member[2]):''};
  });
}
function runVoteReminderTick(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,busy:true};
  try{
    appMigrate_();appRolesCache=null;
    const props=PropertiesService.getScriptProperties(),now=Date.now(),rows=reminderRows_(),mode=getVotingEnvironment_();
    props.setProperty('REMINDER_LAST_TICK_AT',new Date(now).toISOString());
    const activities=appRows_('Activities').map(appActivity_),ballots=appRows_('ActivityVotes');activities.forEach(a=>appReconcile_(a,ballots));
    if(!reminderEngine_().enabled)return {ok:true,disabled:true};
    for(const r of rows){
      if(r.status==='sending'){r.status='unknown';r.error='ไม่ยืนยันการส่ง ไม่ส่งซ้ำอัตโนมัติ';continue;}
      if(!['pending','partial'].includes(r.status))continue;
      const a=activities.find(a=>a.id===r.activityId);
      if(!a||a.status==='closed'||r.environment!==mode.environment||r.spaceId!==mode.chatSpaceId||Date.parse(r.sendAt)>=Date.parse(a.endAt)||(a.startAt&&Date.parse(r.sendAt)<Date.parse(a.startAt))||now-Date.parse(r.sendAt)>REMINDER_GRACE_MS){r.status='skipped';r.error='กิจกรรมปิดแล้ว ห้องเปลี่ยน หรือเวลาเตือนไม่ตรงช่วงโหวต';}
    }
    queueReminderIntervals_(activities,rows,mode,now);
    saveReminderRows_(rows);
    const row=rows.filter(r=>['pending','partial'].includes(r.status)&&Date.parse(r.sendAt)<=now).sort((a,b)=>Date.parse(a.sendAt)-Date.parse(b.sendAt))[0];
    if(!row)return {ok:true,due:false};
    const a=activities.find(a=>a.id===row.activityId),people=reminderPeople_(a,ballots),already=new Set(JSON.parse(row.mentionedIds||'[]'));
    const pending=people.filter(p=>/^users\/\d+$/.test(p.chatUserId)&&!already.has(p.chatUserId)),missing=people.some(p=>!/^users\/\d+$/.test(p.chatUserId));
    if(!pending.length){row.status=missing?'blocked':already.size?'sent':'skipped';row.error=missing?'ผู้ยังไม่โหวตบางคนไม่มี Chat ID ในห้องนี้':'';saveReminderRows_(rows);return {ok:true,status:row.status};}
    const batch=pending.slice(0,40),topic=String(a.topic).slice(0,200).replace(/[<>]/g,'');
    const text='TrueID Voting — แจ้งเตือนโหวต\n'+topic+'\n'+batch.map(p=>'<'+p.chatUserId+'>').join(' ')+'\nยังไม่โหวต ณ เวลาส่ง · สิ้นสุด '+Utilities.formatDate(new Date(a.endAt),'Asia/Bangkok','dd MMMM yyyy HH:mm')+' (เวลาไทย)\n'+REMINDER_SITE+'?activity='+encodeURIComponent(a.id)+'#vote';
    let webhook;try{webhook=reminderWebhook_(mode,props.getProperty('REMINDER_WEBHOOK_'+mode.environment));}catch(_){row.status='blocked';row.error='Webhook ไม่ตรงกับห้อง';saveReminderRows_(rows);return {ok:false,status:row.status};}
    row.status='sending';row.lastAttemptAt=new Date().toISOString();saveReminderRows_(rows);SpreadsheetApp.flush();
    let response;try{response=UrlFetchApp.fetch(webhook,{method:'post',contentType:'application/json',payload:JSON.stringify({text}),muteHttpExceptions:true});}catch(_){row.status='unknown';row.error='ไม่ยืนยันการส่ง ไม่ส่งซ้ำอัตโนมัติ';saveReminderRows_(rows);return {ok:false,status:row.status};}
    const code=response.getResponseCode();let receipt;try{receipt=JSON.parse(response.getContentText());}catch(_){}
    if(code<200||code>=300||!String(receipt?.name||'').startsWith('spaces/'+mode.chatSpaceId+'/messages/')){row.status=code>=400&&code<500?'failed':'unknown';row.error='Chat ส่งไม่สำเร็จหรือไม่มีใบยืนยัน ไม่ส่งซ้ำอัตโนมัติ';saveReminderRows_(rows);return {ok:false,status:row.status};}
    row.mentionedIds=JSON.stringify([...already,...batch.map(p=>p.chatUserId)]);row.messageNames=JSON.stringify([...JSON.parse(row.messageNames||'[]'),receipt.name]);row.sentAt=new Date().toISOString();
    row.status=pending.length>batch.length?'partial':missing?'blocked':'sent';row.error=missing?'ผู้ยังไม่โหวตบางคนไม่มี Chat ID ในห้องนี้':'';saveReminderRows_(rows);return {ok:true,status:row.status,mentioned:batch.length};
  }finally{lock.releaseLock();}
}
