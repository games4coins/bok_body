const fs=require('node:fs'),assert=require('node:assert/strict');
const content=fs.readFileSync('assets/common.js','utf8');
const from=content.indexOf('  const BOK_GRID_MODE_KEY=');
const to=content.indexOf('  global.Nomerok =',from);
assert(from>0&&to>from,'shared mode code missing');
const code=content.slice(from,to);
const state=new Map();
const el={classList:{list:new Set(),toggle(name,on){if(on)this.list.add(name);else this.list.delete(name)}}};
const pref=(value,saved=false)=>{
 const store=(key,v)=>{if(v===undefined)return state.get(key)||null;state.set(key,v);};
 const navigator={connection:{saveData:saved}};
 const window={matchMedia:()=>({matches:value})};
 return new Function('store','document','navigator','window',code+';return gridQuality;')(
   store,{documentElement:el},navigator,window);
};
let q=pref(false,false);
assert.equal(q.get(),'premium');
q.set('lite');
assert.equal(q.get(),'lite');assert(el.classList.list.has('bok-grid-lite'));
let afterReload=pref(false,false);
assert.equal(afterReload.get(),'lite','saved lite persists across page loads');
afterReload.set('premium');assert(!el.classList.list.has('bok-grid-lite'));
assert.equal(pref(false,true).get(),'premium','explicit choice wins over save-data detection');
state.clear();
assert.equal(pref(true,false).get(),'lite','reduced motion should default to lite');
state.clear();
assert.equal(pref(false,true).get(),'lite','save-data should default to lite');
console.log('Shared grid quality: storage persistence, system defaults and CSS switch PASS');
