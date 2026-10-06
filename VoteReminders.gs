/** Draft only. Add beside Code.gs when ready; never run startRealVoteReminders as a test. */
const REMINDER_SHEET = 'VoteReminders';
const REMINDER_HEADERS = ['id','activityId','sendAt','status','mentionedIds','lastAttemptAt','sentAt','messageNames','error'];
const REMINDER_SITE = 'https://trueid-voting.chawapon-rr.chatgpt.site/';
const REMINDER_GRACE_MS = 10 * 60 * 1000;

function reminderRows_() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss,REMINDER_SHEET,[REMINDER_HEADERS]);
  return ss.getSheetByName(REMINDER_SHEET).getDataRange().getValues().slice(1)
    .filter(r=>r[0]).map(r=>Object.fromEntries(REMINDER_HEADERS.map((key,i)=>[key,r[i]||''])));
}
function saveReminderRows_(rows) {
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REMINDER_SHEET);
  sheet.getRange(1,1,rows.length+1,REMINDER_HEADERS.length)
    .setValues([REMINDER_HEADERS,...rows.map(row=>REMINDER_HEADERS.map(key=>row[key]||''))]);
}
function reminderEmail_(value) { return String(value||'').trim().toLowerCase(); }
function reminderSheetRows_(name) {
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return sheet?sheet.getDataRange().getValues().slice(1):[];
}
function reminderVotes_(activityId) {
  // Existing four-column Votes belongs to the single current activity.
  // A future multi-activity migration MUST backfill column 5 (activityId).
  return reminderSheetRows_(SHEETS.votes).filter(r=>r[1]&&(!r[4]||String(r[4])===activityId));
}
function getClientVoteStatus_(body) {
  const config=getConfig_(),id=String(body.voterId||'').trim(),email=reminderEmail_(body.voterEmail);
  if(!id&&!email)throw Error('Authenticated voter identity required');
  const vote=config.exists?reminderVotes_(config.activityId).find(r=>String(r[1])===id||(email&&reminderEmail_(r[3])===email)):null;
  return {ok:true,activityId:config.activityId||'',hasVoted:Boolean(vote),votedAt:vote?new Date(vote[0]).toISOString():null};
}
function getReminderVoteStatus_() {
  const config=getConfig_();
  const candidateRows=reminderSheetRows_(SHEETS.candidates).filter(r=>r[0]);
  const activeChat=reminderSheetRows_(SHEETS.chatMembers).filter(r=>r[2]&&String(r[3]).toUpperCase()!=='FALSE');
  const people=new Map();
  candidateRows.filter(r=>String(r[3]).toUpperCase()!=='FALSE').forEach(r=>{
    const email=reminderEmail_(r[4]),key=email||String(r[0]);
    people.set(key,{name:String(r[1]),email,candidateId:String(r[0]),chatUserId:'',hasVoted:false,votedAt:null});
  });
  activeChat.forEach(r=>{
    const email=reminderEmail_(r[0]),existing=people.get(email);
    people.set(email,{...(existing||{candidateId:String(r[2])}),name:String(r[1]),email,chatUserId:String(r[2]),hasVoted:false,votedAt:null});
  });
  const byId=new Map();
  people.forEach(p=>{byId.set(p.candidateId,p);if(p.chatUserId)byId.set(p.chatUserId,p);});
  let unresolvedVotes=0;
  if(config.exists)reminderVotes_(config.activityId).forEach(r=>{
    const person=people.get(reminderEmail_(r[3]))||byId.get(String(r[1]));
    if(!person){
      // A known departed voter does not prevent reminders to current members.
      const known=candidateRows.some(c=>String(c[0])===String(r[1])||(r[3]&&reminderEmail_(c[4])===reminderEmail_(r[3])));
      if(!known)unresolvedVotes++;
      return;
    }
    person.hasVoted=true;person.votedAt=new Date(r[0]).toISOString();
  });
  const members=Array.from(people.values()),pending=members.filter(p=>!p.hasVoted);
  return {ok:true,activityId:config.activityId||'',exists:config.exists,total:members.length,
    voted:members.length-pending.length,pending:pending.length,unresolvedVotes,
    missingChatId:pending.filter(p=>!/^users\/\d+$/.test(p.chatUserId)).length,members};
}
function saveVoteReminder_(body) {
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    const config=getConfig_(),time=Date.parse(String(body.sendAt||'')),endTime=Date.parse(config.endAt);
    if(!config.exists||config.status!=='open')throw Error('No open activity');
    if(!/(Z|[+-]\d{2}:\d{2})$/.test(String(body.sendAt||''))||!Number.isFinite(time)||!Number.isFinite(endTime)||time<=Date.now()||time>=endTime)throw Error('Use an ISO timestamp with timezone, after now and before voting ends');
    const rows=reminderRows_();
    if(rows.filter(r=>r.activityId===config.activityId&&['pending','partial'].includes(r.status)).length>=50)throw Error('Too many reminders');
    if(rows.some(r=>r.activityId===config.activityId&&Date.parse(r.sendAt)===time&&r.status!=='cancelled'))throw Error('Duplicate reminder time');
    const row={id:Utilities.getUuid(),activityId:config.activityId,sendAt:new Date(time).toISOString(),status:'pending',mentionedIds:'[]',messageNames:'[]'};
    rows.push(row);saveReminderRows_(rows);return {ok:true,reminder:row};
  }finally{lock.releaseLock();}
}
function cancelVoteReminder_(body) {
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    const rows=reminderRows_(),row=rows.find(r=>r.id===body.id);
    if(!row||!['pending','partial'].includes(row.status))throw Error('Reminder cannot be cancelled');
    row.status='cancelled';saveReminderRows_(rows);return {ok:true};
  }finally{lock.releaseLock();}
}
function listVoteReminders_() {
  return {ok:true,enabled:PropertiesService.getScriptProperties().getProperty('VOTE_REMINDERS_ENABLED')==='true',reminders:reminderRows_(),voteStatus:getReminderVoteStatus_()};
}
function reminderWebhook_() {
  const url=PropertiesService.getScriptProperties().getProperty('GOOGLE_CHAT_WEBHOOK_URL')||'';
  const mode=getVotingEnvironment_(),expected={production:'AAQASHHP1Y4',test:'AAQA0MkG6JM'}[mode.environment];
  // Never embed credentials in source, status responses or exception messages.
  if(!expected||mode.chatSpaceId!==expected||!url.startsWith('https://chat.googleapis.com/v1/spaces/'+expected+'/messages?')||!/[?&]key=/.test(url)||!/[?&]token=/.test(url))throw Error('Webhook secret is missing or targets another environment');
  return url;
}
function startRealVoteReminders() {
  reminderWebhook_();
  const props=PropertiesService.getScriptProperties();
  props.setProperty('VOTE_REMINDERS_ENABLED','true');
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='runVoteReminderTick'))ScriptApp.newTrigger('runVoteReminderTick').timeBased().everyMinutes(1).create();
}
function stopRealVoteReminders() {
  PropertiesService.getScriptProperties().setProperty('VOTE_REMINDERS_ENABLED','false');
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='runVoteReminderTick').forEach(t=>ScriptApp.deleteTrigger(t));
}
function runVoteReminderTick() {
  if(PropertiesService.getScriptProperties().getProperty('VOTE_REMINDERS_ENABLED')!=='true')return {ok:true,disabled:true};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,busy:true};
  try {
    const rows=reminderRows_(),now=Date.now(),row=rows.find(r=>['pending','partial','sending'].includes(r.status)&&Date.parse(r.sendAt)<=now);
    if(!row)return {ok:true,due:false};
    // Never retry ambiguous delivery: Chat might have accepted it before a timeout/crash.
    if(row.status==='sending'){row.status='unknown';row.error='Delivery unconfirmed; manual review required';saveReminderRows_(rows);return {ok:false,status:row.status};}
    const config=getConfig_();
    if(!config.exists||config.activityId!==row.activityId||config.status!=='open'||!Number.isFinite(Date.parse(config.endAt))||Date.parse(config.endAt)<=now||now-Date.parse(row.sendAt)>REMINDER_GRACE_MS){row.status='skipped';row.error='Activity closed, changed, or reminder is too late';saveReminderRows_(rows);return {ok:true,status:row.status};}
    // Re-read committed votes on EVERY batch while holding the same lock as voting.
    const status=getReminderVoteStatus_();
    if(status.unresolvedVotes){row.status='blocked';row.error='Some voter identities cannot be mapped; resolve them before tagging';saveReminderRows_(rows);return {ok:false,status:row.status};}
    const already=new Set(JSON.parse(row.mentionedIds||'[]'));
    const pending=status.members.filter(p=>!p.hasVoted&&/^users\/\d+$/.test(p.chatUserId)&&!already.has(p.chatUserId));
    if(!pending.length){row.status=status.missingChatId?'blocked':'sent';row.error=status.missingChatId?'Pending voters have no active Chat ID':'';row.sentAt=new Date().toISOString();saveReminderRows_(rows);return {ok:true,status:row.status};}
    const batch=pending.slice(0,40);
    const topic=String(config.topic).slice(0,300).replace(/[<>]/g,'');
    const deadline=Utilities.formatDate(new Date(config.endAt),'Asia/Bangkok','dd/MM/yyyy HH:mm');
    const text='แจ้งเตือนโหวต: '+topic+'\n'+batch.map(p=>'<'+p.chatUserId+'>').join(' ')+'\nยังไม่มีบันทึกโหวต ณ เวลาส่ง โปรดโหวตก่อน '+deadline+' (เวลาไทย)\n'+REMINDER_SITE;
    const webhook=reminderWebhook_();
    row.status='sending';row.lastAttemptAt=new Date().toISOString();saveReminderRows_(rows);SpreadsheetApp.flush();
    let response;
    try {response=UrlFetchApp.fetch(webhook,{method:'post',contentType:'application/json',payload:JSON.stringify({text}),muteHttpExceptions:true});}
    catch (_) {row.status='unknown';row.error='Delivery unconfirmed; no automatic retry';saveReminderRows_(rows);return {ok:false,status:row.status};}
    const code=response.getResponseCode();
    if(code<200||code>=300){row.status=code>=500?'unknown':'failed';row.error='Chat HTTP '+code+'; no automatic retry';saveReminderRows_(rows);return {ok:false,status:row.status};}
    let receipt;try{receipt=JSON.parse(response.getContentText());}catch(_){}
    if(!receipt||!String(receipt.name||'').startsWith('spaces/'+config.chatSpaceId+'/messages/')){row.status='unknown';row.error='No valid Chat message receipt; no automatic retry';saveReminderRows_(rows);return {ok:false,status:row.status};}
    row.mentionedIds=JSON.stringify([...already,...batch.map(p=>p.chatUserId)]);
    row.messageNames=JSON.stringify([...JSON.parse(row.messageNames||'[]'),receipt.name]);
    row.sentAt=new Date().toISOString();row.status=pending.length>batch.length?'partial':status.missingChatId?'blocked':'sent';
    row.error=status.missingChatId?'Some pending voters have no active Chat ID':'';saveReminderRows_(rows);
    return {ok:true,status:row.status,mentioned:batch.length};
  }finally{lock.releaseLock();}
}
