/* BOK Body 6.7.35 — premium PNG receipt for TEST deposit bookings.
 * Runs entirely in the admin browser. Never performs a payment or a server write.
 */
(function (global) {
  'use strict';
  const W=900, BASE_H=1160;
  const money = n => (Number(n)||0).toLocaleString('ru-RU')+' ₽';
  const cleanNums = values => [...new Set((Array.isArray(values)?values:String(values||'').split(/[,;\s]+/)).map(Number).filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b);
  const short = (value, max) => {
    const s=String(value==null?'':value).replace(/[\x00-\x1f]/g,' ').trim();
    return s.length>max?s.slice(0,max-1)+'…':s;
  };
  const validate = raw => {
    const d=raw||{}, nums=cleanNums(d.numbers), amount=Number(d.amount), balance=Number(d.balance);
    if(!nums.length||!Number.isFinite(amount)||amount<=0||!Number.isFinite(balance)||balance<0)
      throw new Error('Некорректные данные для чека депозитной брони');
    return {name:short(d.name||'Участник BOK',90),photo:String(d.photo||''),
      numbers:nums,amount,balance,event:short(d.event||'—',32),
      booking:short(d.booking||'—',48),date:d.date instanceof Date?d.date:new Date(d.date||Date.now()),
      refunded:!!d.refunded,
      operation:short(d.operation||'',100)};
  };
  function rounded(ctx,x,y,w,h,r) {
    const q=Math.min(r,w/2,h/2);
    ctx.beginPath();ctx.moveTo(x+q,y);ctx.arcTo(x+w,y,x+w,y+h,q);
    ctx.arcTo(x+w,y+h,x,y+h,q);ctx.arcTo(x,y+h,x,y,q);
    ctx.arcTo(x,y,x+w,y,q);ctx.closePath();
  }
  function fit(ctx,str,max,initial=48,min=24) {
    let size=initial;
    do {ctx.font='600 '+size+'px system-ui, sans-serif';if(ctx.measureText(str).width<=max)break;size-=2;} while(size>min);
    return size;
  }
  function text(ctx,value,x,y,size,color,weight='500',align='left') {
    ctx.font=weight+' '+size+'px system-ui, -apple-system, sans-serif';
    ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(value),x,y);
  }
  function wrap(ctx,value,width,fontSize) {
    ctx.font='600 '+fontSize+'px system-ui, sans-serif';
    const out=[], tokens=String(value).split(/\s+/);let line='';
    for(const token of tokens){
      const next=line?line+' '+token:token;
      if(line&&ctx.measureText(next).width>width){out.push(line);line=token;}else line=next;
    }
    if(line)out.push(line);
    return out;
  }
  function loadAvatar(url) {
    if(!/^https:\/\//i.test(url))return Promise.resolve(null);
    return new Promise(resolve=>{
      const img=new Image();let settled=false;
      const done=v=>{if(settled)return;settled=true;resolve(v);};
      img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';
      img.onload=()=>done(img);img.onerror=()=>done(null);
      img.src=url;
      // Image requests can hang; receipt stays usable with initials.
      setTimeout(()=>done(null),3500);
    });
  }
  async function render(raw) {
    const d=validate(raw);
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=BASE_H;
    let ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Canvas недоступен');
    // Expand the image for large bookings: no booked number may be dropped.
    const fontSize=d.numbers.length>20?23:d.numbers.length>10?28:33;
    const lineHeight=fontSize+14;
    const lines=wrap(ctx,d.numbers.map(n=>'№'+n).join(', '),730,fontSize);
    const H=BASE_H+Math.max(0,lines.length-2)*lineHeight;
    if(H!==BASE_H){canvas.height=H;ctx=canvas.getContext('2d');}
    const dark='#33291f', muted='#817565', gold='#b48a4b', paper='#fffcf6';
    ctx.fillStyle='#ece4d8';ctx.fillRect(0,0,W,H);
    rounded(ctx,25,25,850,H-50,32);ctx.fillStyle=paper;ctx.fill();
    ctx.lineWidth=2;ctx.strokeStyle='#d6bea0';ctx.stroke();
    rounded(ctx,43,43,814,118,24);ctx.fillStyle=dark;ctx.fill();
    text(ctx,'МАСТЕРСКАЯ ВОК',80,116,44,'#f2dbb4','800');
    text(ctx,'ПОДТВЕРЖДЕНИЕ БРОНИ',80,229,38,dark,'800');
    text(ctx,'ДОНАТ С ТЕСТОВОГО БАЛАНСА ВОК',80,273,23,muted,'700');
    rounded(ctx,80,301,250,46,23);ctx.fillStyle='#e8f0e9';ctx.fill();
    text(ctx,d.refunded?'↩  БРОНЬ ОТМЕНЕНА':'✓  БРОНЬ ПОДТВЕРЖДЕНА',205,331,18,d.refunded?'#875b3d':'#34724b','800','center');
    // Avatar must fail gracefully if the VK CDN does not grant canvas CORS.
    const avatar=await loadAvatar(d.photo);
    ctx.save();rounded(ctx,80,378,144,144,72);ctx.clip();
    const ag=ctx.createLinearGradient(80,378,224,522);
    ag.addColorStop(0,'#e4cda8');ag.addColorStop(1,'#b48a4b');
    ctx.fillStyle=ag;ctx.fillRect(80,378,144,144);
    if(avatar){try{
      const scale=Math.max(144/avatar.naturalWidth,144/avatar.naturalHeight);
      const rw=avatar.naturalWidth*scale,rh=avatar.naturalHeight*scale;
      ctx.drawImage(avatar,80+(144-rw)/2,378+(144-rh)/2,rw,rh);
    }catch(_){/* keep decorative fallback */}}
    else {
      const initials=d.name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('');
      text(ctx,initials||'ВОК',152,465,48,'#fffaf1','800','center');
    }
    ctx.restore();
    text(ctx,'УЧАСТНИК',252,405,22,muted,'700');
    const fs=fit(ctx,d.name,558,37,22);
    text(ctx,d.name,252,455,fs,dark,'700');
    text(ctx,'ЭФИР № '+d.event,252,502,23,gold,'800');
    ctx.strokeStyle='#e9dccc';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(80,562);ctx.lineTo(820,562);ctx.stroke();
    text(ctx,'ВАШИ НОМЕРКИ',80,615,23,muted,'700');
    lines.forEach((line,i)=>text(ctx,line,80,666+i*lineHeight,fontSize,dark,'700'));
    const top=Math.max(736,666+lines.length*lineHeight+2);
    rounded(ctx,70,top,760,182,22);ctx.fillStyle='#f5eee3';ctx.fill();
    text(ctx,'СПИСАНО С БАЛАНСА',99,top+53,21,muted,'700');
    text(ctx,'− '+money(d.amount),800,top+58,43,dark,'800','right');
    ctx.beginPath();ctx.moveTo(99,top+83);ctx.lineTo(800,top+83);ctx.strokeStyle='#dfd0bb';ctx.stroke();
    text(ctx,'ОСТАТОК НА БАЛАНСЕ',99,top+133,21,muted,'700');
    text(ctx,money(d.balance),800,top+141,38,'#35714f','800','right');
    const infoY=Math.max(980,top+222);
    text(ctx,'КОД БРОНИ: '+d.booking,80,infoY,19,muted,'600');
    const when=Number.isNaN(d.date.getTime())?new Date():d.date;
    const formatted=when.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    text(ctx,'СФОРМИРОВАНО: '+formatted,80,infoY+32,18,muted,'500');
    ctx.beginPath();ctx.moveTo(80,H-114);ctx.lineTo(820,H-114);ctx.strokeStyle='#d6bea0';ctx.stroke();
    text(ctx,'УДАЧИ НА ЭФИРЕ! 🍀',450,H-74,30,gold,'800','center');
    text(ctx,'Спасибо за поддержку мастерской ВОК',450,H-47,17,muted,'500','center');
    return canvas;
  }
  function filename(raw) {
    const d=validate(raw);
    return 'BOK-chek-'+d.booking.replace(/[^a-zA-Z0-9_-]/g,'_')+'.png';
  }
  function textForPost(raw) {
    const d=validate(raw);
    return (d.refunded?'↩ Историческая бронь отменена':'✅ Бронь подтверждена!')+'\n'+d.name+'\nЭфир №'+d.event+
      '\nНомерки: '+d.numbers.map(n=>'№'+n).join(', ')+
      '\nДонат с тестового баланса ВОК: '+money(d.amount)+
      '\nОстаток: '+money(d.balance)+'\n🍀 Удачи на эфире!';
  }
  /* The ledger history is reverse chronological, latest first. Reconstruct
   * balance immediately AFTER the original debit, not the current balance.
   * Reject operations that have no stable ledger ID.
   */
  function fromLedger(account, op, profile) {
    if(!account||!op||!op.id||String(op.type)!=='СПИСАНИЕ'||Number(op.amount)>=0||
       !String(op.booking||'').trim()||!String(op.numbers||'').trim())
      throw new Error('Операция не является подтверждённой депозитной бронью');
    const history=Array.isArray(account.history)?account.history:[];
    const index=history.findIndex(x=>String(x.id)===String(op.id));
    if(index<0)throw new Error('Операция не найдена в истории депозита');
    const newer=history.slice(0,index).reduce((sum,x)=>sum+Number(x.amount||0),0);
    const balance=Number(account.balance)-newer;
    if(!Number.isFinite(balance)||balance<0)throw new Error('Невозможно восстановить исторический остаток');
    const refunded=history.some(x=>String(x.type)==='ВОЗВРАТ'&&String(x.booking)===String(op.booking));
    return validate({
      name:(profile&&profile.name)||account.name,photo:(profile&&profile.photo)||'',
      numbers:op.numbers,amount:-Number(op.amount),balance,
      event:op.event,booking:op.booking,date:op.date,operation:op.id,refunded
    });
  }
  global.BokDepositReceipt=Object.freeze({render,validate,filename,textForPost,fromLedger});
})(window);
