/**
 * BOK Body 6.7.21 — bonus wheel spin for every 3 results named "Ничего".
 * Safe addon for existing Achievements.gs. No migrations or test spins.
 * Required Code.gs routes:
 * if (action === 'achPrivate') return json_(bokPrivateWithNothingBonus_(body));
 * if (action === 'achSpin') return json_(bokSpinWithNothingBonus_(body));
 */
function bokNothingPrizeRow_(row) {
  var name=String(row[4]||'').trim().toLowerCase().replace(/\s+/g,' ');
  return name==='ничего' || name==='ничего!' || name==='ничего.';
}
function bokNothingBonusLocked_(key, spinWinId) {
  var winSheet=achWins_(), all=achRows_(winSheet), relevant=[];
  for(var i=0;i<all.length;i++){
    if(String(all[i][2])===String(key) && bokNothingPrizeRow_(all[i])){
      relevant.push({row:i+2,data:all[i]});
    }
  }
  var groups=Math.floor(relevant.length/3);
  var spinSheet=achSpins_(), ledger=achRows_(spinSheet), known={};
  var balance=0;
  ledger.forEach(function(r){
    known[String(r[0])]=true;
    if(String(r[2])===String(key))balance+=Number(r[3])||0;
  });
  var credited=0,issued=0,milestone=false;
  for(var g=0;g<groups;g++){
    var bonusId='nothing-bonus:'+String(key)+':'+String(g+1);
    if(!known[bonusId]){
      spinSheet.appendRow([bonusId,new Date(),key,1,
        'Бонус за три приза «Ничего» (группа '+(g+1)+')','автоматически']);
      known[bonusId]=true;
      credited++;
      balance++;
    }
    for(var j=g*3;j<g*3+3;j++){
      var hit=relevant[j];
      if(String(hit.data[0])===String(spinWinId))milestone=(j%3===2);
      if(String(hit.data[5])!=='ВЫДАН'){
        winSheet.getRange(hit.row,6,1,2).setValues([['ВЫДАН',new Date()]]);
        issued++;
      }
    }
  }
  return {total:relevant.length,progress:relevant.length%3,groups:groups,
    applied:credited,issued:issued,balance:balance,milestone:milestone};
}
/** Authorized, read-only view of the participant's current "Ничего" progress. */
function bokPrivateWithNothingBonus_(body){
  var data=achPrivate_(body);
  if(!data||!data.ok)return data;
  var auth=vkCabinetIdentity_(body);
  if(auth.error)return auth.error;
  if(!auth.player)return err_('NOT_LINKED','VK ID не привязан');
  var nothing=achRows_(achWins_()).filter(function(r){
    return String(r[2])===String(auth.player.key)&&bokNothingPrizeRow_(r);
  }).length;
  data.nothingProgress=nothing%3;
  data.nothingTotal=nothing;
  return data;
}
/** Original achSpin_ remains authoritative: RNG, stock, debit and replay. */
function bokSpinWithNothingBonus_(body){
  var result=achSpin_(body);
  if(!result||!result.ok)return result;
  var auth=vkCabinetIdentity_(body);
  if(auth.error)return auth.error;
  if(!auth.player)return err_('NOT_LINKED','VK ID не привязан');
  var bonus;
  try{
    bonus=withLock_(function(){
      return bokNothingBonusLocked_(auth.player.key,String(result.id||''));
    });
  }catch(e){
    Logger.log('BOK nothing bonus recovery: '+String(e));
    return err_('BONUS_RECOVERY',
      'Вращение записано. Повторите попытку с тем же requestId: приз не потеряется.');
  }
  result.spins=bonus.balance;
  result.bonusSpinsApplied=bonus.applied;
  result.nothingProgress=bonus.progress;
  result.nothingTotal=bonus.total;
  result.nothingMilestone=bonus.milestone;
  result.nothingIssued=bonus.issued;
  return result;
}
/** Read-only diagnostic. Does not award anything or change prize statuses. */
function bokWheelNothingBonusReadOnlyCheck(){
  var wins=achRows_(achWins_()),ledger=achRows_(achSpins_()),counts={},credited={};
  wins.forEach(function(r){if(bokNothingPrizeRow_(r)){
    var key=String(r[2]);counts[key]=(counts[key]||0)+1;
  }});
  ledger.forEach(function(r){
    var id=String(r[0]),match=id.match(/^nothing-bonus:(.+):(\d+)$/);
    if(match)credited[match[1]]=(credited[match[1]]||0)+1;
  });
  var due=0;
  Object.keys(counts).forEach(function(key){
    due+=Math.max(0,Math.floor(counts[key]/3)-(credited[key]||0));
  });
  var result={ok:true,readOnly:true,totalNothing:wins.filter(bokNothingPrizeRow_).length,
    pendingBonusGroups:due,playersWithNothing:Object.keys(counts).length,
    wheelFunctionAvailable:typeof achSpin_==='function',
    vkAppId:typeof BOK_VK_CLIENT_ID==='undefined'?'NOT_FOUND':String(BOK_VK_CLIENT_ID)};
  Logger.log(JSON.stringify(result));return result;
}
