const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
  const source=fs.readFileSync('assets/vk-auth.js','utf8');
  const items=new Map();
  const localStorage={getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
  const sessionStorage={removeItem:()=>{},getItem:()=>null,setItem:()=>{}};
  localStorage.setItem('bok_vkid_profile_54907336_v1',JSON.stringify({id:'123',name:'Test',url:'https://vk.com/id123'}));
  localStorage.setItem('bok_vkid_persistent_session_54907336_v2',JSON.stringify({userId:'123',accessToken:'expired',refreshToken:'secret',deviceId:'device',expiresAt:Date.now()-50000}));
  let calls=0;
  const win={VKIDSDK:{Config:{init:()=>{}},ConfigResponseMode:{Callback:'callback'},ConfigSource:{LOWCODE:'lowcode'},Auth:{refreshToken:async(r,d)=>{
    calls++;assert.equal(r,'secret');assert.equal(d,'device');
    return {access_token:'renewed',refresh_token:'rotated',expires_in:600};
  }}}};
  new Function('window','localStorage','sessionStorage','document',source)(win,localStorage,sessionStorage,{});
  assert.equal(await win.BokVK.ensureToken(),'renewed');
  assert.equal(await win.BokVK.ensureToken(),'renewed');
  assert.equal(calls,1,'must not refresh a valid token twice');
  assert.equal(win.BokVK.profile().id,'123');
  win.BokVK.logout();
  assert.equal(win.BokVK.token(),'');
  assert.equal(localStorage.getItem('bok_vkid_persistent_session_54907336_v2'),null);
  console.log('VK ID refresh, persistence and explicit logout: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
