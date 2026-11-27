'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const common=fs.readFileSync('assets/common.js','utf8');
const app=fs.readFileSync('assets/app.js','utf8');
const vk=fs.readFileSync('assets/vk-auth.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const admin=fs.readFileSync('admin.html','utf8');

// GET should terminate rather than indefinitely showing a blank/loading screen.
assert(common.includes("method==='GET'?18000:35000"),'GET/POST deadlines missing');
assert(common.includes('AbortController'),'AbortController timeout missing');
assert(common.includes("clearTimeout(deadline)"),'Request timers leak');
assert(common.includes("Операция могла выполниться"),'Ambiguous mutation warning missing');
assert(common.includes('Object.assign({},safePayload,{action})'),'Server action routing must remain safe');

// VK remains optional for public browsing and session refresh must have an exit.
assert(app.includes("h('h3',null,'🔐 Проверяем сессию VK ID')"),'Recovering login screen missing');
assert(app.includes('openCabinet(target,true)'),'Public cabinet fallback missing');
assert(app.includes("setTimeout(()=>resolve(''),9000)"),'VK session wait not bounded');
assert(vk.includes('function bounded('),'VK SDK call timeout missing');
for(const method of ['Auth.refreshToken','Auth.exchangeCode','Auth.userInfo'])
 assert(vk.includes('bounded(VKID.'+method),'Missing bounded VK SDK operation '+method);
assert(vk.includes("const epoch=++authEpoch"),'VK callback concurrency guard missing');
assert(vk.includes("String(u.user_id"),'Numerical user ID required for owner identity');
assert(vk.includes("url:'https://vk.com/id'+u.user_id"),'Canonical identity must use VK ID, not nickname');

// Defer preserves order while allowing the browser to parse the document promptly.
for(const page of [html,admin]){
 assert(page.includes('6.7.37'),'Release fingerprint missing');
 assert(!/<script src=/.test(page),'Blocking scripts remain');
 assert(/<script defer src="config.js"/.test(page),'Config must load in order');
}
assert(html.indexOf('assets/common.js')<html.indexOf('assets/vk-auth.js'));
assert(html.indexOf('assets/vk-auth.js')<html.indexOf('assets/app.js'));
console.log('Loading resilience, VK recovery, safe routing and deferred scripts PASS');
