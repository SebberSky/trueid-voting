// Manual editor-only maintenance. Not exposed through doPost or the website.
// Copies affected sheets before clearing scoped test rows; backups stay in the
// same private spreadsheet and can be restored with normal Sheets operations.
function demoteChawaponToClient(){
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const email='chawapon.k@muze.co.th';
    if(ROOT_ADMINS.includes(email))throw Error('Remove hard-coded root role first');
    const ss=SpreadsheetApp.getActiveSpreadsheet();ensureSheet_(ss,'Roles',[['email','role','updatedAt','updatedBy']]);
    const sheet=ss.getSheetByName('Roles'),rows=appRows_('Roles'),row=[email,'client',new Date().toISOString(),'manual:user-request'];
    const indexes=rows.map((r,i)=>String(r[0]).toLowerCase()===email?i:-1).filter(i=>i>=0);
    if(!indexes.length)sheet.appendRow(row);else indexes.forEach(i=>sheet.getRange(i+2,1,1,4).setValues([row]));
    appRolesCache=null;SpreadsheetApp.flush();
    if(appRole_(email)!=='client'||appRole_('kittisak.bua@truedigital.com')!=='admin')throw Error('Role verification failed');
    console.log('Chawapon: client; Kittisak: admin. Other roles preserved.');
  }finally{lock.releaseLock();}
}
function archiveTestVotingData(){
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const props=PropertiesService.getScriptProperties(),ss=SpreadsheetApp.getActiveSpreadsheet();
    if(props.getProperty('TEST_DATA_ARCHIVED_20261007')){console.log('Already archived; no changes');return;}
    const targets=appRows_('Activities').filter(r=>['เทสโหวต','เทสใหม่อีกรอบ'].includes(String(r[1])));
    if(targets.some(r=>String(r[3])!=='closed'))throw Error('Test activity still open; no changes');
    const ids=new Set(targets.map(r=>String(r[0])));if(!ids.size){console.log('No scoped test activities');return;}
    const legacy=appRows_('Config').find(r=>r[0]==='activityId'),legacyTest=legacy&&ids.has(String(legacy[1]));
    const specs=[['Activities',0],['ActivityVotes',0],['VoteReminders',1],['VoteReminderIntervals',1],['VoteClosureNotifications',0],...(legacyTest?[['Config',null],['Votes',null],['Results',null]]:[])];
    const stamp=Utilities.formatDate(new Date(),'Asia/Bangkok','yyyyMMdd_HHmmss'),changes=[];
    for(const [name,index] of specs){
      const sheet=ss.getSheetByName(name);if(!sheet)continue;
      const values=sheet.getDataRange().getValues(),kept=[values[0],...values.slice(1).filter(r=>index!==null&&!ids.has(String(r[index])))];
      if(kept.length===values.length)continue;
      const backup=sheet.copyTo(ss).setName('Backup_'+stamp+'_'+name);
      changes.push({sheet,kept,backup:backup.getName(),removed:values.length-kept.length});
    }
    // All backups exist before the first original sheet is changed.
    for(const c of changes){c.sheet.clearContents();c.sheet.getRange(1,1,c.kept.length,c.kept[0].length).setValues(c.kept);}
    SpreadsheetApp.flush();
    const receipt={activities:targets.map(r=>({id:String(r[0]),topic:String(r[1])})),backups:changes.map(c=>({sheet:c.sheet.getName(),backup:c.backup,rows:c.removed})),at:new Date().toISOString()};
    props.setProperty('TEST_DATA_ARCHIVED_20261007',JSON.stringify(receipt));
    console.log(JSON.stringify(receipt));
  }finally{lock.releaseLock();}
}
