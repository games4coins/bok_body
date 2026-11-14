const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');
function add(e,id,balance){return e.admin('adminPlayerAdd',{vkUrl:'vk.com/id'+id,name:'Игрок '+id,balance});}
function p(e,id){return e.admin('adminPlayers').players.find(x=>x.key===String(id));}
test('заморозка 1..90 дней, минимум 10, повтор запрещён',()=>{
 const e=createEnv(); add(e,501,9); assert.equal(e.admin('adminPlayerFreeze',{key:'501',frozen:true,days:30}).error.code,'FREEZE_MIN');
 add(e,502,15); for(const days of [0,91,'3.5','abc']) assert.equal(e.admin('adminPlayerFreeze',{key:'502',frozen:true,days}).error.code,'FREEZE_DAYS');
 assert.equal(e.admin('adminPlayerFreeze',{key:'502',frozen:true,days:90}).ok,true);
 assert.equal(p(e,502).frozen,true); assert.ok(p(e,502).freezeTo > Date.now());
 assert.equal(e.admin('adminPlayerFreeze',{key:'502',frozen:true,days:1}).error.code,'ALREADY_FROZEN');
});
test('бронь на замороженного получателя блокируется, в том числе по ссылке',()=>{
 const e=createEnv();add(e,503,12);e.admin('adminPlayerFreeze',{key:'503',frozen:true,days:14});
 const r=e.post({action:'book',clientId:'client-50312345',vkUrl:'vk.com/id503',name:'Игрок 503',numbers:[1]});
 assert.equal(r.error.code,'PLAYER_FROZEN');
});
test('досрочная разморозка требует подтверждения, списывает ровно 1 и журналируется',()=>{
 const e=createEnv();add(e,504,12);e.admin('adminPlayerFreeze',{key:'504',frozen:true,days:10});
 assert.equal(e.admin('adminPlayerFreeze',{key:'504',frozen:false}).error.code,'PENALTY_CONFIRM');
 assert.equal(p(e,504).balance,12);
 assert.equal(e.admin('adminPlayerFreeze',{key:'504',frozen:false,confirmPenalty:true}).ok,true);
 assert.equal(p(e,504).balance,11);assert.equal(p(e,504).frozen,false);
 assert.equal(e.admin('adminPlayerFreeze',{key:'504',frozen:false,confirmPenalty:true}).error.code,'NOT_FROZEN');
});
