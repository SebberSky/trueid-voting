const $ = s => document.querySelector(s);
const toast = $('#toast');
let user = null, data = null;
function formatVotingDate(value) {
  const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return 'ยังไม่ได้กำหนด';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('th-TH-u-ca-gregory',{timeZone:'Asia/Bangkok',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.day} ${parts.month} ${parts.year} · ${parts.hour}:${parts.minute} น.`;
}
function setDeadlineFields(value) {
  const date=new Date(value),valid=value&&Number.isFinite(date.getTime());
  const local=valid?new Date(date.getTime()+7*3600000).toISOString():'';
  $('#adminEndDateInput').value=local.slice(0,10);$('#adminEndHour').value=valid?local.slice(11,13):'19';$('#adminEndMinute').value=valid?local.slice(14,16):'00';
}
for(const [id,size] of [['adminEndHour',24],['adminEndMinute',60]]){
  $( '#'+id).replaceChildren(...Array.from({length:size},(_,i)=>{const option=document.createElement('option');option.value=String(i).padStart(2,'0');option.textContent=option.value;return option;}));
}
setDeadlineFields('');
function message(text) { toast.textContent=text; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),4000); }
async function api(path, body) {
  const response = await fetch(path,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  const result = await response.json();
  if (!response.ok || result.ok === false) throw Error(result.error || 'เชื่อมต่อไม่สำเร็จ');
  return result;
}
function showMode(mode) {
  if(mode==='admin'&&!user?.admin)return;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  document.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('active',p.dataset.panel===mode));
}
function renderActivityState() {
  const exists=Boolean(data?.config.exists);
  $('.landing').hidden=true;
  $('.intro').hidden=!exists;
  $('#emptyState').hidden=exists;
  $('.mode-switch').hidden=!exists;
  $('#vote').hidden=!exists;
  $('[data-panel="admin"]').hidden=!exists;
  $('#results').hidden=!exists;
  $('.footer-note').hidden=!exists;
  document.querySelectorAll('.nav a').forEach(a=>a.hidden=!exists);
  $('#createActivityBtn').hidden=!user?.admin;
  $('#emptyWaiting').hidden=Boolean(user?.admin);
  $('#emptyLoginHint').hidden=Boolean(user);
  $('#emptyDescription').textContent=user?.admin?(data?.config.candidateSource==='chat_members_only'?'เริ่มกิจกรรมทดสอบ กำหนดหัวข้อ วันสิ้นสุด และรางวัลตามอันดับ ผู้เข้าชิงใช้เฉพาะสมาชิกห้องแชททดสอบ':'เริ่มกิจกรรมแรกของทีม กำหนดหัวข้อ วันสิ้นสุด และรางวัลตามอันดับ ใช้รายชื่อผู้ใช้ Client และสมาชิก Chat โดยอัตโนมัติ'):'เมื่อผู้ดูแลเปิดกิจกรรม คุณจะสามารถเลือกผู้เข้าชิงและโหวตได้ที่นี่';
  $('#adminFormTitle').textContent=exists?'ตั้งค่ากิจกรรมโหวต':'สร้างกิจกรรมโหวต';
  $('#adminSaveSettings').textContent=exists?'บันทึกการตั้งค่า':'สร้างและเปิดโหวต';
  $('#shareVoteActions').hidden=!exists;
  $('#announceVoteBtn').hidden=!user?.admin;
  $('#announceVoteBtn').disabled=data?.config.status!=='open'||Date.parse(data?.config.endAt)<=Date.now();
  $('#announceVoteBtn').textContent='ประกาศโหวตเข้าห้องแชท';
  $('#announcementTarget').textContent=user?.admin?'ประกาศไปยัง '+(data?.config.spaceName||'ห้องที่เลือก'):'';
  $('#cancelCreate').hidden=exists;
  $('[data-panel="admin"] .section-title').hidden=!exists;
  $('[data-panel="admin"] .awards').hidden=!exists;
}
$('#createActivityBtn').onclick=()=>{if(!user?.admin)return;$('#emptyState').hidden=true;$('[data-panel="admin"]').hidden=false;showMode('admin');$('#adminTopicInput').focus();};
$('#cancelCreate').onclick=()=>{renderActivityState();showMode('client');};
$('#loginBtn').onclick=()=>location.assign('/auth/login');
$('#jiraLogin').onclick=()=>location.assign('/auth/login');
$('#cancel').onclick=()=>$('#modal').classList.remove('open');
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>showMode(b.dataset.mode));
$('[data-mode="admin"]').hidden=true;
$('#searchVoteBtn').disabled=true;
async function loadData(preserveForm=false) {
  const draft=preserveForm?[$('#adminTopicInput').value,$('#adminEndDateInput').value,$('#adminAwards').value,$('#adminEndHour').value,$('#adminEndMinute').value]:null;
  const wasCreating=preserveForm&&!data?.config.exists&&!$('[data-panel="admin"]').hidden;
  data = await api('/api/data');
  $('#loadingState').hidden=true;
  renderActivityState();
  $('.intro h1').textContent=data.config.topic || 'ยังไม่ได้กำหนดหัวข้อการโหวต';
  $('.intro .eyebrow').textContent=data.config.status==='open'?'เปิดโหวตอยู่':'ปิดโหวตแล้ว';
  $('.deadline strong').textContent=formatVotingDate(data.config.endAt);
  $('#adminTopicInput').value=data.config.topic || '';
  setDeadlineFields(data.config.endAt);
  const strict=data.config.candidateSource==='chat_members_only';
  $('#candidateSourceCount').textContent=`${strict?'สมาชิกห้องแชทเท่านั้น':'ผู้ใช้ Client และสมาชิก Chat'} · ${data.config.candidateCount||0} คน`;
  $('#candidateSourceCount').nextElementSibling.textContent=strict?'ผู้เข้าชิงตรงกับสมาชิกห้องที่ซิงก์ล่าสุด การล็อกอินนอกห้องไม่เพิ่มผู้เข้าชิง':'ใช้สมาชิกห้อง Chat ที่ซิงก์แล้วและผู้ใช้ Client จับคู่รายชื่อด้วยอีเมล ไม่ต้องกรอกผู้เข้าชิงเอง';
  $('#environmentBadge').hidden=data.config.environment!=='test';
  $('#chatSpaceCaption').textContent=data.config.spaceName+' · สำหรับผู้ดูแลเท่านั้น';
  $('#adminAwards').value=(data.config.awards||[]).join('\n');
  data.candidates.forEach(c=>c.label=c.name+(data.candidates.filter(other=>other.name===c.name).length>1?' · '+c.id.slice(-6):''));
  $('#candidateList').replaceChildren(...data.candidates.map(c=>{const option=document.createElement('option');option.value=c.label;return option;}));
  $('#candidateSearch').disabled=!data.candidates.length;
  $('#searchVoteBtn').disabled=data.config.status!=='open'||!data.candidates.length||(data.config.endAt&&Date.parse(data.config.endAt)<Date.now());
  const awards=$('[data-panel="admin"] .awards');awards.replaceChildren();
  data.results.filter(r=>r.award).forEach(r=>{const item=document.createElement('article');item.className='award';const rank=document.createElement('span');rank.className='rank';rank.textContent='อันดับ '+r.rank;const title=document.createElement('h3');title.textContent=r.award;item.append(rank,title);awards.append(item);});
  const results=$('#realResults'); results.replaceChildren();
  data.results.forEach(r=>{const p=document.createElement('p');p.textContent=`${r.rank}. ${r.name} — ${r.votes} คะแนน${r.award ? ' · '+r.award : ''}`;results.append(p);});
  if(draft){$('#adminTopicInput').value=draft[0];$('#adminEndDateInput').value=draft[1];$('#adminAwards').value=draft[2];$('#adminEndHour').value=draft[3];$('#adminEndMinute').value=draft[4];}
  if(wasCreating){$('#emptyState').hidden=true;$('[data-panel="admin"]').hidden=false;showMode('admin');}
}
async function loadChatStatus() {
  if(!user?.admin)return;
  $('#memberAdmin').hidden=false;
  const status=await api('/api/chat/status');
  $('#chatSpaceCaption').textContent=status.spaceName+' · สำหรับผู้ดูแลเท่านั้น';
  const latest=status.syncedAt?formatVotingDate(status.syncedAt):'ยังไม่เคยซิงก์';
  $('#chatSyncStatus').textContent=status.needsSync?'ยังไม่ซิงก์สมาชิกห้องที่เลือก':`${status.count} คน · ซิงก์ล่าสุด ${latest}`;
  $('#syncChatMembersBtn').disabled=!status.connected;
  $('#chatMembersSummary').textContent=`รายชื่อสมาชิก ${status.count} คน`;
  $('#chatMemberList').replaceChildren(...(status.members||[]).map(m=>{const li=document.createElement('li'),name=document.createElement('strong'),email=document.createElement('span');name.textContent=m.name;email.textContent=m.email;li.append(name,email);return li;}));
  if(!status.connected){$('#chatSyncError').hidden=false;$('#chatSyncError').textContent='ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google Chat';}
}
$('#syncChatMembersBtn').onclick=async()=>{
  if(!user?.admin)return;
  const button=$('#syncChatMembersBtn');button.disabled=true;button.textContent='กำลังซิงก์สมาชิก…';$('#chatSyncError').hidden=true;
  try {
    const result=await api('/api/chat/sync',{});
    await loadChatStatus();await loadData(true);
    message(`ซิงก์สมาชิก ${result.count} คนแล้ว · เพิ่ม ${result.added} คน`);
  }catch(e){$('#chatSyncError').textContent=e.message;$('#chatSyncError').hidden=false;}
  finally{button.disabled=false;button.textContent='ซิงก์สมาชิกจาก Chat';}
};
$('#candidateSearch').addEventListener('focus',async()=>{
  if(!data?.config.exists)return;
  try {
    const latest=await api('/api/data');
    data.candidates=latest.candidates;
    data.candidates.forEach(c=>c.label=c.name+(data.candidates.filter(other=>other.name===c.name).length>1?' · '+c.id.slice(-6):''));
    $('#candidateList').replaceChildren(...data.candidates.map(c=>{const option=document.createElement('option');option.value=c.label;return option;}));
  } catch(e){message(e.message);}
});
$('#searchVoteBtn').onclick=async()=>{
  if(!user){$('#modal').classList.add('open');return;}
  const matches=data.candidates.filter(c=>c.label===$('#candidateSearch').value.trim());
  if(matches.length!==1){message('กรุณาเลือกชื่อผู้เข้าชิงจากรายการ');return;}
  const button=$('#searchVoteBtn');button.disabled=true;
  try{await api('/api/sheet',{action:'vote',candidateId:matches[0].id});message('บันทึกโหวตลง Google Sheet แล้ว');button.textContent='โหวตเรียบร้อยแล้ว';await loadData();button.disabled=true;}catch(e){message(e.message==='Already voted'?'คุณโหวตไปแล้ว':e.message);button.disabled=false;}
};
$('#adminSaveSettings').onclick=async()=>{
  const button=$('#adminSaveSettings'),creating=!data?.config.exists;
  const topic=$('#adminTopicInput').value.trim(),date=$('#adminEndDateInput').value;
  const awards=$('#adminAwards').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!topic||!date||!awards.length){message('กรุณากรอกหัวข้อ วันสิ้นสุด และรางวัลให้ครบ');return;}
  const endAt=new Date(`${date}T${$('#adminEndHour').value}:${$('#adminEndMinute').value}:00+07:00`);
  if(!Number.isFinite(endAt.getTime())||endAt.getTime()<=Date.now()){message('กรุณากำหนดวันสิ้นสุดในอนาคต');return;}
  button.disabled=true;
  try{await api('/api/sheet',{action:'saveConfig',topic,endAt:endAt.toISOString(),awards,status:'open'});await loadData();showMode('client');message(creating?'สร้างกิจกรรมและเปิดโหวตแล้ว':'บันทึกการตั้งค่าแล้ว');}catch(e){message(e.message);}finally{button.disabled=false;}
};
$('#copyVoteLinkBtn').onclick=async()=>{
  const link=location.origin+'/#vote';
  try{await navigator.clipboard.writeText(link);message('คัดลอกลิงก์โหวตแล้ว');}
  catch{$('#voteShareLink').hidden=false;$('#voteShareLink').value=link;$('#voteShareLink').focus();$('#voteShareLink').select();message('เลือกข้อความลิงก์แล้ว กดคัดลอกได้เลย');}
};
$('#announceVoteBtn').onclick=async()=>{
  if(!user?.admin)return;
  const button=$('#announceVoteBtn');button.disabled=true;button.textContent='กำลังประกาศ…';
  $('#announcementError').hidden=true;
  try{const result=await api('/api/announcement',{});button.textContent='ประกาศแล้ว';message(result.alreadySent?'กิจกรรมนี้ประกาศแล้ว ไม่ส่งซ้ำ':'ประกาศโหวตเข้าห้องแชทแล้ว');}
  catch(e){$('#announcementError').hidden=false;$('#announcementError').textContent=e.message;button.disabled=false;button.textContent='ประกาศโหวตเข้าห้องแชท';}
};
(async()=>{
  localStorage.removeItem('voterId');localStorage.removeItem('jiraEmail');
  try{const result=await api('/api/session');user=result.user;if(user){$('#loginBtn').textContent=user.name+' · ออกจากระบบ';$('#loginBtn').onclick=()=>{const form=document.createElement('form');form.method='POST';form.action='/auth/logout';document.body.append(form);form.submit();};$('.landing').hidden=true;$('[data-mode="admin"]').hidden=!user.admin;$('#loginStatus').textContent='เข้าสู่ระบบแล้ว: '+user.name;}}
  catch(e){message(e.message);}
  try{await loadData();}catch(e){$('#loadingState').hidden=true;$('#emptyState').hidden=false;$('#emptyState h1').textContent='โหลดข้อมูลไม่สำเร็จ';$('#emptyDescription').textContent='กรุณารีเฟรชหน้าเว็บเพื่อลองอีกครั้ง';$('#emptyWaiting').hidden=true;message(e.message);}
  if(user?.admin)try{await loadChatStatus();}catch(e){$('#memberAdmin').hidden=false;$('#chatSyncError').hidden=false;$('#chatSyncError').textContent=e.message;}
  const chatResult=new URL(location.href).searchParams.get('chat');
  if(chatResult){
    const notices={connected:'เชื่อมต่อ Google และซิงก์รายชื่อแล้ว',denied:'ยกเลิกการอนุญาต Google รายชื่อเดิมยังอยู่',expired:'คำขอหมดอายุ กรุณากดเชื่อมต่อ Google ใหม่',unconfigured:'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google',failed:'เชื่อมต่อไม่สำเร็จ กรุณาเลือกบัญชี Google ที่เป็นสมาชิกห้อง และอนุญาตสิทธิ์อ่านสมาชิก'};
    if(chatResult==='connected')message(notices.connected);
    else if(user?.admin){$('#chatSyncError').hidden=false;$('#chatSyncError').textContent=notices[chatResult]||notices.failed;}
    const clean=new URL(location.href);clean.searchParams.delete('chat');history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
  }
})();
