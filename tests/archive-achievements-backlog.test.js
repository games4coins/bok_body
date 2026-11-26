const fs=require('node:fs'),assert=require('node:assert/strict');
const a=fs.readFileSync('assets/admin.js','utf8');
const start=a.indexOf('  function openArchive() {'),end=a.indexOf('  // ───── Игроки ─────',start);
assert(start>0&&end>start);
const code=a.slice(start,end);
for(const symbol of ["api.post('adminAchSync',{password:A.pw,dryRun:true})","api.post('adminAchSync',{password:A.pw,dryRun:false})",
  "if(r.error&&r.error.code==='ACH_BACKLOG')","achPreview=null;reset();","window.confirm('Начислить достижения из СТАРЫХ архивов?"]){
 assert(code.includes(symbol),'Missing guarded achievement reconciliation: '+symbol);
}
assert(code.indexOf("api.post('adminAchSync',{password:A.pw,dryRun:true})")<
       code.indexOf("api.post('adminAchSync',{password:A.pw,dryRun:false})"));
assert(code.includes("if(verified.newAwards!==old.newAwards||verified.newSpins!==old.newSpins||verified.repairedSpins!==old.repairedSpins)"));
assert(code.includes('achCheck, achInfo, achApply, previewEl, err, btn'));
assert(code.includes("api.post('adminArchive', body())"));
const back=fs.readFileSync('assets/admin.js','utf8');
assert(back.includes("function gridView()"),'grid not removed');
assert(fs.readFileSync('admin.html','utf8').includes('6.7.34'));
console.log('Archive backlog UI: dry preview, explicit confirmation, recheck, separate archive, release PASS');
