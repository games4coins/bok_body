/* BOK Body VK ID 6.7.32: persistent device session with token rotation.
   Profile cache is NEVER authentication; GAS checks every private VK token. */
(function(global){
'use strict';
const APP_ID=54907336;
const REDIRECT='https://games4coins.github.io/bok_body/';
const PROFILE_KEY='bok_vkid_profile_54907336_v1';
const SESSION_KEY='bok_vkid_persistent_session_54907336_v2';
const OLD_SESSION_KEY='bok_vkid_session_token_54907336_v1';
let current=null,session=null,refreshFlight=null,sdkFlight=null,authEpoch=0;
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
function save(){try{if(current)localStorage.setItem(PROFILE_KEY,JSON.stringify(current));if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));}catch(_){}}
const cached=read(PROFILE_KEY);if(cached&&/^\d+$/.test(String(cached.id))&&cached.url){current=Object.assign({},cached,{restored:true});}
const stored=read(SESSION_KEY);
if(stored&&typeof stored.accessToken==='string'&&/^\d+$/.test(String(stored.userId||''))&&current&&String(stored.userId)===String(current.id))session=stored;
const SDK_URLS=[
 'https://unpkg.com/@vkid/sdk@2.6.1/dist-sdk/umd/index.js',
 'https://cdn.jsdelivr.net/npm/@vkid/sdk@2.6.1/dist-sdk/umd/index.js'
];
function sdkReady(){const v=global.VKIDSDK;return v&&v.Config&&v.Auth&&v.OneTap?v:null;}
function loadSdk(url){
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');let settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);script.onload=script.onerror=null;
   if(error){script.remove();reject(error);}else resolve(sdkReady());};
  const timer=setTimeout(()=>finish(Error('Тайм-аут VK ID')),7000);
  script.async=true;script.src=url;
  script.onload=()=>finish(sdkReady()?null:Error('SDK недоступен'));
  script.onerror=()=>finish(Error('Ошибка загрузки SDK'));
  document.head.appendChild(script);
 });
}
function sdk(){
 if(sdkReady())return Promise.resolve(sdkReady());
 if(sdkFlight)return sdkFlight;
 sdkFlight=(async()=>{
  for(const url of SDK_URLS){try{return await loadSdk(url);}catch(_){}}
  throw Error('VK ID недоступен (VK-SDK-01). Проверьте подключение или откройте сайт в обычном браузере и повторите вход.');
 })().finally(()=>{sdkFlight=null;});
 return sdkFlight;
}
function configure(VKID){VKID.Config.init({app:APP_ID,redirectUrl:REDIRECT,responseMode:VKID.ConfigResponseMode.Callback,source:VKID.ConfigSource.LOWCODE,scope:''});}
function profile(){return current;}
function valid(){return !!(session&&session.accessToken&&(!session.expiresAt||session.expiresAt>Date.now()+30000));}
function token(){return current&&valid()?session.accessToken:'';}
function storeSession(result,deviceId,userId){
 session={accessToken:String(result.access_token),refreshToken:String(result.refresh_token||session&&session.refreshToken||''),
  deviceId:String(deviceId||session&&session.deviceId||''),userId:String(userId),
  expiresAt:result.expires_in?Date.now()+Number(result.expires_in)*1000:Date.now()+55*60000};
 save();
}
async function ensureToken(){
 if(!current||!session)return '';
 if(valid())return token();
 if(!session.refreshToken||!session.deviceId)return '';
 if(refreshFlight)return refreshFlight;
 refreshFlight=(async()=>{
  const epoch=authEpoch, previous=session;
  try{
   const VKID=await sdk();configure(VKID);
   if(epoch!==authEpoch)return '';
   const result=await VKID.Auth.refreshToken(previous.refreshToken,previous.deviceId);
   if(!result||!result.access_token)throw Error('Не удалось обновить сессию VK ID');
   if(epoch!==authEpoch||session!==previous)return '';
   storeSession(result,previous.deviceId,current.id);
   return token();
  }catch(_){
   // Display-only profile may remain; protected operations need a NEW verified VK login.
   // Preserve refresh credentials on transient network or CDN failure.
   if(epoch!==authEpoch)return '';
   return '';
  }finally{if(epoch===authEpoch)refreshFlight=null;}
 })();
 return refreshFlight;
}
async function mount(container,onSuccess,onError){
 const epoch=++authEpoch;refreshFlight=null;
 const active=()=>epoch===authEpoch&&container.isConnected;
 const fail=()=>{if(active())onError(Error('Не удалось завершить вход VK ID (VK-AUTH-02). Повторите вход или откройте сайт в обычном браузере.'));};
 try{
  const VKID=await sdk();configure(VKID);
  if(!active())return;
  container.replaceChildren();
  const widget=new VKID.OneTap();
  let exchanging=false;
  widget.render({container,showAlternativeLogin:true,styles:{height:46}})
   .on(VKID.WidgetEvents.ERROR,fail)
   .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS,async payload=>{
    if(!active()||exchanging)return;
    exchanging=true;
    try{
     const result=await VKID.Auth.exchangeCode(payload.code,payload.device_id);
     if(!result||!result.access_token)throw Error('Не получен токен');
     const data=await VKID.Auth.userInfo(result.access_token);
     const u=data.user||data;
     if(!active())return;
     if(!u||!/^\d+$/.test(String(u.user_id||'')))throw Error('Не получен числовой VK ID');
     current={id:String(u.user_id),name:[u.first_name,u.last_name].filter(Boolean).join(' '),avatar:u.avatar||'',url:'https://vk.com/id'+u.user_id,restored:false};
     session=null;
     storeSession(result,payload.device_id,current.id);
     try{sessionStorage.removeItem(OLD_SESSION_KEY);}catch(_){}
     onSuccess(current);
    }catch(e){exchanging=false;fail();}
   });
 }catch(e){if(active())onError(e);}
}
function logout(){
 authEpoch++;
 // Explicit switch-user action revokes the VK ID SDK session when supported.
 // Local credentials are removed immediately even if VK is unreachable.
 try{
  if(global.VKIDSDK&&global.VKIDSDK.Auth&&typeof global.VKIDSDK.Auth.logout==='function')
   if(session&&session.accessToken)Promise.resolve(global.VKIDSDK.Auth.logout(session.accessToken)).catch(()=>{});
 }catch(_){}
 current=null;session=null;refreshFlight=null;
 try{localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(OLD_SESSION_KEY);}catch(_){}
}
global.BokVK={mount,profile,token,ensureToken,logout,appId:APP_ID};
})(window);
