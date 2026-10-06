/**
 * Vote backend for Google Sheets.
 * Bind this script to the voting spreadsheet, then deploy as a Web app:
 * Execute as: Me / Who has access: Anyone
 */
const SHEETS = { config: 'Config', candidates: 'Candidates', votes: 'Votes', results: 'Results' };

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.config, [['key', 'value']]);
  ensureSheet_(ss, SHEETS.candidates, [['candidateId', 'name', 'team', 'active']]);
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
    if (body.action === 'vote') return json_(recordVote_(body));
    if (body.action === 'saveConfig') return json_(saveConfig_(body));
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
  const names = Array.isArray(body.candidates) ? body.candidates.map(String).map(s=>s.trim()).filter(Boolean) : getCandidates_().map(c=>c.name);
  const awards = Array.isArray(body.awards) ? body.awards.map(String).map(s=>s.trim()).filter(Boolean) : old.awards;
  if (!names.length || names.length > 500 || new Set(names).size !== names.length) throw Error('กรุณาระบุรายชื่อที่ไม่ซ้ำกัน 1–500 คน');
  if (!awards.length || awards.length > 50) throw Error('กรุณาระบุรางวัล 1–50 อันดับ');
  const candidates = getCandidates_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEETS.votes).getLastRow() > 1 && JSON.stringify(names) !== JSON.stringify(candidates.map(c=>c.name))) throw Error('แก้รายชื่อไม่ได้หลังมีผู้โหวตแล้ว');
  const values = [['key', 'value'], ['activityId', old.activityId || Utilities.getUuid()], ['topic', topic], ['endAt', endAt], ['status', body.status === 'closed' ? 'closed' : 'open'], ['awards', JSON.stringify(awards)]];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.config) || SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEETS.config);
  sheet.clearContents(); sheet.getRange(1, 1, values.length, 2).setValues(values);
  const rows = [['candidateId','name','team','active'], ...names.map(name=>{const c=candidates.find(x=>x.name===name);return[c?c.candidateId:Utilities.getUuid(),name,c?c.team:'','TRUE'];})];
  const candidateSheet = ss.getSheetByName(SHEETS.candidates); candidateSheet.clearContents(); candidateSheet.getRange(1,1,rows.length,4).setValues(rows);
  refreshResults_();
  return { ok: true, config: getConfig_() };
}

function getConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.config);
  if (!sheet) return { exists: false, topic: '', endAt: '', status: 'none', awards: [], candidates: [] };
  const config = {}; sheet.getDataRange().getValues().slice(1).forEach(row => config[row[0]] = row[1]);
  const exists = Boolean(config.activityId && config.topic);
  return { exists, activityId: config.activityId || '', topic: exists ? config.topic : '', endAt: exists ? (config.endAt || '') : '', status: exists ? (config.status || 'closed') : 'none', awards: exists ? JSON.parse(config.awards || '[]') : [], candidates: exists ? getCandidates_() : [] };
}

function getCandidates_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.candidates);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({ candidateId: String(r[0]), name: String(r[1]), team: String(r[2]), active: String(r[3]).toUpperCase() !== 'FALSE' }));
}

function refreshResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const votes = ss.getSheetByName(SHEETS.votes).getDataRange().getValues().slice(1); const candidates = getCandidates_();
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
