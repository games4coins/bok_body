const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const dir=fs.existsSync(path.join(__dirname,'../GAS/Code.js'))?path.join(__dirname,'../GAS'):path.join(__dirname);
const code=fs.readFileSync(path.join(dir,fs.existsSync(path.join(dir,'Code.js'))?'Code.js':'Code_6_7_22_STAGING.js'),'utf8');
let settings={paused:true,bookingOpen:false,ticketCount:20,maxPending:4,maxConfirmed:0,nameFormat:'full',confirmHours:4,eventNumber:250,utcOffset:3},enabled=true,bookings=[],grants=[{id:'reward:wheel:A'}],spent=[];
const player={key:'k1',name:'Alice',url:'https://vk.com/id123',photo:'',frozen:false};
const mock={
 PropertiesService:{getScriptProperties:()=>({getProperty:n=>n==='BOK_EARLY_BOOKING_ENABLED'&&enabled?'true':'false'})},
 cleanClient_:v=>v||null,rateLimit_:()=>true,readSettings_:()=>settings,cleanNumbers_:(arr,total)=>Array.isArray(arr)?arr.filter(x=>Number.isInteger(x)&&x>0&&x<=total):[],
 vkCabinetIdentity_:b=>({player:b.vkAccessToken==='valid'?player:{key:'k-other'}}),
 ensurePlayerSheets_:()=>{},findPlayer_:key=>key==='k1'?player:null,
 identify_:(b)=>({ok:true,key:b.vkUrl==='https://vk.com/id123'?'k1':'k-other',name:'Alice',url:b.vkUrl,display:'Alice',photo:''}),
 withLock_:fn=>fn(),prepareLocked_:()=>settings,fmtName_:n=>n,vkCanonicalPlayer_:who=>({player:who.key==='k1'?player:null}),
 refreshFreezeLocked_:()=>{},readBookings_:()=>bookings,busyMap_:()=>({}),bokEarlyUnused_:(key,old)=>key==='k1'&&grants.length&&!old.some(b=>b.source==='автобронь:'+grants[0].id)?grants:[],
 bokEnsureRecipientLocked_:()=>({player,created:false}),newCode_:()=>'B-'+(bookings.length+1),armTimer_:(b)=>{b.leftMin=240},
 appendBooking_:(b)=>{bookings.push(b)},bokEarlyConsumeLocked_:(id,code)=>{spent.push([id,code]);grants=[];return true},
 log_:()=>{},queueNotify_:()=>{},invalidate_:()=>{},publicBooking_:b=>b,quietInfo_:()=>null,payInfo_:()=>null,
 err_:(code,message)=>({ok:false,error:{code,message}}),Date,Math,Number,Object,String,Array,JSON
};
const stubs={...mock,fmtLocal_:()=> 'next',Date,Math,Number,Object,String,Array,JSON};
vm.createContext(mock);vm.runInContext(code,mock);
for(const [name,value] of Object.entries(stubs))mock[name]=value;
async function run(){
 const good=mock.actionBook_({clientId:'client',playerKey:'k1',vkAccessToken:'valid',numbers:[2]});
 if(!good.ok)console.error('FIRST RESULT',good);assert.equal(good.ok,true);assert.equal(good.booking.source,'автобронь:reward:wheel:A');assert.equal(spent.length,1);
 let deny=mock.actionBook_({clientId:'client2',playerKey:'k1',vkAccessToken:'valid',numbers:[3]});assert.equal(deny.error.code,'EARLY_NONE');
 grants=[{id:'reward:wheel:B'}];deny=mock.actionBook_({clientId:'client2',playerKey:'k1',vkAccessToken:'valid',numbers:[3,4]});assert.equal(deny.error.code,'EARLY_ONE');
 deny=mock.actionBook_({clientId:'client2',playerKey:'k1',numbers:[3]});assert.equal(deny.error.code,'CLOSED');
 deny=mock.actionBook_({clientId:'client2',playerKey:'k1',vkAccessToken:'other',numbers:[3]});assert.equal(deny.error.code,'EARLY_OWNER');
 enabled=false;deny=mock.actionBook_({clientId:'client2',playerKey:'k1',vkAccessToken:'valid',numbers:[3]});assert.equal(deny.error.code,'CLOSED');
 settings={...settings,paused:false,bookingOpen:true};const regular=mock.actionBook_({clientId:'client2',playerKey:'k1',numbers:[3]});assert.equal(regular.ok,true);assert.equal(regular.booking.source,'сайт (из списка)');
 console.log('PASS: early booking grants, one ticket limit, VK ownership, pause feature switch, normal booking');
}
run();