/**
 * BOK Body achievement progress extension 6.7.16.
 * Adds READ-ONLY action achRich. Does not modify Achievements.gs,
 * player ledgers, historical awards, or any available spins.
 * Requires existing Achievements.gs and Players.gs functions.
 */
var BOK_ACH_RICH_EXTRA = [
  ['freeze1', '❄️', 'Снежная пауза', 'Заморозка баланса', 1, 'freeze'],
  ['thaw1', '🧊', 'Лёд тронулся', 'Разморозка баланса', 1, 'thaw'],
  ['exchange30', '🏅', 'Магистр обмена', 'Обмен номерков на скидку', 30, 'exchange'],
  ['exchange60', '🎁', 'Шкаф выгодных обменов', 'Обмен номерков на скидку', 60, 'exchange'],
  ['exchange90', '🗝️', 'Сундук скидок', 'Обмен номерков на скидку', 90, 'exchange']
];

function bokAchRichMetrics_() {
  var cache=CacheService.getScriptCache(), key='bok_ach_rich_metrics_v1', stored=cache.get(key);
  if(stored) { try { return JSON.parse(stored); } catch(_e){} }
  var metrics=achMetrics_();
  try { cache.put(key,JSON.stringify(metrics),120); } catch(_e){}
  return metrics;
}

function bokAchRichLedger_(key) {
  var out={freeze:0,thaw:0,exchange:0};
  var sh=ss_().getSheetByName(SHEET_LEDGER);
  if(!sh||sh.getLastRow()<2)return out;
  // C:J = VK key, operation, change, balance, misses, event, actor, comment.
  var data=sh.getRange(2,3,sh.getLastRow()-1,8).getValues();
  for(var i=0;i<data.length;i++){
    var row=data[i];
    if(String(row[0]).trim()!==key)continue;
    var op=String(row[1]).trim(),change=Number(row[2])||0,description=String(row[7]||'').toLowerCase();
    if(op==='ОБМЕН'&&change<0)out.exchange+=Math.abs(change);
    if(op==='ЗАМОРОЗКА'){
      if(description.indexOf('размороз')!==-1)out.thaw++;
      else if(description.indexOf('замороз')!==-1)out.freeze++;
    }
  }
  return out;
}

function bokAchRich_(body) {
  body=body||{};
  var url=String(body.url||'').trim();
  if(!url)return err_('PLAYER','Требуется ссылка участника');
  var player=readPlayers_().filter(function(p){return String(p.url||'')===url;})[0];
  if(!player)return err_('PLAYER','Участник не найден');
  // The existing public endpoint is the authoritative source for earned awards.
  var basic=achPublic_(body);
  if(!basic||!basic.ok)return basic;
  var m={};
  try { m=bokAchRichMetrics_()[String(player.key)]||{}; } catch(e) {
    // Historic metrics are best-effort; avoid fabricating progress on errors.
    Logger.log('BOK ach metrics: '+String(e));
  }
  var ledger=bokAchRichLedger_(String(player.key));
  var typeToProgress={
    streak:m.streak,visits:m.visits,tickets:m.tickets,miss:m.miss,
    freeze:ledger.freeze,thaw:ledger.thaw,exchange:ledger.exchange
  };
  var cards=(basic.achievements||[]).map(function(a){
    var raw=typeToProgress[String(a.type||'')];
    var n=typeof raw==='number'&&isFinite(raw)?Math.max(0,Math.floor(raw)):null;
    return {
      id:a.id,emoji:a.emoji,title:a.title,description:a.description,
      target:a.target,type:a.type,reward:a.reward,earned:!!a.earned,date:a.date||'',
      // Friend booking events currently have no reliable historic counter.
      progress:a.earned?Number(a.target):n
    };
  });
  BOK_ACH_RICH_EXTRA.forEach(function(def){
    var type=def[5],progress=typeToProgress[type]||0;
    cards.push({id:def[0],emoji:def[1],title:def[2],description:def[3],
      target:def[4],type:type,reward:0,earned:progress>=def[4],
      progress:Math.min(def[4],progress),date:''});
  });
  return {ok:true,achievements:cards,progressVersion:1};
}

// Safe editor test; never writes balances, awards or spins.
function bokAchRichReadOnlyCheck(){
  var result={ok:true,readOnly:true,extra:BOK_ACH_RICH_EXTRA.length,
    ids:BOK_ACH_RICH_EXTRA.map(function(a){return a[0];}),
    playerSheetsReady:!!ss_().getSheetByName(SHEET_LEDGER)};
  Logger.log(JSON.stringify(result));
  return result;
}
