const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('assets/common.js','utf8');
const from=source.indexOf('  function bookingGridColumns(total) {');
const to=source.indexOf('  global.Nomerok =',from);
assert(from>0&&to>from,'shared grid helper missing');
const {bookingGridColumns,bookingGridStyle}=new Function(source.slice(from,to)+';return {bookingGridColumns,bookingGridStyle};')();
const cases=[
 [1,1,1],[4,2,2],[12,4,3],[21,5,5],[30,6,5],
 [60,7,9],[61,7,9],[62,7,9],[63,7,9],[64,8,8],
 [75,8,10],[80,8,10],[81,9,9],[100,10,10],[120,11,11]
];
for(const [n,cols,rows] of cases){
 assert.equal(bookingGridColumns(n),cols,'columns at '+n);
 assert.equal(Math.ceil(n/cols),rows,'rows at '+n);
 assert.equal(bookingGridStyle(n),'--bok-grid-cols:'+cols+';--bok-grid-max-width:'+(cols*42+(cols-1)*5)+'px');
}
assert.equal(bookingGridColumns(0),1);
assert.equal(bookingGridColumns('invalid'),1);
const css=fs.readFileSync('assets/styles.css','utf8');
assert(css.includes('BOK Body 6.7.33'));
assert(css.includes('max-width:var(--bok-grid-max-width,324px)'));
assert(css.includes('@media(max-height:800px) and (min-width:701px)'));
for(const name of ['bok-public-grid.bok-boutique-grid','bok-admin-grid.bok-boutique-grid'])
 assert(css.includes(name),'shared grid CSS '+name);
console.log('Responsive grid layouts (63 = 7×9), notebook sizing and mobile CSS: PASS');
