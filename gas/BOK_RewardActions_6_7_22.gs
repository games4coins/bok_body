/**
 * BOK Body 6.7.22 - staged server module (NOT WIRED TO doPost).
 * This is a draft for review in a separate branch, not production code.
 * A win is the durable source of an action. No code evaluation / expressions.
 * Integrate only alongside compatible Code.gs, Achievements.gs, Players.gs.
 */
var BOK_REWARD_ACTIONS_SHEET='BOK Действия призов';
var BOK_REWARD_EFFECTS_SHEET='BOK Исполнения призов';
var BOK_EARLY_GRANTS_SHEET='BOK Права ранней брони';
var BOK_REWARD_ALLOWED={
  none:true,early_booking:true,unlock_achievement:true,reset_misses:true,
  add_spins:true,grant_gift:true
};
function bokRewardSheet_(name,heads){
  var ss=ss_(),sh=ss.getSheetByName(name)||ss.insertSheet(name);
  if(sh.getLastRow()<1){sh.getRange(1,1,1,heads.length).setValues([heads]);sh.setFrozenRows(1);}
  return sh;
}
function bokRewardConfigs_(){
  return achRows_(bokRewardSheet_(BOK_REWARD_ACTIONS_SHEET,['ID приза','Действие','Параметр','Активно','Включено с']));
}
function bokRewardDefinition_(prizeId,winDate){
  var configs=bokRewardConfigs_();
  for(var i=0;i<configs.length;i++)if(String(configs[i][0])===String(prizeId)){
    if(String(configs[i][3]).toUpperCase()!=='ДА')return null;
    var enabledAt=new Date(configs[i][4]).getTime(),wonAt=new Date(winDate).getTime();
    if(!Number.isFinite(enabledAt)||!Number.isFinite(wonAt)||wonAt<enabledAt)return null;
    return {action:String(configs[i][1]),parameter:String(configs[i][2]||'')};
  }
  return null;
}
function bokRewardLog_(){
  return bokRewardSheet_(BOK_REWARD_EFFECTS_SHEET,['ID выигрыша','Дата','Ключ','ID приза','Действие','Результат']);
}
function bokEarlyGrants_(){
  return bokRewardSheet_(BOK_EARLY_GRANTS_SHEET,['ID права','Дата','Ключ','ID выигрыша','Использовано','Код брони']);
}
function bokEarlyUnused_(key,bookings){
  var grants=achRows_(bokEarlyGrants_());
  return grants.filter(function(row){
    var id=String(row[0]);
    if(String(row[2])!==String(key)||String(row[4])==='ДА')return false;
    // Recovery from a crash between booking write and grant-use marker.
    return !(bookings||[]).some(function(b){return String(b.source||'')==='автобронь:'+id;});
  }).map(function(row){return {id:String(row[0]),winId:String(row[3])};});
}
/** Call only inside the existing booking lock after verifying VK ownership. */
function bokEarlyConsumeLocked_(id,bookingCode){
  var sh=bokEarlyGrants_(),rows=achRows_(sh);
  for(var i=0;i<rows.length;i++)if(String(rows[i][0])===String(id)){
    if(String(rows[i][4])==='ДА')return String(rows[i][5])===String(bookingCode);
    sh.getRange(i+2,5,1,2).setValues([['ДА',String(bookingCode)]]);
    return true;
  }
  return false;
}
function bokRewardAdminRules_(body){
  var id=String(body.prizeId||'').trim(),action=String(body.action||'none').trim();
  var parameter=String(body.parameter||'').trim();
  if(!id||!Object.prototype.hasOwnProperty.call(BOK_REWARD_ALLOWED,action))return err_('BAD_RULE','Неизвестное действие');
  if(action==='add_spins'&&(!/^\d+$/.test(parameter)||Number(parameter)<1||Number(parameter)>20))
    return err_('BAD_RULE','Количество вращений от 1 до 20');
  if(action==='grant_gift'&&!/^[a-zA-Z0-9_-]{1,80}$/.test(parameter))
    return err_('BAD_RULE','Требуется ID подарка из каталога');
  return withLock_(function(){
    var catalog=achCatalog_();
    if(!catalog.some(function(p){return String(p.id)===id;}))return err_('BAD_PRIZE','Приз не найден');
    var sh=bokRewardSheet_(BOK_REWARD_ACTIONS_SHEET,['ID приза','Действие','Параметр','Активно','Включено с']);
    var rows=achRows_(sh),idx=rows.findIndex(function(r){return String(r[0])===id;});
    var data=[id,action,parameter,'ДА',new Date()];
    if(idx<0)sh.appendRow(data);else sh.getRange(idx+2,1,1,5).setValues([data]);
    return {ok:true,prizeId:id,action:action,parameter:parameter};
  });
}
/** The effective action is linked to one immutable win ID. Idempotence comes
 * from deterministic IDs in the effect/grant/spin/award ledgers. NEVER execute
 * this function from a public endpoint that accepts key or prizeId from client.
 */
function bokApplyRewardForWin_(winId,key){
  return withLock_(function(){
    var wins=achRows_(achWins_()),win=wins.filter(function(r){
      return String(r[0])===String(winId)&&String(r[2])===String(key);
    });
    if(win.length!==1)return err_('WIN_NOT_FOUND','Выигрыш не найден или повреждён');
    var effects=bokRewardLog_(),previous=achRows_(effects).some(function(r){return String(r[0])===String(winId);});
    if(previous)return {ok:true,replayed:true};
    var prizeId=String(win[0][3]),rule=bokRewardDefinition_(prizeId,win[0][1]);
    if(!rule||rule.action==='none')return {ok:true,action:'none'};
    var effectId='reward:'+String(winId),result='';
    if(rule.action==='early_booking'){
      var grant=bokEarlyGrants_();
      if(!achRows_(grant).some(function(r){return String(r[0])===effectId}))
        grant.appendRow([effectId,new Date(),key,winId,'НЕТ','']);
      result='Право ранней брони';
    }else if(rule.action==='add_spins'){
      var n=Number(rule.parameter),spins=achSpins_();
      if(!achRows_(spins).some(function(r){return String(r[0])===effectId}))
        spins.appendRow([effectId,new Date(),key,n,'Автоприз: '+prizeId,'система']);
      result='Вращений: '+n;
    }else if(rule.action==='reset_misses'){
      var player=findPlayer_(key);
      if(!player)return err_('PLAYER_NOT_FOUND','Не удалось найти участника');
      var oldMiss=player.misses;
      if(oldMiss){
        player.misses=0;savePlayer_(player);
        appendLedger_([ledgerRow_(player,OP.MISSSET,0,'автоматически',
          'Сброс пропусков по призу '+winId,readSettings_().eventNumber)]);
        noteOp_();invalidate_();
      }
      result='Сброшено пропусков: '+oldMiss;
    }else if(rule.action==='unlock_achievement'){
      var current=achRows_(achAwards_()),earned={};
      current.forEach(function(r){if(String(r[2])===String(key))earned[String(r[3])]=true;});
      // Recover a crash after granting the badge but before the effect log:
      // the same win must NEVER unlock a second badge on retry.
      var prior=current.filter(function(r){return String(r[0]).indexOf(effectId+':')===0;})[0];
      var next=prior?ACH_DEFS.filter(function(d){return d[0]===String(prior[3]);})[0]:
        ACH_DEFS.filter(function(d){return d[6]>0&&!earned[d[0]];})[0];
      if(next){
        var awardId=effectId+':'+next[0];
        if(!current.some(function(r){return String(r[0])===awardId}))
          achAwards_().appendRow([awardId,new Date(),key,next[0],readSettings_().eventNumber,'приз барабана']);
        // The achievement's usual reward (+1 spin) is preserved, once.
        if(next[6]){
          var spins2=achSpins_();
          if(!achRows_(spins2).some(function(r){return String(r[0])===awardId}))
            spins2.appendRow([awardId,new Date(),key,1,'Ачивка '+next[0],'автоматически']);
        }
        result='Открыта ачивка '+next[0];
      }else result='Все ачивки уже открыты — требуется решение администратора';
    }else if(rule.action==='grant_gift'){
      var gift=giftCatalog_().filter(function(g){return g.id===rule.parameter&&g.active;})[0];
      if(!gift)return err_('BAD_GIFT','Подарок не найден');
      ensureGiftsSheet_();
      var gs=ss_().getSheetByName(SHEET_GIFTS),rows=allGifts_();
      if(!rows.some(function(g){return String(g.id)===effectId})){
        var who=findPlayer_(key);if(!who)return err_('PLAYER_NOT_FOUND','Участник не найден');
        gs.appendRow([effectId,key,who.name,gift.title,readSettings_().eventNumber,new Date(),'НЕТ','','']);
        invalidate_();
      }
      result='Подарок '+gift.title;
    }else return err_('BAD_RULE','Неподдерживаемое действие');
    effects.appendRow([winId,new Date(),key,prizeId,rule.action,result]);
    return {ok:true,action:rule.action,result:result};
  });
}

/** Private-only state. Auth identity MUST come from VK, not request body key. */
function bokEarlyState_(body){
  var auth=vkCabinetIdentity_(body);
  if(auth.error)return auth.error;
  if(!auth.player)return err_('NOT_LINKED','Профиль VK ID не привязан');
  var enabled=PropertiesService.getScriptProperties().getProperty('BOK_EARLY_BOOKING_ENABLED')==='true';
  var s=readSettings_();
  var grants=bokEarlyUnused_(auth.player.key,readBookings_());
  return {ok:true,eligible:!!(enabled&&s.paused&&grants.length),
    availableGrants:grants.length,paused:!!s.paused,enabled:enabled};
}
/** Only Code.js admin routing after checkAdmin_ may call this. */
function bokRewardAdminList_(){
  var enabled=PropertiesService.getScriptProperties().getProperty('BOK_EARLY_BOOKING_ENABLED')==='true';
  return {ok:true,earlyBookingEnabled:enabled,items:bokRewardConfigs_().map(function(r){
    return {prizeId:String(r[0]),action:String(r[1]),parameter:String(r[2]||''),
      active:String(r[3]).toUpperCase()==='ДА'};
  })};
}

/** Migration for historic, unissued early-booking wins. Admin endpoint ONLY.
 * Default: dryRun. Never count a status ВЫДАН as unspent, and never apply
 * historical actions other than the exact early_booking prize type.
 */
function bokAdminBackfillEarly_(body){
  var dry=body&&body.apply===true?false:true;
  if(!dry&&String(body.confirm||'')!=='ACTIVATE_EARLY_BACKFILL')
    return err_('CONFIRM','Требуется подтверждение переноса');
  return withLock_(function(){
    var wins=achRows_(achWins_()),grants=bokEarlyGrants_(),known={};
    achRows_(grants).forEach(function(r){known[String(r[0])]=true;});
    var plans=[],configById={};
    bokRewardConfigs_().forEach(function(c){if(String(c[1])==='early_booking'&&String(c[3]).toUpperCase()==='ДА')configById[String(c[0])]=true;});
    wins.forEach(function(w){
      var id=String(w[0]),key=String(w[2]);
      if(!id||!key||String(w[5])==='ВЫДАН')return;
      // An explicit prize configuration selects which historic prize to migrate.
      if(!configById[String(w[3])]||known['reward:'+id])return;
      plans.push({id:id,key:key,prizeId:String(w[3]),title:String(w[4])});
    });
    if(!dry&&plans.length>100)return err_('BACKFILL_LIMIT','Более 100 записей: переносите отдельными партиями');
    if(!dry)plans.forEach(function(p){
      grants.appendRow(['reward:'+p.id,new Date(),p.key,p.id,'НЕТ','']);
      bokRewardLog_().appendRow([p.id,new Date(),p.key,p.prizeId,
        'early_booking','Историческое право ранней брони']);
    });
    return {ok:true,dryRun:dry,count:plans.length,items:plans.slice(0,100)};
  });
}
function bokAdminEarlySettings_(body){
  if(typeof body.enabled!=='boolean')return err_('BAD_SETTING','Ожидается true или false');
  PropertiesService.getScriptProperties().setProperty('BOK_EARLY_BOOKING_ENABLED',body.enabled?'true':'false');
  return {ok:true,enabled:body.enabled};
}