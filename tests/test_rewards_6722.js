const fs=require('fs'),vm=require('vm'),assert=require('assert');
const rows={};
class Sheet{
 constructor(name){this.name=name;this.data=[];}
 getLastRow(){return this.data.length}
 getRange(r,c,h=1,w=1){const sh=this;return {
 setValues(values){for(let i=0;i<values.length;i++){if(!sh.data[r-1+i])sh.data[r-1+i]=[];for(let j=0;j<values[i].length;j++)sh.data[r-1+i][c-1+j]=values[i][j]}return this},
 getValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>(sh.data[r-1+i]||[])[c-1+j]??''));}
 }}
 setFrozenRows(){}
 appendRow(row){this.data.push(row.slice());return this}
}
const ss={getSheetByName(n){return rows[n]||null},insertSheet(n){return rows[n]=new Sheet(n)}};
const sh=n=>ss.getSheetByName(n)||ss.insertSheet(n);
let player={key:'vk-test',name:'Test',misses:2};let resetOps=0;
const c={ss_:()=>ss,achRows_:s=>s.data.slice(1),achWins_:()=>sh('BOK Выигрыши'),achSpins_:()=>{const x=sh('BOK Вращения');if(!x.getLastRow())x.appendRow(['ID','Date','Key','Amount','Reason','Who']);return x},achAwards_:()=>{const x=sh('BOK Ачивки');if(!x.getLastRow())x.appendRow(['ID','Date','Key','Badge','Event','From']);return x},withLock_:fn=>fn(),findPlayer_:key=>key==='vk-test'?player:null,savePlayer_:p=>{player=p},invalidate_:()=>{},readSettings_:()=>({eventNumber:234}),err_:(code,message)=>({ok:false,error:{code,message}}),PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty:()=>{}})},ACH_DEFS:[['visits10','🎀','V','',10,'visits',1],['tickets5','🎟','T','',5,'tickets',1]],appendLedger_:()=>{resetOps++},ledgerRow_:()=>[],OP:{MISSSET:'MISSSET'},noteOp_:()=>{},giftCatalog_:()=>[],allGifts_:()=>[],ensureGiftsSheet_:()=>{},SHEET_GIFTS:'Подарки',Date,Number,Object,String,Logger:{log:()=>{}}};
vm.createContext(c);
vm.runInContext(fs.readFileSync(__dirname+'/BOK_RewardActions_6_7_22.gs','utf8'),c);
const when=new Date('2026-11-24T20:00:00Z'),earlier=new Date('2026-11-23T20:00:00Z');
function addWin(id,prize){if(!sh('BOK Выигрыши').getLastRow())sh('BOK Выигрыши').appendRow(['ID','Дата','Ключ','Приз','Название','Статус','Дата выдачи']);sh('BOK Выигрыши').appendRow([id,when,'vk-test',prize,'Prize','ОЖИДАЕТ',''])}
function action(prize,kind,p=''){sh('BOK Действия призов').data[0]=['ID','Action','Parameter','Active','Since'];sh('BOK Действия призов').appendRow([prize,kind,p,'ДА',earlier]);}
action('auto','early_booking');addWin('wheel:w1','auto');
assert.equal(c.bokApplyRewardForWin_('wheel:w1','vk-test').ok,true);
assert.equal(c.bokApplyRewardForWin_('wheel:w1','vk-test').replayed,true);
assert.equal(c.bokEarlyUnused_('vk-test',[]).length,1);
assert.equal(c.bokEarlyUnused_('vk-test',[{source:'автобронь:reward:wheel:w1'}]).length,0);
assert.equal(c.bokEarlyConsumeLocked_('reward:wheel:w1','B-123'),true);
assert.equal(c.bokEarlyUnused_('vk-test',[]).length,0);
action('badge','unlock_achievement');addWin('wheel:w2','badge');
assert.equal(c.bokApplyRewardForWin_('wheel:w2','vk-test').ok,true);
assert.equal(sh('BOK Ачивки').data.length,2); // one header + 1 award
assert.equal(sh('BOK Вращения').data.length,2);
// Simulate missing final effect journal, but durable badge and spin exist.
const effects=sh('BOK Исполнения призов');effects.data=effects.data.filter(r=>r[0]!=='wheel:w2');
assert.equal(c.bokApplyRewardForWin_('wheel:w2','vk-test').ok,true);
assert.equal(sh('BOK Ачивки').data.length,2,'must not unlock next badge on replay');
assert.equal(sh('BOK Вращения').data.length,2,'must not add another spin');
action('reset','reset_misses');addWin('wheel:w3','reset');
assert.equal(c.bokApplyRewardForWin_('wheel:w3','vk-test').ok,true);
assert.equal(player.misses,0);assert.equal(resetOps,1);
action('spin','add_spins','3');addWin('wheel:w4','spin');
assert.equal(c.bokApplyRewardForWin_('wheel:w4','vk-test').ok,true);
assert.equal(c.bokApplyRewardForWin_('wheel:w4','vk-test').replayed,true);
assert.equal(sh('BOK Вращения').data.filter(r=>r[0]==='reward:wheel:w4').length,1);
console.log('PASS: grant, consume, recovery by booking source, reward replay, badge award, reset misses, spin credits');