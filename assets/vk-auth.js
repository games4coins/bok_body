/* BOK Body VK ID 6.7.24: persistent device session with token rotation.
   Profile cache is NEVER authentication; GAS checks every private VK token. */
(function(global){
'use strict';
const APP_ID=54907336;
const REDIRECT='https://games4coins.github.io/bok_body/';
const PROFILE_KEY='bok_vkid_profile_54907336_v1';
const SESSION_KEY='bok_vkid_persistent_session_54907336_v2';
const OLD_SESSION_KEY='bok_vkid_session_token_54907336_v1';
let current=null,session=null,refreshFlight=null,sdkFlight=null;
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
function save(){try{if(current)localStorage.setItem(PROFILE_KEY,JSON.stringify(current));if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));}catch(_){}}
const cached=read(PROFILE_KEY);if(cached&&/^\d+$/.test(String(cached.id))&&cached.url){current=Object.assign({},cached,{restored:true});}
const stored=read(SESSION_KEY);
if(stored&&typeof stored.accessToken==='string'&&/^\d+$/.test(String(stored.userId||''))&&current&&String(stored.userId)===String(current.id))session=stored;
function sdk(){
 if(sdkFlight)return sdkFlight;
 sdkFlight=new Promise((resolve,reject)=>{
  if(global.VKIDSDK)return resolve(global.VKIDSDK);
  const script=document.createElement('script');
  script.src='https://unpkg.com/@vkid/sdk@2/dist-sdk/umd/index.js';
  script.onload=()=>global.VKIDSDK?resolve(global.VKIDSDK):reject(new Error('SDK недоступен'));
  script.onerror=()=>reject(new Error('Не удалось загрузить VK ID'));
  document.head.appendChild(script);
 }).catch(e=>{sdkFlight=null;throw e;});
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
  try{
   const VKID=await sdk();configure(VKID);
   const result=await VKID.Auth.refreshToken(session.refreshToken,session.deviceId);
   if(!result||!result.access_token)throw Error('Не удалось обновить сессию VK ID');
   storeSession(result,session.deviceId,current.id);
   return token();
  }catch(_){
   // Display-only profile may remain; protected operations need a NEW verified VK login.
   session=null;
   try{localStorage.removeItem(SESSION_KEY);}catch(_){}
   return '';
  }finally{refreshFlight=null;}
 })();
 return refreshFlight;
}
async function mount(container,onSuccess,onError){
 try{
  const VKID=await sdk();configure(VKID);
  const widget=new VKID.OneTap();
  widget.render({container,showAlternativeLogin:true,styles:{height:46}})
   .on(VKID.WidgetEvents.ERROR,onError)
   .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS,async payload=>{
    try{
     const result=await VKID.Auth.exchangeCode(payload.code,payload.device_id);
     if(!result||!result.access_token)throw Error('Не получен токен');
     const data=await VKID.Auth.userInfo(result.access_token);
     const u=data.user||data;
     if(!u||!u.user_id)throw Error('Не получен профиль VK');
     current={id:String(u.user_id),name:[u.first_name,u.last_name].filter(Boolean).join(' '),avatar:u.avatar||'',url:'https://vk.com/id'+u.user_id,restored:false};
     session=null;
     storeSession(result,payload.device_id,current.id);
     try{sessionStorage.removeItem(OLD_SESSION_KEY);}catch(_){}
     onSuccess(current);
    }catch(e){onError(e);}
   });
 }catch(e){onError(e);}
}
function logout(){
 // Explicit switch-user action revokes the VK ID SDK session when supported.
 // Local credentials are removed immediately even if VK is unreachable.
 try{
  if(global.VKIDSDK&&global.VKIDSDK.Auth&&typeof global.VKIDSDK.Auth.logout==='function')
   Promise.resolve(global.VKIDSDK.Auth.logout()).catch(()=>{});
 }catch(_){}
 current=null;session=null;refreshFlight=null;
 try{localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(OLD_SESSION_KEY);}catch(_){}
}
global.BokVK={mount,profile,token,ensureToken,logout,appId:APP_ID};
})(window);
