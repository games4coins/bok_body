const fs=require('node:fs'),assert=require('node:assert/strict');
const text=fs.readFileSync('assets/app.js','utf8');
const start=text.indexOf('  const GRID_FACE_MS=6000;');
const end=text.indexOf('  /** Первое предложение',start);
assert(start>=0&&end>start,'public booking grid code not found');
const fragment=text.slice(start,end);
const make=(tag,attrs,...children)=>({tag,attrs:attrs||{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined)});
const S={st:{tickets:['f','p','t','b','f'],players:[{name:'Публичная участница',photo:'public-avatar',items:[[2,0],[3,1]]}]},
 sel:new Set(),gridHighlight:null,gridFacesUntil:0,gridFacesTimer:null};
const elements={grid:{},legend:{},mode:{},faces:{}};
let avatarCalls=0,opened=0,selected=0,playerRenders=0,scheduled=null;
const q={mode:'premium',isLite(){return this.mode==='lite'},set(v){this.mode=v}};
const funcs=new Function('S','gridQuality','h','fill','gridEl','legendEl','modeEl','facesEl',
  'myActive','toast','list','avatar','openCabinet','toggle','renderPlayers','setTimeout','clearTimeout',
  fragment+';return {renderGrid,gridFacesActive,stopGridFaces};')(
    S,q,make,(el,...children)=>{el.children=children.flat(Infinity).filter(Boolean)},
    elements.grid,elements.legend,elements.mode,elements.faces,
    ()=>[],()=>{},nums=>'№'+nums.join(', №'),
    (name,photo)=>{avatarCalls++;return make('avatar',{name,photo});},
    ()=>{opened++;},()=>{selected++;},()=>{playerRenders++;},
    cb=>{scheduled=cb;return 1},()=>{scheduled=null});
function nodes(children,fn,result=[]){for(const c of children||[]){
 if(!c||typeof c!=='object')continue;
 if(fn(c))result.push(c);
 nodes(c.children,fn,result);
 }return result;}
function buttons(el,selector){return nodes(el.children,x=>x.tag==='button'&&selector(x))}
funcs.renderGrid();
assert.equal(buttons(elements.legend,()=>true).length,5,'five statuses are interactive');
const wait=buttons(elements.legend,x=>x.attrs['aria-label']&&x.attrs['aria-label'].includes('Подсветить: Ожидает'))[0];
wait.attrs.onclick();assert.equal(S.gridHighlight,'p');
assert(buttons(elements.grid,x=>String(x.attrs.title).startsWith('№1 ·'))[0].attrs.class.includes('bok-admin-ticket-dimmed'));
wait && buttons(elements.legend,x=>x.attrs.class.includes('bok-admin-status-p'))[0].attrs.onclick();
assert.equal(S.gridHighlight,null);
const booked=()=>buttons(elements.grid,x=>String(x.attrs.title).startsWith('№2 ·'))[0];
booked().attrs.onclick();
assert(funcs.gridFacesActive());assert(scheduled);
assert.equal(avatarCalls,2,'only public occupied participants should load avatar images on reveal');
booked().attrs.onclick();assert.equal(opened,1,'second tap should open already-public participant profile');
scheduled();assert(!funcs.gridFacesActive());
const low=buttons(elements.mode,x=>String(x.attrs.class).includes('bok-grid-mode-option')&&
  x.children.includes('◈ Упрощённый'))[0];
low.attrs.onclick();assert(q.isLite());
const previous=avatarCalls;
booked().attrs.onclick();
assert.equal(avatarCalls,previous,'lite must not load grid images');
assert.equal(opened,2,'lite should open public participant without reveal animation');
assert.equal(playerRenders,1,'changing quality should also refresh public player list');
assert.equal(selected,0,'occupied tap must not book any number');
console.log('Public Boutique Grid: status filter, six-second reveal, public images only, lite skip, profile tap PASS');
