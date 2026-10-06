const $ = s => document.querySelector(s);
const toast = $('#toast');
let user = null, data = null;
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
  $('#emptyDescription').textContent=user?.admin?'เริ่มกิจกรรมแรกของทีม กำหนดหัวข้อ วันสิ้นสุด และรางวัลตามอันดับ รายชื่อผู้เข้าชิงมาจากผู้ใช้ Client ทั้งหมดโดยอัตโนมัติ':'เมื่อผู้ดูแลเปิดกิจกรรม คุณจะสามารถเลือกผู้เข้าชิงและโหวตได้ที่นี่';
  $('#adminFormTitle').textContent=exists?'ตั้งค่ากิจกรรมโหวต':'สร้างกิจกรรมโหวต';
  $('#adminSaveSettings').textContent=exists?'บันทึกการตั้งค่า':'สร้างและเปิดโหวต';
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
async function loadData() {
  data = await api('/api/data');
  $('#loadingState').hidden=true;
  renderActivityState();
  $('.intro h1').textContent=data.config.topic || 'ยังไม่ได้กำหนดหัวข้อการโหวต';
  $('.intro .eyebrow').textContent=data.config.status==='open'?'เปิดโหวตอยู่':'ปิดโหวตแล้ว';
  $('.deadline strong').textContent=data.config.endAt ? new Date(data.config.endAt).toLocaleString('th-TH') : 'ยังไม่ได้กำหนด';
  $('#adminTopicInput').value=data.config.topic || '';
  $('#adminEndDateInput').value='';
  $('#candidateSourceCount').textContent=`ผู้ใช้ Client ทั้งหมด · ${data.config.candidateCount||0} คน`;
  $('#adminAwards').value=(data.config.awards||[]).join('\n');
  if(data.config.endAt){const d=new Date(data.config.endAt);$('#adminEndDateInput').value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  data.candidates.forEach(c=>c.label=c.name+(data.candidates.filter(other=>other.name===c.name).length>1?' · '+c.id.slice(-6):''));
  $('#candidateList').replaceChildren(...data.candidates.map(c=>{const option=document.createElement('option');option.value=c.label;return option;}));
  $('#candidateSearch').disabled=!data.candidates.length;
  $('#searchVoteBtn').disabled=data.config.status!=='open'||!data.candidates.length||(data.config.endAt&&Date.parse(data.config.endAt)<Date.now());
  const awards=$('[data-panel="admin"] .awards');awards.replaceChildren();
  data.results.filter(r=>r.award).forEach(r=>{const item=document.createElement('article');item.className='award';const rank=document.createElement('span');rank.className='rank';rank.textContent='อันดับ '+r.rank;const title=document.createElement('h3');title.textContent=r.award;item.append(rank,title);awards.append(item);});
  const results=$('#realResults'); results.replaceChildren();
  data.results.forEach(r=>{const p=document.createElement('p');p.textContent=`${r.rank}. ${r.name} — ${r.votes} คะแนน${r.award ? ' · '+r.award : ''}`;results.append(p);});
}
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
  if(new Date(date).getTime()<=Date.now()){message('กรุณากำหนดวันสิ้นสุดในอนาคต');return;}
  button.disabled=true;
  try{await api('/api/sheet',{action:'saveConfig',topic,endAt:new Date(date).toISOString(),awards,status:'open'});await loadData();showMode('client');message(creating?'สร้างกิจกรรมและเปิดโหวตแล้ว':'บันทึกการตั้งค่าแล้ว');}catch(e){message(e.message);}finally{button.disabled=false;}
};
(async()=>{
  localStorage.removeItem('voterId');localStorage.removeItem('jiraEmail');
  try{const result=await api('/api/session');user=result.user;if(user){$('#loginBtn').textContent=user.name+' · ออกจากระบบ';$('#loginBtn').onclick=()=>{const form=document.createElement('form');form.method='POST';form.action='/auth/logout';document.body.append(form);form.submit();};$('.landing').hidden=true;$('[data-mode="admin"]').hidden=!user.admin;$('#loginStatus').textContent='เข้าสู่ระบบแล้ว: '+user.name;}}
  catch(e){message(e.message);}
  try{await loadData();}catch(e){$('#loadingState').hidden=true;$('#emptyState').hidden=false;$('#emptyState h1').textContent='โหลดข้อมูลไม่สำเร็จ';$('#emptyDescription').textContent='กรุณารีเฟรชหน้าเว็บเพื่อลองอีกครั้ง';$('#emptyWaiting').hidden=true;message(e.message);}
})();
