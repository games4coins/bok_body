const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const src=fs.readFileSync('assets/deposit-receipt.js','utf8');
const admin=fs.readFileSync('assets/admin.js','utf8');
const html=fs.readFileSync('admin.html','utf8');
const client={};
vm.runInNewContext(src,{window:client,Date,Number,String,Set,Array,Error});
const receipt=client.BokDepositReceipt;
assert(receipt&&typeof receipt.render==='function');
const data=receipt.validate({name:'Ирина',numbers:'9, 2; 9, 17',amount:750,balance:1250,event:'235',booking:'B-123'});
assert.deepEqual(Array.from(data.numbers),[2,9,17]);
assert.equal(data.amount,750);
assert.equal(data.balance,1250);
assert.equal(data.event,'235');
assert.throws(()=>receipt.validate({numbers:[1],amount:0,balance:100}));
assert.throws(()=>receipt.validate({numbers:[1],amount:250,balance:-1}));
assert.throws(()=>receipt.validate({numbers:[],amount:250,balance:0}));
assert(receipt.textForPost(data).includes('№2, №9, №17'));
assert(receipt.textForPost(data).includes('1 250 ₽')||receipt.textForPost(data).includes('1 250 ₽'));
assert.equal(receipt.filename({numbers:[1],amount:250,balance:0,booking:'B/123'}),'BOK-chek-B_123.png');
for(const marker of ['showDepositReceipt({key:b.key','showDepositReceipt({key:picker.value','showDepositReceipt({key:owner']){
  assert(admin.includes(marker),'Missing deposit receipt integration: '+marker);
}
assert(html.includes('assets/deposit-receipt.js?v=6.7.36-receipt-history'));
assert(html.indexOf('assets/deposit-receipt.js')<html.indexOf('assets/admin.js'));
assert(admin.includes('String(op.booking)===String(opts.booking)'));
assert(admin.includes("String(op.type)==='СПИСАНИЕ'"));
assert(admin.includes("receipt.render(data)"));
assert(admin.includes("canvas.toDataURL('image/png')"));
assert(admin.includes("r.state)setState(r.state)"));
console.log('Deposit PNG receipts: validation, ledger linkage, 3 flows, script order PASS');

(async()=>{
  const drawn=[];
  const ctx={
    beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){},stroke(){},
    fillRect(){},lineTo(){},save(){},restore(){},clip(){},
    measureText(s){return {width:String(s).length*13};},
    fillText(s){drawn.push(String(s));},
    createLinearGradient(){return {addColorStop(){}};}
  };
  const fakeCanvas={width:0,height:0,getContext(){return ctx;},toDataURL(){return 'data:image/png;base64,AA==';}};
  const simulated={};
  vm.runInNewContext(src,{window:simulated,document:{createElement:()=>fakeCanvas},
    Date,Number,String,Set,Array,Error});
  const nums=Array.from({length:63},(_,i)=>i+1);
  const rendered=await simulated.BokDepositReceipt.render({
    name:'Тестовый участник',numbers:nums,amount:15750,balance:2000,booking:'CHK63',event:235
  });
  assert.equal(rendered,fakeCanvas);
  assert(rendered.height>1160,'Long receipts must extend beyond the base height');
  const joined=drawn.join(' ');
  for(const n of nums)assert(joined.includes('№'+n),'Missing ticket '+n);
  assert(joined.includes('15750')||joined.includes('15 750')||joined.includes('15 750'));
  console.log('Deposit PNG canvas: all 63 numbers visible, dynamic height PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

const snapshots=[
 {id:'newer-refund',date:'2026-11-29T09:00:00Z',type:'ВОЗВРАТ',amount:250,event:'235',numbers:'1',booking:'B1'},
 {id:'newer-credit',date:'2026-11-28T09:00:00Z',type:'ПОПОЛНЕНИЕ',amount:500,event:'',numbers:'',booking:''},
 {id:'old-debit',date:'2026-11-20T10:00:00Z',type:'СПИСАНИЕ',amount:-250,event:'234',numbers:'1, 4',booking:'B1'},
 {id:'old-credit',date:'2026-11-10T10:00:00Z',type:'ПОПОЛНЕНИЕ',amount:1000,event:'',numbers:'',booking:''}
];
const historical=receipt.fromLedger({name:'Мария',balance:1500,history:snapshots},snapshots[2],{photo:'https://vk.com/example.jpg'});
assert.equal(historical.event,'234');
assert.equal(historical.booking,'B1');
assert.equal(historical.amount,250);
assert.equal(historical.balance,750,'Historical balance is after old debit, not current balance');
assert.equal(historical.refunded,true,'Later refund must mark old receipt cancelled');
assert.equal(historical.date.toISOString(),'2026-11-20T10:00:00.000Z');
assert.deepEqual(Array.from(historical.numbers),[1,4]);
const zeroCurrent=receipt.fromLedger({name:'Анна',balance:0,history:[
{id:'second',type:'СПИСАНИЕ',amount:-250,event:'234',numbers:'2',booking:'BB'},
{id:'first',type:'СПИСАНИЕ',amount:-500,event:'233',numbers:'3',booking:'AA'}
]}, {id:'first',type:'СПИСАНИЕ',amount:-500,event:'233',numbers:'3',booking:'AA'});
assert.equal(zeroCurrent.balance,250,'Zero-current-account can still reconstruct old balance');
assert.equal(zeroCurrent.refunded,false);
assert.throws(()=>receipt.fromLedger({name:'Х',balance:0,history:[]},
{id:'unknown',type:'СПИСАНИЕ',amount:-250,numbers:'1',booking:'B'}));
assert(admin.includes('🧾 Архив чеков депозитных броней'));
assert(admin.includes('operationId:op.id'));
assert(admin.includes('receipt.fromLedger(account,ledger'));
assert(admin.includes('navigator.canShare({files:[file]})'));
assert(admin.includes('🧾 Чек PNG'));
assert(!src.includes('BODY  /  МАСТЕРСКАЯ ВОК'));
assert(src.includes("text(ctx,'МАСТЕРСКАЯ ВОК'"));
console.log('Receipt history: old event, old balance, refund, zero balance, share and archive PASS');
