/**
 * Vote backend for Google Sheets.
 * Bind this script to the voting spreadsheet, then deploy as a Web app:
 * Execute as: Me / Who has access: Anyone
 */
const SHEETS = { config: 'Config', candidates: 'Candidates', votes: 'Votes', results: 'Results', chatMembers: 'ChatMembers' };
const CANDIDATE_HEADERS = ['candidateId', 'name', 'team', 'active', 'email', 'chatUserId', 'source'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.config, [['key', 'value']]);
  ensureCandidates_(ss);
  ensureSheet_(ss, SHEETS.chatMembers, [['email', 'name', 'chatUserId', 'active', 'syncedAt']]);
  ensureSheet_(ss, SHEETS.votes, [['votedAt', 'voterId', 'candidateId', 'voterEmail']]);
  ensureSheet_(ss, SHEETS.results, [['rank', 'candidateId', 'name', 'votes', 'award']]);
  return json_({ ok: true, message: 'Sheets are ready' });
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'config';
  if (action === 'config') return json_(getConfig_());
  if (action === 'results') return json_(getResults_());
  return json_({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('JIRA_CLIENT_SECRET');
    if (!request.payload || !secret) throw new Error('Unauthorized');
    const signature = Utilities.computeHmacSha256Signature(request.payload, secret, Utilities.Charset.UTF_8)
      .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
    if (request.signature !== signature) throw new Error('Unauthorized');
    const body = JSON.parse(request.payload);
    if (body.action === 'registerClient') return json_(registerClient_(body));
    if (body.action === 'vote') return json_(recordVote_(body));
    if (body.action === 'saveConfig') return json_(saveConfig_(body));
    if (body.action === 'syncChatMembers') return json_(syncChatMembers_(body));
    if (body.action === 'chatStatus') return json_(chatStatus_());
    if (body.action === 'getChatConnection') return json_({ok:true,refreshToken:PropertiesService.getScriptProperties().getProperty('GOOGLE_CHAT_REFRESH_TOKEN')||''});
    if (body.action === 'saveChatConnection') {
      if(typeof body.refreshToken!=='string'||body.refreshToken.length<20||body.refreshToken.length>4096)throw Error('Invalid refresh token');
      PropertiesService.getScriptProperties().setProperty('GOOGLE_CHAT_REFRESH_TOKEN',body.refreshToken);
      return json_({ok:true});
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function recordVote_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return recordVoteLocked_(body); } finally { lock.releaseLock(); }
}

function recordVoteLocked_(body) {
  const voterId = String(body.voterId || '').trim();
  const candidateId = String(body.candidateId || '').trim();
  if (!voterId || !candidateId) throw new Error('voterId and candidateId are required');
  const config = getConfig_();
  if (config.status !== 'open') throw new Error('Voting is closed');
  if (config.endAt && new Date(config.endAt).getTime() < Date.now()) throw new Error('Voting has ended');
  const candidates = getCandidates_();
  if (!candidates.some(c => c.candidateId === candidateId && c.active)) throw new Error('Candidate not found');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.votes);
  const rows = sheet.getDataRange().getValues();
  const voterColumn = 1;
  if (rows.slice(1).some(row => String(row[voterColumn]).toLowerCase() === voterId.toLowerCase())) throw new Error('This voter has already voted');
  sheet.appendRow([new Date(), voterId, candidateId, body.voterEmail || '']);
  refreshResults_();
  return { ok: true, message: 'Vote recorded' };
}

function saveConfig_(body) {
  const old = getConfig_();
  const topic = String(body.topic || '').trim(), endAt = String(body.endAt || '');
  if (!topic) throw Error('กรุณาระบุชื่อกิจกรรม');
  if (!Number.isFinite(Date.parse(endAt)) || Date.parse(endAt) <= Date.now()) throw Error('กรุณากำหนดวันสิ้นสุดในอนาคต');
  const awards = Array.isArray(body.awards) ? body.awards.map(String).map(s=>s.trim()).filter(Boolean) : old.awards;
  if (!awards.length || awards.length > 50) throw Error('กรุณาระบุรางวัล 1–50 อันดับ');
  const values = [['key', 'value'], ['activityId', old.activityId || Utilities.getUuid()], ['topic', topic], ['endAt', endAt], ['status', body.status === 'closed' ? 'closed' : 'open'], ['awards', JSON.stringify(awards)]];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.config) || SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEETS.config);
  sheet.clearContents(); sheet.getRange(1, 1, values.length, 2).setValues(values);
  refreshResults_();
  return { ok: true, config: getConfig_() };
}

function getConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.config);
  if (!sheet) return { exists: false, topic: '', endAt: '', status: 'none', awards: [], candidates: [] };
  const config = {}; sheet.getDataRange().getValues().slice(1).forEach(row => config[row[0]] = row[1]);
  const exists = Boolean(config.activityId && config.topic);
  const candidates = getCandidates_();
  return { exists, candidateCount: candidates.filter(c=>c.active).length, activityId: config.activityId || '', topic: exists ? config.topic : '', endAt: exists ? (config.endAt || '') : '', status: exists ? (config.status || 'closed') : 'none', awards: exists ? JSON.parse(config.awards || '[]') : [], candidates: exists ? candidates : [] };
}

function registerClient_(body) {
  const id=String(body.accountId||'').trim(),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase();
  if(!id||!name)throw Error('Missing Jira account');
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    const ss=SpreadsheetApp.getActiveSpreadsheet();
    ensureCandidates_(ss);
    const sheet=ss.getSheetByName(SHEETS.candidates),rows=sheet.getDataRange().getValues();
    const index=rows.findIndex((r,i)=>i>0&&(String(r[0])===id||(email&&String(r[4]).toLowerCase()===email)));
    const safeName=/^[=+@-]/.test(name)?"'"+name:name;
    if(index<0)sheet.appendRow([id,safeName,'','TRUE',email,'','client']);
    else {
      // Keep the canonical candidate ID and chat-managed active status across Jira logins.
      if(String(rows[index][6])!=='chat')sheet.getRange(index+1,2).setValue(safeName);
      if(email&&String(rows[index][4])!==email)sheet.getRange(index+1,5).setValue(email);
    }
    return {ok:true};
  } finally {lock.releaseLock();}
}

function ensureCandidates_(ss) {
  ensureSheet_(ss,SHEETS.candidates,[CANDIDATE_HEADERS]);
  ss.getSheetByName(SHEETS.candidates).getRange(1,1,1,CANDIDATE_HEADERS.length).setValues([CANDIDATE_HEADERS]);
}

function syncChatMembers_(body) {
  if(body.spaceId!=='AAQASHHP1Y4')throw Error('Unexpected Chat space');
  if(!Array.isArray(body.members)||!body.members.length||body.members.length>10000)throw Error('Invalid member list');
  const seenIds={},seenEmails={};
  const members=body.members.map(m=>{
    const email=String(m.email||'').trim().toLowerCase(),name=String(m.name||'').trim(),id=String(m.chatUserId||'');
    if(!/^[^@\s]+@(muze\.co\.th|truedigital\.com)$/.test(email)||!/^users\/\d+$/.test(id)||!name||seenIds[id]||seenEmails[email])throw Error('Invalid or duplicate Chat member');
    seenIds[id]=true;seenEmails[email]=true;
    return {email,name,chatUserId:id};
  });
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    const ss=SpreadsheetApp.getActiveSpreadsheet();ensureCandidates_(ss);
    ensureSheet_(ss,SHEETS.chatMembers,[['email','name','chatUserId','active','syncedAt']]);
    const syncedAt=new Date().toISOString();
    const chatSheet=ss.getSheetByName(SHEETS.chatMembers),candidateSheet=ss.getSheetByName(SHEETS.candidates);
    const previousMembers=chatSheet.getDataRange().getValues().slice(1).filter(r=>r[2]);
    const candidates=candidateSheet.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>{while(r.length<7)r.push('');return r.slice(0,7);});
    const chatRows=members.map(m=>[m.email,safeSheetText_(m.name),m.chatUserId,'TRUE',syncedAt]);
    previousMembers.filter(r=>!seenIds[String(r[2])]).forEach(r=>chatRows.push([r[0],r[1],r[2],'FALSE',syncedAt]));
    let added=0;
    members.forEach(m=>{
      const index=candidates.findIndex(r=>String(r[5])===m.chatUserId||String(r[0])===m.chatUserId||String(r[4]).toLowerCase()===m.email);
      if(index<0){candidates.push([m.chatUserId,safeSheetText_(m.name),'','TRUE',m.email,m.chatUserId,'chat']);added++;}
      else {const row=candidates[index];row[1]=safeSheetText_(m.name);row[3]='TRUE';row[4]=m.email;row[5]=m.chatUserId;row[6]='chat';}
    });
    let inactive=0;
    candidates.forEach(r=>{if(r[6]==='chat'&&!seenIds[String(r[5])]){r[3]='FALSE';inactive++;}});
    // Never delete candidate IDs or vote history when people leave the Chat space.
    chatSheet.getRange(1,1,chatRows.length+1,5).setValues([['email','name','chatUserId','active','syncedAt'],...chatRows]);
    candidateSheet.getRange(1,1,candidates.length+1,7).setValues([CANDIDATE_HEADERS,...candidates]);
    const properties=PropertiesService.getScriptProperties();
    properties.setProperty('CHAT_LAST_SYNC_AT',syncedAt);properties.setProperty('CHAT_SPACE_ID',body.spaceId);
    refreshResults_();
    return {ok:true,count:members.length,added,inactive,syncedAt};
  } finally {lock.releaseLock();}
}

function chatStatus_() {
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.chatMembers);
  const members=sheet?sheet.getDataRange().getValues().slice(1).filter(r=>r[2]&&String(r[3]).toUpperCase()!=='FALSE').map(r=>({email:String(r[0]),name:String(r[1]),chatUserId:String(r[2])})):[];
  const properties=PropertiesService.getScriptProperties();
  return {ok:true,count:members.length,syncedAt:properties.getProperty('CHAT_LAST_SYNC_AT')||null,hasSavedConnection:Boolean(properties.getProperty('GOOGLE_CHAT_REFRESH_TOKEN')),members};
}
function safeSheetText_(value) {return /^[=+@-]/.test(value)?"'"+value:value;}

function getCandidates_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.candidates);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({ candidateId: String(r[0]), name: String(r[1]), team: String(r[2]), active: String(r[3]).toUpperCase() !== 'FALSE' }));
}

function refreshResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const votes = ss.getSheetByName(SHEETS.votes).getDataRange().getValues().slice(1); const candidates = getConfig_().exists ? getCandidates_().filter(c=>c.active) : [];
  const counts = {}; votes.forEach(row => counts[row[2]] = (counts[row[2]] || 0) + 1);
  const awards = getConfig_().awards;
  const output = candidates.map(c => ({ c, votes: counts[c.candidateId] || 0 })).sort((a, b) => b.votes - a.votes).map((x, i) => [i + 1, x.c.candidateId, x.c.name, x.votes, awards[i] || '']);
  const sheet = ss.getSheetByName(SHEETS.results) || ss.insertSheet(SHEETS.results); sheet.clearContents(); sheet.getRange(1, 1, 1, 5).setValues([['rank', 'candidateId', 'name', 'votes', 'award']]);
  if (output.length) sheet.getRange(2, 1, output.length, 5).setValues(output);
}

function getResults_() { refreshResults_(); const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.results); return { ok: true, results: sheet.getDataRange().getValues() }; }
function ensureSheet_(ss, name, values) { let sheet = ss.getSheetByName(name); if (!sheet) sheet = ss.insertSheet(name); if (sheet.getLastRow() === 0) sheet.getRange(1, 1, values.length, values[0].length).setValues(values); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function removeSeededDemo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = ss.getSheetByName(SHEETS.config), candidates = ss.getSheetByName(SHEETS.candidates), votes = ss.getSheetByName(SHEETS.votes);
  const settings = {}; config.getDataRange().getValues().slice(1).forEach(r=>settings[r[0]]=r[1]);
  const ids = candidates.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>String(r[0])).sort().join(',');
  if (settings.topic !== 'รางวัลประจำไตรมาส Q3/2026' || ids !== 'kate-s,ploy-m,ton-n' || votes.getLastRow() > 1) throw Error('Cleanup stopped: data differs from the seeded demo');
  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
  [SHEETS.config,SHEETS.candidates,SHEETS.results].forEach(name=>{const sheet=ss.getSheetByName(name);sheet.copyTo(ss).setName('DemoBackup_'+name+'_'+stamp).hideSheet();sheet.clearContents();});
  setup(); Logger.log('Removed seeded demo; hidden backups preserved.');
}
