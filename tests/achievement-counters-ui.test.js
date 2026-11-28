const fs=require('node:fs'),assert=require('node:assert/strict');
const admin=fs.readFileSync('assets/admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
for(const marker of ["adminAchCounterState","adminAchCounterAdjust","counterLookup.get()",
 "expected:previous","requestId:id","counterState.history","counterType.addEventListener('change'"])
 assert(admin.includes(marker),'Missing '+marker);
assert(html.includes('6.7.39'),'Missing release version');
console.log('Achievement counter admin UI regression PASS');
