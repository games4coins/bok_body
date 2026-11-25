/* Regression test for the isolated Boutique Board view.
 * No browser, network, API mutation or actual booking is required. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const text=fs.readFileSync('assets/admin.js','utf8');
const start=text.indexOf('  const GRID_FACE_MS = 6000;');
const end=text.indexOf('  async function openDepositFromGrid()',start);
assert(start>0&&end>start,'boutique view code must be present');
const fragment=text.slice(start,end);
const make=(tag,attrs,...children)=>({tag,attrs:attrs||{},children:children.flat(Infinity).filter(Boolean)});
const state={
 tab:'grid',sel:new Set(),gridHighlight:null,gridFacesUntil:0,gridFacesTimer:null,
 st:{event:{number:233},bookings:[
 {code:'A',name:'Участник А',photo:'avatar-a',numbers:[2,3]},
 {code:'B',name:'Участник Б',photo:'',numbers:[4]}
 ],tickets:[
 {n:1,s:'f'}, {n:2,s:'p',code:'A'},{n:3,s:'a',code:'A'},
 {n:4,s:'t',code:'B'},{n:5,s:'b'}, {n:6,s:'f'}
 ]}
};
let renders=0,opened=0,blocked=0,manual=0,deposit=0,clock=null;
function findAll(node,fn,out=[]){if(Array.isArray(node)){node.forEach(x=>findAll(x,fn,out));return out;}
 if(!node||typeof node!=='object')return out;
 if(fn(node))out.push(node);
 (node.children||[]).forEach(x=>findAll(x,fn,out));return out;}
const API=new Function('A','h','avatar','list','renderTab','openTicket','blockSelected','openManual','openDepositFromGrid','setTimeout','clearTimeout',fragment+';return {gridView,gridFacesActive,stopGridFaces};')(
 state,make,(name,photo)=>make('avatar',{name,photo}),nums=>'№'+nums.join(', №'),
 ()=>{renders++;},()=>{opened++;},()=>{blocked++;},()=>{manual++;},()=>{deposit++;},
 cb=>{clock=cb;return 1;},()=>{clock=null;});
function tile(view,n){return findAll(view,x=>x.tag==='button'&&String(x.attrs.title||'').startsWith('№'+n+' ·'))[0];}
let view=API.gridView();
assert.equal(findAll(view,x=>x.tag==='button'&&x.attrs.class&&x.attrs.class.includes('bok-admin-status-')).length,5);
const legend=findAll(view,x=>x.tag==='button'&&x.attrs['aria-label']&&x.attrs['aria-label'].includes('Подсветить: Ожидает'))[0];
assert(legend);legend.attrs.onclick();view=API.gridView();assert.equal(state.gridHighlight,'p');
assert(tile(view,1).attrs.class.includes('bok-admin-ticket-dimmed'));
assert(tile(view,2).attrs.class.includes('bok-admin-ticket-spotlight'));
findAll(view,x=>x.tag==='button'&&x.attrs.class&&x.attrs.class.includes('bok-admin-status-p'))[0].attrs.onclick();
assert.equal(state.gridHighlight,null);
view=API.gridView();tile(view,2).attrs.onclick();
assert(API.gridFacesActive());assert.equal(opened,0);
view=API.gridView();assert(tile(view,2).attrs.class.includes('bok-admin-ticket-face'));
assert(tile(view,3).attrs.class.includes('bok-admin-ticket-face'));
assert(tile(view,4).attrs.class.includes('bok-admin-ticket-face'));
assert(!tile(view,5).attrs.class.includes('bok-admin-ticket-face'));
const photos=findAll(view,x=>x.tag==='avatar');
assert.equal(photos.length,3);
assert(photos.some(x=>x.attrs.photo==='avatar-a'));
tile(view,2).attrs.onclick();assert.equal(opened,1,'second tap must open booking');
assert(clock);clock();assert.equal(API.gridFacesActive(),false);
view=API.gridView();assert(!tile(view,2).attrs.class.includes('bok-admin-ticket-face'));
tile(view,1).attrs.onclick();view=API.gridView();assert.equal(state.sel.size,1);
const buttons=findAll(view,x=>x.tag==='button'&&x.attrs.class&&x.attrs.class.includes('bok-admin-'));
for(const suffix of ['reset','block','manual','deposit'])assert(buttons.some(b=>b.attrs.class.includes('bok-admin-'+suffix)),suffix+' button missing');
assert.equal(opened,1);
console.log('Boutique Board: 5 legend statuses, highlight, 6s avatars, second tap, selection and 4 actions PASS');
