const $=s=>document.querySelector(s);
let data=null,user=null,selected=null,editing=null,filter='all',pending=0,toastTimer,closeTimer;
function formatVotingDate(value) {
  const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return 'ยังไม่ได้กำหนด';
  const p=Object.fromEntries(new Intl.DateTimeFormat('th-TH-u-ca-gregory',{timeZone:'Asia/Bangkok',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${p.day} ${p.month} ${p.year} · ${p.hour}:${p.minute} น.`;
}
function setDeadlineFields(value) {
  const date=new Date(value),valid=value&&Number.isFinite(date.getTime()),local=valid?new Date(date.getTime()+7*3600000).toISOString():'';
  $('#adminEndDateInput').value=local.slice(0,10);$('#adminEndHour').value=valid?local.slice(11,13):'19';$('#adminEndMinute').value=valid?local.slice(14,16):'00';
}
for(const [id,size] of [['adminEndHour',24],['adminEndMinute',60],['adminStartHour',24],['adminStartMinute',60],['reminderHour',24],['reminderMinute',60]]){
  $('#'+id).replaceChildren(...Array.from({length:size},(_,i)=>{const o=document.createElement('option');o.value=String(i).padStart(2,'0');o.textContent=o.value;return o;}));
}
setDeadlineFields('');
function rankLabel(result){return result.votes>0?String(result.rank):'ไม่มีอันดับ';}
function setStartFields(value){
  const local=value?new Date(new Date(value).getTime()+7*3600000).toISOString():'';
  $('#adminStartDateInput').value=local.slice(0,10);$('#adminStartHour').value=local.slice(11,13)||'09';$('#adminStartMinute').value=local.slice(14,16)||'00';
}
function activityStatusLabel(a){return a.status==='scheduled'?'รอเริ่มโหวต':a.status==='closed'?'ปิดโหวตแล้ว':'เปิดโหวต';}
function message(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function error(text){$('#pageError').textContent=text;$('#pageError').hidden=false;}
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
async function api(path,body){
  pending++;$('#globalLoading').hidden=false;$('#workspace').setAttribute('aria-busy','true');
  try{
    const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    const result=await r.json();if(!r.ok||result.ok===false)throw Error(result.error||'เชื่อมต่อไม่สำเร็จ');return result;
  }finally{pending--;$('#globalLoading').hidden=pending===0;$('#workspace').setAttribute('aria-busy',String(pending>0));}
}
async function busy(button,action){
  if(button.disabled)return;const text=button.textContent;button.disabled=true;button.textContent='กำลังดำเนินการ…';$('#pageError').hidden=true;
  try{await action();}catch(e){error(e.message);}finally{button.textContent=text;button.disabled=button.id==='submitVote'?!selected?.canVote:button.id==='announceVoteBtn'?selected?.status!=='open':false;if(button.id==='toggleReminderEngine')renderReminderEngine();}
}
function confirmAction(title,text){
  $('#confirmTitle').textContent=title;$('#confirmText').textContent=text;$('#confirmDialog').showModal();
  return new Promise(resolve=>{
    const done=value=>{$('#confirmDialog').close();resolve(value);};
    $('#confirmProceed').onclick=()=>done(true);$('#confirmCancel').onclick=()=>done(false);
    $('#confirmDialog').oncancel=e=>{e.preventDefault();done(false);};
  });
}
function activityLink(id){return location.origin+'/?activity='+encodeURIComponent(id)+'#vote';}
function showPage(page){
  if(['admin','members'].includes(page)&&!user?.admin)return;
  for(const id of ['activities','detail','history','admin','members'])$('#'+id+'Page').hidden=id!==page;
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  if(page!=='detail')clearTimeout(closeTimer);
}
function route(){
  const id=new URL(location.href).searchParams.get('activity'),hash=location.hash;
  if(id){selected=data.activities.find(a=>a.id===id)||null;if(selected){renderDetail();showPage('detail');return;}error('ไม่พบกิจกรรมจากลิงก์นี้');}
  if(hash==='#history'){renderHistory();showPage('history');}
  else if(hash==='#members'&&user?.admin){showPage('members');loadChatStatus().catch(e=>error(e.message));}
  else if(hash==='#admin'&&user?.admin){openForm();}
  else{renderCards();showPage('activities');}
}
function navigate(page,id){
  const target=new URL(location.href);if(id)target.searchParams.set('activity',id);else target.searchParams.delete('activity');
  target.hash=id?'vote':page;history.pushState({},'',target);route();
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderCards();});
window.addEventListener('popstate',()=>data&&route());
window.addEventListener('hashchange',()=>data&&route());
function adopt(result){
  data=result;user=result.user;
  $('#initialLoading').hidden=true;$('#environmentBadge').hidden=data.environment!=='test';
  $('#loginBtn').textContent=user?user.name+' · ออกจากระบบ':'เข้าสู่ระบบด้วย Jira';
  $('#roleCaption').textContent=user?({admin:'Admin',subadmin:'Subadmin',client:'Client'}[user.role]||''):'';
  $('#newActivityBtn').hidden=!user?.admin;
  document.querySelectorAll('[data-page="admin"],[data-page="members"]').forEach(b=>b.hidden=!user?.admin);
  renderCards();renderHistory();renderRoles();renderReminderEngine();
}
async function loadData(){
  const id=new URL(location.href).searchParams.get('activity')||'';
  const result=await api('/api/data?activity='+encodeURIComponent(id));adopt(result);
  if(id){selected=data.activities.find(a=>a.id===id);if(selected)renderDetail();}
}
function renderCards(){
  const list=$('#activityCards');list.replaceChildren();
  const activities=data.activities.filter(a=>filter==='all'||a.status===filter);
  if(!activities.length){const card=el('div',undefined,'panel empty');card.append(el('h2',data.activities.length?'ไม่มีรายการในหมวดนี้':'ยังไม่มีกิจกรรมโหวต'),el('p',user?.admin?'กดสร้างโหวตเพื่อเริ่มกิจกรรม':'เมื่อผู้ดูแลเปิดกิจกรรม คุณจะโหวตได้ที่นี่','muted'));list.append(card);return;}
  activities.forEach(a=>{
    const card=el('article',undefined,'panel activity-card');card.append(el('span',activityStatusLabel(a),'badge '+(a.status==='closed'?'closed':'')),el('h2',a.topic),el('p',(a.status==='scheduled'?'เริ่ม '+formatVotingDate(a.startAt)+' · ':'')+'สิ้นสุด '+formatVotingDate(a.endAt),'muted'),el('div',`${a.completed}/${a.total} คนโหวตแล้ว · ${a.candidates.length} ผู้เข้าชิง`,'meta'));
    if(a.myVote)card.append(el('p','คุณโหวตให้ '+a.myVote.name,'muted'));
    const button=el('button',a.status==='closed'?'ดูผลโหวต':a.status==='scheduled'?'ดูกิจกรรม':'ดูอันดับและโหวต');button.onclick=()=>navigate('detail',a.id);card.append(button);list.append(card);
  });
}
function renderDetail(){
  if(!selected)return;const a=selected,closed=a.status==='closed';
  renderReminders();
  $('#activityTitle').textContent=a.topic;$('#activityStatus').textContent=activityStatusLabel(a);$('#activityStatus').classList.toggle('closed',closed);
  $('#activityDeadline').textContent=formatVotingDate(a.endAt);$('#completedCount').textContent=a.completed;$('#eligibleCount').textContent=a.total;$('#candidateCount').textContent=a.candidates.length;
  $('#closedBanner').hidden=!closed;
  $('#closeReason').textContent=({all_voted:'ผู้มีสิทธิ์โหวตครบทุกคนแล้ว ระบบจึงปิดก่อนเวลา',deadline:'สิ้นสุดตามเวลาที่กำหนด',manual:'ผู้ดูแลปิดกิจกรรมแล้ว'}[a.closeReason]||'กิจกรรมนี้สิ้นสุดแล้ว')+(a.closedAt?' · '+formatVotingDate(a.closedAt):'');
  $('#announceVoteBtn').hidden=!user?.admin;$('#announceVoteBtn').disabled=a.status!=='open';
  $('#editActivityBtn').hidden=!user?.admin||closed;$('#closeActivityBtn').hidden=!user?.admin||closed;
  $('#announcementTarget').textContent=user?.admin?'ประกาศไปยัง '+data.spaceName:'';
  $('#rankingsTitle').textContent=closed?'อันดับสุดท้าย':'อันดับปัจจุบัน';
  $('#rankingUpdated').textContent='อัปเดต '+formatVotingDate(new Date().toISOString());
  $('#voteFields').hidden=!a.canVote;$('#voteLogin').hidden=Boolean(user)||closed;
  $('#votePanel').classList.toggle('locked',Boolean(a.myVote));
  const reasons={login:'เข้าสู่ระบบเพื่อดูสิทธิ์และโหวต',admin:'กิจกรรมนี้ไม่อนุญาตให้ Admin และ Subadmin โหวต',scheduled:'เริ่มโหวต '+formatVotingDate(a.startAt),closed:'กิจกรรมนี้ปิดโหวตแล้ว',ineligible:'บัญชีนี้ไม่อยู่ในรายชื่อผู้มีสิทธิ์ตอนสร้างกิจกรรม'};
  $('#voteHeading').textContent=a.myVote?'โหวตของคุณถูกบันทึกแล้ว':closed?'การโหวตสิ้นสุดแล้ว':a.status==='scheduled'?'ยังไม่ถึงเวลาเริ่มโหวต':'เลือกคนที่คุณต้องการโหวต';
  $('#voteMessage').textContent=a.myVote?'คุณโหวตให้ '+a.myVote.name+' · '+formatVotingDate(a.myVote.votedAt)+' · เปลี่ยนโหวตไม่ได้':closed?reasons.closed:a.status==='scheduled'?reasons.scheduled:reasons[a.voteBlockedReason]||'พิมพ์ชื่อเพื่อค้นหา · ห้ามโหวตตัวเอง · โหวตได้ครั้งเดียว';
  $('#candidateList').replaceChildren(...a.candidates.filter(c=>!c.isSelf).map(c=>{const option=el('option');option.value=c.name+' · '+c.id.slice(-6);return option;}));
  $('#candidateSearch').value='';$('#submitVote').disabled=!a.canVote;
  $('#rankingRows').replaceChildren(...a.results.map(r=>{const row=el('div',undefined,'rank-row');row.append(el('span',rankLabel(r),r.votes>0?'rank':'rank unranked'),el('span',r.name+(r.isSelf?' (คุณ)':''),'name'),el('span',String(r.votes),'score'),el('span',r.award?(r.tied?'อันดับร่วม · ':'')+r.award:r.votes?'ไม่มีรางวัลในอันดับนี้':'ยังไม่มีคะแนน','award'));return row;}));
  $('#awardList').replaceChildren(...a.awards.map(x=>el('li',x)));
  clearTimeout(closeTimer);
  if(!closed){const next=a.status==='scheduled'?a.startAt:a.endAt,delay=Math.max(1000,Math.min(Date.parse(next)-Date.now()+500,2147483000));closeTimer=setTimeout(()=>loadData().catch(e=>error(e.message)),delay);}
}
function renderHistory(){
  const list=$('#historyList');list.replaceChildren();
  if(!user){list.append(el('p','เข้าสู่ระบบด้วย Jira เพื่อดูประวัติโหวตของคุณ'));return;}
  if(!data.history.length){list.append(el('h2','ยังไม่มีประวัติโหวต'),el('p','เมื่อคุณโหวต รายการจะแสดงที่นี่','muted'));return;}
  data.history.forEach(h=>{const item=el('article',undefined,'history-item'),button=el('button','ดูผลกิจกรรม');button.onclick=()=>navigate('detail',h.activityId);item.append(el('h3',h.topic),el('p','โหวตให้ '+h.candidateName),el('p',formatVotingDate(h.votedAt),'muted'),button);list.append(item);});
}
function openForm(activity){
  editing=activity?.id||null;showPage('admin');
  $('#adminFormTitle').textContent=editing?'แก้ไขกิจกรรมโหวต':'สร้างกิจกรรมโหวต';
  $('#adminSaveSettings').textContent=editing?'บันทึกการตั้งค่า':'สร้างกิจกรรมโหวต';
  $('#adminTopicInput').value=activity?.topic||'';$('#adminAwards').value=(activity?.awards||[]).join('\n');
  setDeadlineFields(activity?.endAt||'');setStartFields(activity?.startAt||'');$('#allowAdminVote').checked=activity?.allowAdminVote===true;
  const hasVotes=Boolean(activity?.ballotCount);for(const id of ['adminStartDateInput','adminStartHour','adminStartMinute','startImmediately'])$('#'+id).disabled=hasVotes;
  $('#adminTopicInput').focus();
}
$('#startImmediately').onclick=()=>setStartFields('');
$('#newActivityBtn').onclick=()=>navigate('admin');
$('#cancelForm').onclick=()=>editing?navigate('detail',editing):navigate('activities');
$('#editActivityBtn').onclick=()=>openForm(selected);
$('#backActivities').onclick=()=>navigate('activities');
$('#refreshActivity').onclick=()=>busy($('#refreshActivity'),loadData);
function login(){location.assign('/auth/login'+(selected?'?activity='+encodeURIComponent(selected.id):''));}
$('#loginBtn').onclick=()=>{if(!user){login();return;}const f=document.createElement('form');f.method='POST';f.action='/auth/logout';document.body.append(f);f.submit();};
$('#voteLogin').onclick=login;
$('#activityForm').onsubmit=e=>{
  e.preventDefault();busy($('#adminSaveSettings'),async()=>{
    const endAt=new Date(`${$('#adminEndDateInput').value}T${$('#adminEndHour').value}:${$('#adminEndMinute').value}:00+07:00`);
    if(!Number.isFinite(endAt.getTime())||endAt.getTime()<=Date.now())throw Error('กำหนดวันสิ้นสุดในอนาคต');
    const startAt=$('#adminStartDateInput').value?new Date(`${$('#adminStartDateInput').value}T${$('#adminStartHour').value}:${$('#adminStartMinute').value}:00+07:00`):null;
    if(startAt&&(!Number.isFinite(startAt.getTime())||startAt>=endAt))throw Error('เวลาเริ่มต้องอยู่ก่อนเวลาสิ้นสุด');
    const r=await api('/api/app',{op:editing?'update':'create',activityId:editing,topic:$('#adminTopicInput').value.trim(),startAt:startAt?.toISOString()||'',allowAdminVote:$('#allowAdminVote').checked,endAt:endAt.toISOString(),awards:$('#adminAwards').value.split('\n').map(x=>x.trim()).filter(Boolean)});
    adopt({...r,environment:data.environment,spaceName:data.spaceName});navigate('detail',r.selectedId);message(editing?'บันทึกแล้ว':'สร้างโหวตแล้ว');
  });
};
$('#submitVote').onclick=()=>busy($('#submitVote'),async()=>{
  const a=selected;
  const candidate=a.candidates.filter(c=>!c.isSelf).find(c=>$('#candidateSearch').value.trim()===c.name+' · '+c.id.slice(-6));
  if(!candidate)throw Error('เลือกผู้เข้าชิงจากรายการ');
  if(!await confirmAction('ยืนยันโหวต',`โหวตให้ ${candidate.name} ในกิจกรรม “${a.topic}” ยืนยันแล้วเปลี่ยนไม่ได้`))return;
  const r=await api('/api/app',{op:'vote',activityId:a.id,candidateId:candidate.id});
  adopt({...r,environment:data.environment,spaceName:data.spaceName});selected=data.activities.find(x=>x.id===a.id);renderDetail();message('บันทึกโหวตแล้ว');
});
$('#closeActivityBtn').onclick=()=>busy($('#closeActivityBtn'),async()=>{
  if(!await confirmAction('ปิดกิจกรรมโหวต','เมื่อปิดแล้วจะไม่รับโหวตและไม่เปิดกลับ คะแนนและประวัติจะยังอยู่'))return;
  const r=await api('/api/app',{op:'close',activityId:selected.id});adopt({...r,environment:data.environment,spaceName:data.spaceName});selected=data.activities.find(x=>x.id===selected.id);renderDetail();message('ปิดโหวตแล้ว');
});
$('#copyVoteLinkBtn').onclick=async()=>{
  const link=activityLink(selected.id);
  try{await navigator.clipboard.writeText(link);message('คัดลอกลิงก์กิจกรรมแล้ว');}
  catch{$('#voteShareLink').value=link;$('#voteShareLink').hidden=false;$('#voteShareLink').focus();$('#voteShareLink').select();message('เลือกข้อความแล้ว กดคัดลอกได้เลย');}
};
$('#announceVoteBtn').onclick=()=>busy($('#announceVoteBtn'),async()=>{
  if(!await confirmAction('ประกาศโหวตเข้าห้องแชท',`ส่งหัวข้อและลิงก์กิจกรรม “${selected.topic}” ไปยัง ${data.spaceName} พร้อมแท็ก @all ทุกคนในห้อง`))return;
  $('#announcementError').hidden=true;
  try{const r=await api('/api/announcement',{activityId:selected.id});message(r.alreadySent?'กิจกรรมนี้ประกาศแล้ว ไม่ส่งซ้ำ':'ประกาศโหวตแล้ว');}
  catch(e){$('#announcementError').textContent=e.message;$('#announcementError').hidden=false;}
});
function renderReminderEngine(){
  $('#reminderEnginePanel').hidden=!user?.admin;
  const engine=data.reminderEngine;
  $('#toggleReminderEngine').disabled=!engine;
  $('#toggleReminderEngine').textContent=engine?.enabled?'พักระบบเตือน':'เปิดระบบเตือน';
  $('#reminderEngineStatus').textContent=!engine?'ระบบเตือนยังไม่พร้อม':engine.enabled?'เปิดใช้งาน · '+(engine.lastTickAt?'ตรวจล่าสุด '+formatVotingDate(engine.lastTickAt):'รอรอบตรวจตารางแรก'):'พักการส่งข้อความเตือน';
}
function renderReminders(){
  $('#activityReminders').hidden=!user?.admin;
  const enabled=data.reminderEngine?.enabled,open=selected?.status==='open';
  $('#reminderForm').hidden=!open||!enabled;
  $('#reminderHelp').textContent=!open?'กิจกรรมปิดแล้ว ระบบจะไม่ส่งเตือนอีก':!enabled?'เปิดระบบเตือนด้านบนก่อนตั้งเวลา':'เพิ่มได้หลายเวลา ก่อนวันสิ้นสุด · แท็กเฉพาะสมาชิกในห้องที่ยังไม่โหวต ไม่แท็ก @all';
  const labels={pending:'รอส่ง',partial:'ส่งแล้วบางส่วน',sending:'กำลังส่ง',sent:'ส่งแล้ว',cancelled:'ยกเลิกแล้ว',skipped:'ข้ามการส่ง',blocked:'ติดปัญหา',failed:'ส่งไม่สำเร็จ',unknown:'ยังยืนยันการส่งไม่ได้'};
  const rows=(selected?.reminders||[]).slice().sort((a,b)=>Date.parse(a.sendAt)-Date.parse(b.sendAt));
  $('#reminderList').replaceChildren(...rows.map(r=>{
    const row=el('article',undefined,'history-item');row.append(el('strong',formatVotingDate(r.sendAt)),el('p',labels[r.status]||r.status,'muted'));
    if(r.mentioned)row.append(el('p','แท็กแล้ว '+r.mentioned+' คน','muted'));
    if(r.error)row.append(el('p',r.error,'error'));
    if(['pending','partial'].includes(r.status)){const b=el('button','ยกเลิกเวลาเตือน');b.onclick=()=>busy(b,async()=>{
      await reminderChange({op:'reminderCancel',reminderId:r.id});message('ยกเลิกเวลาเตือนแล้ว');
    });row.append(b);}return row;
  }));
  if(!rows.length)$('#reminderList').append(el('p','ยังไม่มีเวลาเตือน','muted'));
}
async function reminderChange(body){
  const id=selected?.id,r=await api('/api/app',{...body,activityId:id});
  adopt({...r,environment:data.environment,spaceName:data.spaceName});
  if(id){selected=data.activities.find(a=>a.id===id);renderDetail();}
}
$('#toggleReminderEngine').onclick=()=>busy($('#toggleReminderEngine'),async()=>{
  const enabled=data.reminderEngine?.enabled;
  if(enabled&&!await confirmAction('พักระบบเตือน','รายการเวลาเตือนยังอยู่ แต่จะไม่ส่งข้อความจนกว่าจะเปิดระบบอีกครั้ง'))return;
  await reminderChange({op:enabled?'reminderDisable':'reminderEnable'});message(enabled?'พักระบบเตือนแล้ว':'เปิดระบบเตือนแล้ว');
});
$('#refreshReminders').onclick=()=>busy($('#refreshReminders'),loadData);
$('#reminderForm').onsubmit=e=>{
  e.preventDefault();busy($('#addReminder'),async()=>{
    const time=new Date(`${$('#reminderDate').value}T${$('#reminderHour').value}:${$('#reminderMinute').value}:00+07:00`);
    if(!Number.isFinite(time.getTime())||time.getTime()<=Date.now()||time.getTime()>=Date.parse(selected.endAt))throw Error('เวลาเตือนต้องอยู่ในอนาคตและก่อนปิดโหวต');
    if(!await confirmAction('ตั้งเวลาแจ้งเตือน',`ส่งเข้า ${data.spaceName} วันที่ ${formatVotingDate(time.toISOString())} และแท็กเฉพาะคนที่ยังไม่โหวต`))return;
    await reminderChange({op:'reminderAdd',sendAt:time.toISOString()});message('บันทึกเวลาเตือนแล้ว');
  });
};
function renderRoles(){
  $('#roleManagement').hidden=!user?.rootAdmin;
  $('#roleManagement .muted').textContent='Subadmin จัดการกิจกรรม สมาชิก และประกาศได้ แต่เปลี่ยนสิทธิ์ผู้ดูแลไม่ได้ โหวตได้เฉพาะกิจกรรมที่อนุญาตผู้ดูแล';
  $('#roleList').replaceChildren(...(data.roleMembers||[]).map(member=>{
    const row=el('div',undefined,'role-row'),info=el('div');info.append(el('strong',member.name),el('small',member.email+' · '+member.role));row.append(info);
    if(member.role!=='admin'){const b=el('button',member.role==='subadmin'?'ถอด Subadmin':'ตั้งเป็น Subadmin');b.onclick=()=>busy(b,async()=>{
      const next=member.role==='subadmin'?'client':'subadmin';
      if(!await confirmAction('เปลี่ยนสิทธิ์ผู้ดูแล',`${member.email} จะเป็น ${next} Subadmin จัดการกิจกรรม สมาชิก และประกาศได้ แต่เปลี่ยนสิทธิ์ผู้ดูแลไม่ได้ และโหวตได้เฉพาะกิจกรรมที่อนุญาตผู้ดูแล`))return;
      const r=await api('/api/app',{op:'setRole',email:member.email,role:next});adopt({...r,environment:data.environment,spaceName:data.spaceName});message('อัปเดตสิทธิ์แล้ว');
    });row.append(b);}return row;
  }));
}
async function loadChatStatus(){
  if(!user?.admin)return;const s=await api('/api/chat/status');
  $('#chatSpaceCaption').textContent=s.spaceName;$('#chatSyncStatus').textContent=s.needsSync?'ยังไม่ได้ซิงก์ห้องนี้':s.count+' คน · ซิงก์ล่าสุด '+formatVotingDate(s.syncedAt);
  $('#syncChatMembersBtn').disabled=!s.connected;$('#chatMembersSummary').textContent='รายชื่อสมาชิก '+s.count+' คน';
  $('#chatMemberList').replaceChildren(...s.members.map(m=>{const li=el('li',m.name);li.append(el('small',m.email));return li;}));
}
$('#syncChatMembersBtn').onclick=()=>busy($('#syncChatMembersBtn'),async()=>{await api('/api/chat/sync',{});await loadChatStatus();await loadData();message('ซิงก์รายชื่อสำหรับกิจกรรมใหม่แล้ว');});
(async()=>{
  try{await loadData();route();}catch(e){$('#initialLoading').hidden=true;error(e.message);const retry=el('button','ลองโหลดใหม่');retry.onclick=()=>location.reload();$('#pageError').append(retry);}
})();
