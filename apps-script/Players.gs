/**
 * Players.gs — игроки, накопительный баланс номерков, пропуски, обмен на скидку, закрытие эфира, импорт.
 *
 * Правила (настраиваются в админке):
 *  • Эфир закрывается кнопкой «Завершить эфир»: админ отмечает победителя(ей).
 *  • Победитель: баланс обнуляется (вместе с номерками этого эфира).
 *  • Остальные участники эфира (с подтверждёнными номерками): номерки эфира добавляются на накопительный баланс, пропуски сбрасываются.
 *  • Не участвовавшие, у кого баланс > 0 и баланс не заморожен: пропуск +1; на N-м подряд (по умолчанию 3) баланс обнуляется.
 *  • Баланс на брони не тратится: он копится для обмена на скидку (ссылка на переписку ВК, обмен делает админ).
 * Журнал «Операции» — история изменений; лист «Откат» — снимок для отмены последнего закрытия.
 */

var SHEET_PLAYERS = 'Игроки';
var SHEET_LEDGER = 'Операции';
var SHEET_UNDO = 'Откат';
var SHEET_IMPORT = 'Импорт';

var PLAYER_HEADERS = ['Ключ ВК', 'Имя', 'Ссылка ВК', 'Фото', 'Баланс', 'Пропуски подряд', 'Заморожен', 'Куплено всего',
  'Выиграно', 'Последний эфир', 'Заметка', 'Создан', 'Обновлён'];
var P = { KEY: 0, NAME: 1, URL: 2, PHOTO: 3, BAL: 4, MISS: 5, FROZEN: 6, BOUGHT: 7, WINS: 8, LAST: 9, NOTE: 10, CREATED: 11, UPDATED: 12 };
var LEDGER_HEADERS = ['Время', 'Игрок', 'Ключ ВК', 'Операция', 'Изменение', 'Баланс после', 'Пропуски после', 'Эфир', 'Кто', 'Комментарий'];
var IMPORT_HEADERS = ['Ссылка ВК', 'Имя', 'Баланс', 'Пропуски', 'Заметка', 'Результат'];
var OP = {
  EVENT: 'ЭФИР', WIN: 'ВЫИГРЫШ', MISSRESET: 'ОБНУЛЕНИЕ ЗА ПРОПУСКИ', MISS: 'ПРОПУСК', MANUAL: 'РУЧНОЕ',
  EXCHANGE: 'ОБМЕН', IMPORT: 'ИМПОРТ', START: 'СТАРТОВЫЙ БАЛАНС', MISSSET: 'ПРОПУСКИ ВРУЧНУЮ', FREEZE: 'ЗАМОРОЗКА'
};

// ───────────────────────── Листы ─────────────────────────

function initPlayerSheets_() {
  var ss = ss_();
  var pl = ss.getSheetByName(SHEET_PLAYERS) || ss.insertSheet(SHEET_PLAYERS);
  pl.getRange('A:A').setNumberFormat('@');
  pl.getRange('L:M').setNumberFormat('dd.mm.yyyy HH:mm');
  pl.getRange(1, 1, 1, PLAYER_HEADERS.length).setValues([PLAYER_HEADERS]);
  pl.getRange(1, 1, 1, PLAYER_HEADERS.length).setFontWeight('bold');
  pl.setFrozenRows(1);
  pl.setColumnWidth(2, 200);
  pl.getRange('G2:G3000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ДА', 'НЕТ'], true).build());

  var lg = ss.getSheetByName(SHEET_LEDGER) || ss.insertSheet(SHEET_LEDGER);
  lg.getRange('A:A').setNumberFormat('dd.mm.yyyy HH:mm:ss');
  lg.getRange('C:C').setNumberFormat('@');
  lg.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
  lg.getRange(1, 1, 1, LEDGER_HEADERS.length).setFontWeight('bold');
  lg.setFrozenRows(1);

  var im = ss.getSheetByName(SHEET_IMPORT) || ss.insertSheet(SHEET_IMPORT);
  im.getRange('A:A').setNumberFormat('@');
  im.getRange(1, 1, 1, IMPORT_HEADERS.length).setValues([IMPORT_HEADERS]);
  im.getRange(1, 1, 1, IMPORT_HEADERS.length).setFontWeight('bold');
  im.setFrozenRows(1);

  if (!ss.getSheetByName(SHEET_UNDO)) ss.insertSheet(SHEET_UNDO);   // служебный лист: снимок для отката последнего закрытия
}

function ensurePlayerSheets_() {
  var ss = ss_();
  if (!ss.getSheetByName(SHEET_PLAYERS) || !ss.getSheetByName(SHEET_LEDGER) || !ss.getSheetByName(SHEET_IMPORT) || !ss.getSheetByName(SHEET_UNDO)) initPlayerSheets_();
}

// ───────────────────────── Игроки ─────────────────────────

function nonNegInt_(v) { return Math.max(0, Math.floor(Number(v) || 0)); }

function rowToPlayer_(r, rowNum) {
  return {
    row: rowNum, key: String(r[P.KEY]).trim(), name: String(r[P.NAME]), url: String(r[P.URL]), photo: String(r[P.PHOTO] || ''),
    balance: nonNegInt_(r[P.BAL]), misses: nonNegInt_(r[P.MISS]), frozen: yes_(r[P.FROZEN]),
    bought: nonNegInt_(r[P.BOUGHT]), wins: nonNegInt_(r[P.WINS]), last: String(r[P.LAST] || ''), note: String(r[P.NOTE] || ''),
    created: toMs_(r[P.CREATED]), updated: toMs_(r[P.UPDATED])
  };
}

function playerToRow_(p) {
  function d(ms) { return ms ? new Date(ms) : ''; }
  return [p.key, p.name, p.url || '', p.photo || '', p.balance, p.misses, p.frozen ? 'ДА' : 'НЕТ', p.bought || 0, p.wins || 0,
    p.last || '', p.note || '', d(p.created), d(p.updated)];
}

function copyPlayer_(p) {
  var c = {};
  for (var k in p) c[k] = p[k];
  return c;
}

/** Список игроков. Если листа ещё нет (таблицу не обновляли через init) — пусто, без ошибки. */
function readPlayers_() {
  var sh = ss_().getSheetByName(SHEET_PLAYERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, PLAYER_HEADERS.length).getValues().forEach(function (r, i) {
    if (String(r[P.KEY]).trim() === '') return;
    out.push(rowToPlayer_(r, i + 2));
  });
  return out;
}

function findPlayer_(key) {
  var k = String(key == null ? '' : key).trim();
  var list = readPlayers_();
  for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
  return null;
}

function savePlayer_(p) {
  p.updated = Date.now();
  if (p.row) {
    sheet_(SHEET_PLAYERS).getRange(p.row, 1, 1, PLAYER_HEADERS.length).setValues([playerToRow_(p)]);
  } else {
    if (!p.created) p.created = p.updated;
    var sh = sheet_(SHEET_PLAYERS);
    sh.appendRow(playerToRow_(p));
    p.row = sh.getLastRow();
  }
}

/** Записывает весь список игроков одним действием (используется при закрытии эфира). */
function writeAllPlayers_(list) {
  var sh = sheet_(SHEET_PLAYERS), last = sh.getLastRow(), now = Date.now();
  if (last >= 2) sh.getRange(2, 1, last - 1, PLAYER_HEADERS.length).clearContent();
  if (!list.length) return;
  list.forEach(function (p) { p.updated = now; if (!p.created) p.created = now; });
  sh.getRange(2, 1, list.length, PLAYER_HEADERS.length).setValues(list.map(playerToRow_));
  list.forEach(function (p, i) { p.row = i + 2; });
}

function nameCmp_(a, b) { return cmpName_(a.name, b.name); }

// ───────────────────────── Журнал операций ─────────────────────────

function ledgerRow_(p, type, delta, who, comment, event) {
  return [new Date(Date.now()), p.name, p.key, type, delta, p.balance, p.misses, event || '', who || 'админ', comment || ''];
}

function appendLedger_(rows) {
  if (!rows.length) return;
  var sh = sheet_(SHEET_LEDGER);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LEDGER_HEADERS.length).setValues(rows);
}

/** Операции после закрытия эфира делают откат небезопасным — считаем их. */
function noteOp_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('CLOSE_OPS', String(Number(props.getProperty('CLOSE_OPS') || 0) + 1));
}

// ───────────────────────── Отображение ─────────────────────────

var TIERS = [50, 30, 20, 10, 5, 1];

/** Баланс для публичного показа: число, ступень («10+») или null (скрыт). */
function balanceDisplay_(bal, mode) {
  if (mode === 'скрыт') return null;
  if (mode === 'ступени') {
    for (var i = 0; i < TIERS.length; i++) if (bal >= TIERS[i]) return TIERS[i] + '+';
    return 0;
  }
  return bal;
}

function canExchange_(bal, s) {
  return s.balanceMode !== 'скрыт' && s.exchangeMin > 0 && bal >= s.exchangeMin;
}

function rulesInfo_(s) {
  return {
    missLimit: s.missLimit, exchangeMin: s.exchangeMin, rate: s.exchangeRate, mode: s.balanceMode,
    url: s.exchangeUrl, button: s.exchangeButton || 'ОБМЕНЯТЬ НА СКИДКУ'
  };
}

/** Публичные признаки игрока рядом с именем: баланс, пропуски, заморозка. */
function playerPublic_(p, s) {
  return { bal: balanceDisplay_(p.balance, s.balanceMode), miss: p.misses, frozen: p.frozen, ex: canExchange_(p.balance, s) };
}

function playerAdmin_(p) {
  return {
    key: p.key, name: p.name, url: p.url, photo: p.photo, balance: p.balance, misses: p.misses, frozen: p.frozen,
    bought: p.bought, wins: p.wins, last: p.last, note: p.note, updated: p.updated
  };
}

/** Публично: все игроки с балансом или пропусками (без технических ключей). */
function actionBalances_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('balances');
  if (hit) { var obj = JSON.parse(hit); obj.now = Date.now(); return obj; }
  var s = readSettings_();
  var list = readPlayers_().filter(function (p) { return p.balance > 0 || p.misses > 0; });
  var players = list.map(function (p) {
    var pub = playerPublic_(p, s);
    return {
      name: fmtName_(p.name, s.nameFormat), photo: p.photo, bal: pub.bal, miss: pub.miss, frozen: pub.frozen, ex: pub.ex,
      worth: pub.ex && s.balanceMode === 'точный' ? Math.round(p.balance * s.exchangeRate) : null
    };
  }).sort(nameCmp_);
  var res = { ok: true, now: Date.now(), rules: rulesInfo_(s), players: players };
  try { cache.put('balances', JSON.stringify(res), 20); } catch (e) { /* слишком большой — не кэшируем */ }
  return res;
}

// ───────────────────────── Действия администратора: игроки ─────────────────────────

function playersPayload_(s) {
  return { ok: true, rules: rulesInfo_(s), players: readPlayers_().sort(nameCmp_).map(playerAdmin_) };
}

function adminPlayers_() {
  return playersPayload_(readSettings_());
}

function parseIntIn_(v, min, max) {
  var n = Number(String(v == null ? '' : v).replace(',', '.').trim());
  if (!isFinite(n) || n % 1 !== 0 || n < min || n > max || String(v).trim() === '') return null;
  return n;
}

function adminPlayerAdd_(body) {
  var s0 = readSettings_();
  var who = identify_({ vkUrl: body.vkUrl, name: body.name }, s0);
  if (!who.ok) return who;
  var typed = cleanName_(body.name);
  var name = typed.length >= 2 ? typed : who.name;
  var bal = body.balance === undefined || body.balance === '' ? 0 : parseIntIn_(body.balance, 0, 100000);
  var miss = body.misses === undefined || body.misses === '' ? 0 : parseIntIn_(body.misses, 0, Math.max(0, s0.missLimit - 1));
  if (bal === null) return err_('BAD_BALANCE', 'Баланс — целое число от 0 до 100 000');
  if (miss === null) return err_('BAD_MISSES', 'Пропусков — целое число от 0 до ' + Math.max(0, s0.missLimit - 1) + ' (на ' + s0.missLimit + '-м баланс обнуляется)');
  return withLock_(function () {
    ensurePlayerSheets_();
    var s = prepareLocked_();
    if (findPlayer_(who.key)) return err_('EXISTS', 'Этот игрок уже есть в списке — измените его баланс или пропуски в карточке.', { key: who.key });
    var p = { row: 0, key: who.key, name: name, url: who.url, photo: who.photo, balance: bal, misses: miss, frozen: false,
      bought: 0, wins: 0, last: '', note: cleanName_(body.note || '') };
    savePlayer_(p);
    appendLedger_([ledgerRow_(p, OP.START, bal, 'админ', 'игрок добавлен вручную' + (miss ? ', пропусков: ' + miss : ''), s.eventNumber)]);
    noteOp_(); invalidate_();
    return Object.assign(playersPayload_(s), { player: playerAdmin_(p) });
  });
}

function adminPlayerAdjust_(body) {
  var delta = parseIntIn_(body.delta, -100000, 100000);
  if (delta === null || delta === 0) return err_('BAD_DELTA', 'Укажите целое число номерков, не ноль (минус — списать)');
  return withLock_(function () {
    ensurePlayerSheets_();
    var s = readSettings_();
    var p = findPlayer_(body.key);
    if (!p) return err_('NOT_FOUND', 'Игрок не найден');
    if (p.balance + delta < 0) return err_('NEGATIVE', 'Баланс не может стать отрицательным (сейчас ' + p.balance + ')');
    p.balance += delta;
    savePlayer_(p);
    appendLedger_([ledgerRow_(p, OP.MANUAL, delta, 'админ', cleanName_(body.reason || '') || 'ручная корректировка', s.eventNumber)]);
    noteOp_(); invalidate_();
    return Object.assign(playersPayload_(s), { player: playerAdmin_(p) });
  });
}

function adminPlayerSetMisses_(body) {
  var s0 = readSettings_();
  var max = Math.max(0, s0.missLimit - 1);
  var m = parseIntIn_(body.misses, 0, max);
  if (m === null) return err_('BAD_MISSES', 'Пропусков — целое число от 0 до ' + max + ' (на ' + s0.missLimit + '-м баланс обнуляется)');
  return withLock_(function () {
    ensurePlayerSheets_();
    var p = findPlayer_(body.key);
    if (!p) return err_('NOT_FOUND', 'Игрок не найден');
    var was = p.misses;
    p.misses = m;
    savePlayer_(p);
    appendLedger_([ledgerRow_(p, OP.MISSSET, 0, 'админ', 'пропусков было ' + was + ', стало ' + m, s0.eventNumber)]);
    noteOp_(); invalidate_();
    return Object.assign(playersPayload_(s0), { player: playerAdmin_(p) });
  });
}

function adminPlayerFreeze_(body) {
  return withLock_(function () {
    ensurePlayerSheets_();
    var s = readSettings_();
    var p = findPlayer_(body.key);
    if (!p) return err_('NOT_FOUND', 'Игрок не найден');
    p.frozen = !!body.frozen;
    savePlayer_(p);
    appendLedger_([ledgerRow_(p, OP.FREEZE, 0, 'админ', p.frozen ? 'баланс заморожен: пропуски не считаются' : 'баланс разморожен', s.eventNumber)]);
    noteOp_(); invalidate_();
    return Object.assign(playersPayload_(s), { player: playerAdmin_(p) });
  });
}

/** Обмен на скидку: админ выдаёт промокод в переписке ВК, здесь только списываются номерки и пишется история. */
function adminExchange_(body) {
  return withLock_(function () {
    ensurePlayerSheets_();
    var s = readSettings_();
    var p = findPlayer_(body.key);
    if (!p) return err_('NOT_FOUND', 'Игрок не найден');
    var n = parseIntIn_(body.tickets, 1, 100000);
    if (n === null) return err_('BAD_TICKETS', 'Укажите целое число номерков для обмена');
    if (n > p.balance) return err_('NEGATIVE', 'На балансе всего ' + p.balance + ' номерков');
    var discount = Math.round(n * s.exchangeRate);
    p.balance -= n;
    savePlayer_(p);
    var note = cleanName_(body.note || '');
    appendLedger_([ledgerRow_(p, OP.EXCHANGE, -n, 'админ', 'скидка ' + discount + ' ₽ (курс ' + s.exchangeRate + ' ₽ за номерок)' + (note ? ' · ' + note : ''), s.eventNumber)]);
    noteOp_(); invalidate_();
    return Object.assign(playersPayload_(s), { player: playerAdmin_(p), discountRub: discount });
  });
}

function adminPlayerHistory_(body) {
  var key = String(body.key == null ? '' : body.key).trim();
  var sh = ss_().getSheetByName(SHEET_LEDGER);
  var out = [];
  if (sh && sh.getLastRow() >= 2) {
    var last = sh.getLastRow(), from = Math.max(2, last - 2999);
    sh.getRange(from, 1, last - from + 1, LEDGER_HEADERS.length).getValues().forEach(function (r) {
      if (String(r[2]).trim() !== key) return;
      out.push({ time: toMs_(r[0]), type: String(r[3]), delta: Number(r[4]) || 0, balance: Number(r[5]) || 0, misses: Number(r[6]) || 0,
        event: String(r[7] || ''), who: String(r[8] || ''), comment: String(r[9] || '') });
    });
  }
  return { ok: true, history: out.reverse().slice(0, 60) };
}

// ───────────────────────── Закрытие эфира ─────────────────────────

/** Расчёт изменений при закрытии эфира без записи. */
function planClose_(s, real, players, winners, label) {
  var part = {}, order = [], skipped = [];
  real.forEach(function (b) {
    if (b.status !== ST.OK) return;
    var k = b.vkKey;
    if (!k || k.indexOf('adm:') === 0 || k === 'block') { skipped.push(b); return; }
    if (!part[k]) { part[k] = { key: k, name: b.name, url: b.vkUrl, photo: b.photo, tickets: 0 }; order.push(k); }
    part[k].tickets += b.numbers.length;
    if (!part[k].photo && b.photo) part[k].photo = b.photo;
  });
  for (var i = 0; i < winners.length; i++) {
    if (!part[winners[i]]) return { error: err_('BAD_WINNER', 'Победитель должен быть среди участников этого эфира с подтверждёнными номерками') };
  }
  var next = players.map(copyPlayer_), byKey = {};
  next.forEach(function (p) { byKey[p.key] = p; });
  var changes = [], now = Date.now();

  order.forEach(function (k) {
    var e = part[k], p = byKey[k], isNew = !p;
    if (!p) {
      p = { row: 0, key: k, name: e.name, url: e.url, photo: e.photo, balance: 0, misses: 0, frozen: false, bought: 0, wins: 0, last: '', note: '', created: now };
      next.push(p); byKey[k] = p;
    }
    if (!p.photo && e.photo) p.photo = e.photo;
    if (!p.url && e.url) p.url = e.url;
    var before = { balance: p.balance, misses: p.misses };
    var isWin = winners.indexOf(k) >= 0;
    if (isWin) { p.balance = 0; p.misses = 0; p.wins += 1; }
    else { p.balance += e.tickets; p.misses = 0; }
    p.bought += e.tickets;
    p.last = label;
    changes.push({ key: k, name: p.name, type: isWin ? OP.WIN : OP.EVENT, tickets: e.tickets, isNew: isNew, before: before, after: { balance: p.balance, misses: p.misses } });
  });

  next.forEach(function (p) {
    if (part[p.key] || p.balance <= 0 || p.frozen) return;
    var before = { balance: p.balance, misses: p.misses };
    p.misses += 1;
    var burned = p.misses >= s.missLimit;
    if (burned) { p.balance = 0; p.misses = 0; }
    changes.push({ key: p.key, name: p.name, type: burned ? OP.MISSRESET : OP.MISS, tickets: 0, isNew: false, before: before, after: { balance: p.balance, misses: p.misses } });
  });
  return { next: next, changes: changes, participants: order.length, skipped: skipped };
}

function changeComment_(c, s) {
  if (c.type === OP.EVENT) return 'номерков в эфире: ' + c.tickets;
  if (c.type === OP.WIN) return 'выиграл — баланс обнулён (было ' + c.before.balance + ', номерков в эфире: ' + c.tickets + ')';
  if (c.type === OP.MISSRESET) return 'пропуск № ' + (c.before.misses + 1) + ' подряд — баланс обнулён (было ' + c.before.balance + ')';
  return 'пропуск эфира: ' + c.after.misses + ' из ' + s.missLimit + ' подряд';
}

function summarizeClose_(plan, s, openCount) {
  var sum = { participants: plan.participants, credited: 0, winners: 0, missed: 0, burned: 0, skipped: plan.skipped.length, unconfirmedClosed: openCount };
  plan.changes.forEach(function (c) {
    if (c.type === OP.EVENT) sum.credited += c.tickets;
    else if (c.type === OP.WIN) sum.winners++;
    else if (c.type === OP.MISS) sum.missed++;
    else if (c.type === OP.MISSRESET) sum.burned++;
  });
  return sum;
}

var UNDO_CHUNK = 40000;

function jsonDates_(k, v) {
  var raw = this[k];
  if (Object.prototype.toString.call(raw) === '[object Date]') return { '$d': raw.getTime() };
  return v;
}
function jsonRevive_(k, v) {
  return v && typeof v === 'object' && v['$d'] !== undefined ? new Date(v['$d']) : v;
}

function readRawBlock_(name, width) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().filter(function (r) { return String(r[0]).trim() !== ''; });
}

/** Снимок перед закрытием: игроки и все строки «Броней» (JSON в ячейках, чтобы форматы таблицы не искажали данные). */
function writeUndoSnapshot_(meta, playersRaw, bookingsRaw) {
  var ss = ss_();
  var old = ss.getSheetByName(SHEET_UNDO);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(SHEET_UNDO);
  sh.getRange(1, 1, 1, 2).setValues([['META', JSON.stringify(meta)]]);
  var text = JSON.stringify({ players: playersRaw, bookings: bookingsRaw }, jsonDates_);
  var chunks = [];
  for (var i = 0; i < text.length; i += UNDO_CHUNK) chunks.push([text.slice(i, i + UNDO_CHUNK)]);
  if (chunks.length) sh.getRange(2, 1, chunks.length, 1).setValues(chunks);
}

function readUndoMeta_() {
  var sh = ss_().getSheetByName(SHEET_UNDO);
  if (!sh || sh.getLastRow() < 1) return null;
  var v = sh.getRange(1, 1, 1, 2).getValues()[0];
  if (String(v[0]) !== 'META' || !v[1]) return null;
  try { return JSON.parse(String(v[1])); } catch (e) { return null; }
}

function readUndoSnapshot_() {
  var sh = ss_().getSheetByName(SHEET_UNDO);
  var parts = [];
  if (sh && sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { parts.push(String(r[0])); });
  return JSON.parse(parts.join(''), jsonRevive_);
}

/** Можно ли откатить последнее закрытие (только пока после него ничего не менялось). */
function undoInfo_() {
  var meta = readUndoMeta_();
  if (!meta) return null;
  var info = { event: meta.event, archive: meta.archive || '', closedAt: meta.closedAt, possible: true, reason: '' };
  var props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty('CLOSE_OPS') || 0) > 0) {
    info.possible = false; info.reason = 'После закрытия вы уже меняли игроков (начисление, обмен, пропуски и т. п.) — откат сотрёт эти правки. Исправьте нужное вручную.';
  } else if (readRawBlock_(SHEET_BOOKINGS, BOOKING_HEADERS.length).length) {
    info.possible = false; info.reason = 'После закрытия появились новые брони или блокировки номерков — откат их сотрёт.';
  }
  return info;
}

function closeToken_(s, label) {
  return 'закрытие эфира №' + label + ' (' + fmtLocal_(Date.now(), Math.round(s.utcOffset * 60)) + ')';
}

/**
 * «Завершить эфир»: подсчёт балансов и пропусков, архив броней, переход к следующему эфиру.
 * body: winners (массив ключей, пустой = без победителя), dryRun, force, newNumber, newDate.
 */
function adminArchive_(body) {
  if (Object.prototype.toString.call(body.winners) !== '[object Array]') {
    return err_('NO_WINNERS', 'Укажите победителя или отметьте «без победителя»');
  }
  var winners = body.winners.map(function (w) { return String(w).trim(); });
  return withLock_(function () {
    var s = prepareLocked_();
    ensurePlayerSheets_();
    var real = readBookings_().filter(function (b) { return b.status !== ST.BLOCK; });
    var open = real.filter(function (b) { return UNCONFIRMED.indexOf(b.status) >= 0; });
    if (open.length && !body.force) {
      return err_('PENDING', 'Есть неподтверждённые брони: ' + open.length + '. Подтвердите или отмените их либо закройте вместе с эфиром.', { pending: open.length });
    }
    var label = s.eventNumber || 'без номера';
    var plan = planClose_(s, real, readPlayers_(), winners, label);
    if (plan.error) return plan.error;
    var newNumber = cleanName_(body.newNumber);
    if (!newNumber && /^\d+$/.test(label)) newNumber = String(Number(label) + 1);
    var newDate = String(body.newDate == null ? '' : body.newDate).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 100);
    var summary = summarizeClose_(plan, s, open.length);

    if (body.dryRun) {
      return {
        ok: true, dryRun: true, event: label, newNumber: newNumber, summary: summary,
        changes: plan.changes.map(function (c) { return { name: c.name, type: c.type, tickets: c.tickets, isNew: c.isNew, before: c.before, after: c.after, comment: changeComment_(c, s) }; }),
        skipped: plan.skipped.map(function (b) { return { name: b.name, numbers: b.numbers }; })
      };
    }

    var token = closeToken_(s, label);
    var playersRaw = readRawBlock_(SHEET_PLAYERS, PLAYER_HEADERS.length);
    var bookingsRaw = readRawBlock_(SHEET_BOOKINGS, BOOKING_HEADERS.length);
    var oldNumber = s.eventNumber, oldDate = s.eventDate;

    // 1. архив броней (данные не трогаем, пока архив не записан и проверен)
    var archiveName = '';
    if (real.length) {
      open.forEach(function (b) {
        b.status = ST.EXPIRED; b.deadline = null; b.leftMin = null;
        b.note = (b.note ? b.note + '; ' : '') + 'закрыта при завершении эфира';
      });
      var rows = real.map(function (b) { b.event = b.event || label; return bookingToRow_(b); });
      var ss = ss_();
      archiveName = uniqueSheetName_(ss, 'Архив №' + label);
      var sh = ss.insertSheet(archiveName, ss.getSheets().length);
      sh.getRange('E:E').setNumberFormat('@');
      sh.getRange('B:B').setNumberFormat('dd.mm.yyyy HH:mm');
      sh.getRange('H:H').setNumberFormat('dd.mm.yyyy HH:mm');
      sh.getRange('N:N').setNumberFormat('dd.mm.yyyy HH:mm');
      sh.getRange(1, 1, 1, BOOKING_HEADERS.length).setValues([BOOKING_HEADERS]);
      sh.getRange(1, 1, 1, BOOKING_HEADERS.length).setFontWeight('bold');
      sh.getRange(2, 1, rows.length, BOOKING_HEADERS.length).setValues(rows);
      sh.setFrozenRows(1);
      SpreadsheetApp.flush();
      if (sh.getLastRow() !== rows.length + 1) {
        ss.deleteSheet(sh);
        throw new Error('Архив записан не полностью — рабочие данные не тронуты');
      }
    }

    // 2. снимок для отката
    writeUndoSnapshot_({ event: label, archive: archiveName, oldNumber: oldNumber, oldDate: oldDate, token: token, closedAt: Date.now() }, playersRaw, bookingsRaw);

    // 3. балансы и журнал
    writeAllPlayers_(plan.next);
    var byKey = {};
    plan.next.forEach(function (p) { byKey[p.key] = p; });
    appendLedger_(plan.changes.map(function (c) {
      var p = byKey[c.key];
      return ledgerRow_(p, c.type, c.after.balance - c.before.balance, token, changeComment_(c, s), label);
    }));

    // 4. очистка рабочего листа и переход к следующему эфиру
    var work = sheet_(SHEET_BOOKINGS), last = work.getLastRow();
    if (last >= 2) work.getRange(2, 1, last - 1, BOOKING_HEADERS.length).clearContent();
    writeSetting_('eventNumber', newNumber);
    writeSetting_('eventDate', newDate);
    PropertiesService.getScriptProperties().setProperty('CLOSE_OPS', '0');
    log_('админ', 'эфир завершён', '№' + label + (archiveName ? ' → «' + archiveName + '», броней: ' + real.length : ', броней не было') +
      '; победители: ' + (winners.length ? winners.length : 'нет') + '; новый эфир: ' + (newNumber || '—'));
    invalidate_();
    var st = adminState_();
    st.archive = { sheet: archiveName, rows: real.length, closed: open.length, oldNumber: label, newNumber: newNumber, summary: summary };
    return st;
  });
}

function adminUndoClose_() {
  return withLock_(function () {
    var info = undoInfo_();
    if (!info) return err_('NO_UNDO', 'Нет закрытия эфира, которое можно откатить');
    if (!info.possible) return err_('UNDO_BLOCKED', info.reason);
    var meta = readUndoMeta_();
    var snap = readUndoSnapshot_();
    var ss = ss_();

    // игроки и брони — как до закрытия
    var pl = sheet_(SHEET_PLAYERS), pLast = pl.getLastRow();
    if (pLast >= 2) pl.getRange(2, 1, pLast - 1, PLAYER_HEADERS.length).clearContent();
    if (snap.players.length) pl.getRange(2, 1, snap.players.length, PLAYER_HEADERS.length).setValues(snap.players);
    var bk = sheet_(SHEET_BOOKINGS), bLast = bk.getLastRow();
    if (bLast >= 2) bk.getRange(2, 1, bLast - 1, BOOKING_HEADERS.length).clearContent();
    if (snap.bookings.length) bk.getRange(2, 1, snap.bookings.length, BOOKING_HEADERS.length).setValues(snap.bookings);

    // журнал: убираем записи этого закрытия
    var lg = sheet_(SHEET_LEDGER), lLast = lg.getLastRow();
    if (lLast >= 2) {
      var keep = lg.getRange(2, 1, lLast - 1, LEDGER_HEADERS.length).getValues().filter(function (r) { return String(r[8]) !== meta.token; });
      lg.getRange(2, 1, lLast - 1, LEDGER_HEADERS.length).clearContent();
      if (keep.length) lg.getRange(2, 1, keep.length, LEDGER_HEADERS.length).setValues(keep);
    }

    // архив и настройки эфира
    if (meta.archive) {
      var arch = ss.getSheetByName(meta.archive);
      if (arch) ss.deleteSheet(arch);
    }
    writeSetting_('eventNumber', meta.oldNumber);
    writeSetting_('eventDate', meta.oldDate);
    var undo = ss.getSheetByName(SHEET_UNDO);
    if (undo) ss.deleteSheet(undo);
    ss.insertSheet(SHEET_UNDO);
    PropertiesService.getScriptProperties().setProperty('CLOSE_OPS', '0');
    log_('админ', 'откат закрытия', 'эфир №' + meta.event);
    invalidate_();
    return adminState_();
  });
}

// ───────────────────────── Импорт из листа «Импорт» ─────────────────────────

/**
 * Импорт игроков из листа «Импорт» (колонки: ссылка ВК, имя, баланс, пропуски, заметка; в колонку «Результат» пишется итог).
 * body: dryRun (только проверка строк), mode ('set' — заменить баланс и пропуски, 'add' — прибавить баланс), force (повторить уже обработанные).
 */
function adminImport_(body) {
  ensurePlayerSheets_();
  var s0 = readSettings_();
  var sh = sheet_(SHEET_IMPORT);
  var last = sh.getLastRow();
  if (last < 2) return err_('EMPTY', 'Лист «Импорт» пуст: вставьте туда игроков (ссылка ВК, имя, баланс, пропуски, заметка) и повторите.');
  var rows = sh.getRange(2, 1, last - 1, IMPORT_HEADERS.length).getValues();
  var mode = body.mode === 'add' ? 'add' : 'set', dry = !!body.dryRun;
  var started = Date.now(), maxMiss = Math.max(0, s0.missLimit - 1);
  var res = { ok: true, dryRun: dry, mode: mode, created: 0, updated: 0, errors: 0, skipped: 0, remaining: 0, problems: [] };

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], rowNum = i + 2;
    var link = String(r[0]).trim(), nm = cleanName_(r[1]);
    if (!link && !nm && String(r[2]).trim() === '' && String(r[3]).trim() === '') continue;
    if (!dry && /^(ок|создан|обновл)/i.test(String(r[5]).trim()) && !body.force) { res.skipped++; continue; }
    if (Date.now() - started > 230000) { res.remaining++; continue; }          // лимит времени Apps Script — продолжите повторным запуском

    var fail = function (msg) {
      res.errors++; if (res.problems.length < 30) res.problems.push({ row: rowNum, text: msg });
      if (!dry) sh.getRange(rowNum, 6).setValue('ошибка: ' + msg);
    };
    var bal = String(r[2]).trim() === '' ? null : parseIntIn_(r[2], 0, 100000);
    var miss = String(r[3]).trim() === '' ? null : parseIntIn_(r[3], 0, maxMiss);
    if (bal === null && String(r[2]).trim() !== '') { fail('баланс — целое число от 0 до 100 000'); continue; }
    if (miss === null && String(r[3]).trim() !== '') { fail('пропусков — целое число от 0 до ' + maxMiss); continue; }
    if (!link) { fail('нет ссылки на профиль ВК'); continue; }
    var p0 = parseVkLink_(link);
    if (!p0.ok) { fail(p0.message); continue; }
    if (dry) { res.created++; continue; }                                        // при проверке считаем строку допустимой

    // Уже известный игрок — запрос к ВК не нужен (быстрее и не зависит от доступности ВК)
    var known = findPlayer_(p0.key);
    var who = known
      ? { ok: true, key: known.key, name: known.name, url: known.url || p0.url, photo: known.photo }
      : identify_({ vkUrl: link, name: r[1] }, s0);
    if (!who.ok) { fail(who.error.message); continue; }
    var outcome = withLock_(function () {
      var cur = findPlayer_(who.key);
      var s = readSettings_();
      if (!cur) {
        var np = { row: 0, key: who.key, name: nm.length >= 2 ? nm : who.name, url: who.url, photo: who.photo, balance: bal || 0, misses: miss || 0,
          frozen: false, bought: 0, wins: 0, last: '', note: cleanName_(r[4]) };
        savePlayer_(np);
        appendLedger_([ledgerRow_(np, OP.IMPORT, np.balance, 'импорт', 'новый игрок, стартовый баланс', s.eventNumber)]);
        return 'создан';
      }
      var before = cur.balance;
      if (bal !== null) cur.balance = mode === 'add' ? cur.balance + bal : bal;
      if (miss !== null) cur.misses = miss;
      if (!cur.photo && who.photo) cur.photo = who.photo;
      if (cleanName_(r[4])) cur.note = cleanName_(r[4]);
      savePlayer_(cur);
      appendLedger_([ledgerRow_(cur, OP.IMPORT, cur.balance - before, 'импорт', 'баланс был ' + before + (mode === 'add' ? ' (добавлено)' : ' (заменён)'), s.eventNumber)]);
      return 'обновлён';
    });
    noteOp_();
    if (outcome === 'создан') res.created++; else res.updated++;
    sh.getRange(rowNum, 6).setValue('ок: ' + outcome);
  }
  invalidate_();
  return res;
}

/** Публичный список известных игроков для быстрого выбора при брони: только имя (в принятом формате), фото и id. Ссылки ВК не отдаются. */
function actionPlayerList_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('playerlist');
  if (hit) return JSON.parse(hit);
  var s = readSettings_();
  var res = { ok: true, players: readPlayers_().sort(nameCmp_).map(function (p) {
    return { id: p.key, name: fmtName_(p.name, s.nameFormat), photo: p.photo || '' };
  }) };
  try { cache.put('playerlist', JSON.stringify(res), 30); } catch (e) { /* слишком большой — не кэшируем */ }
  return res;
}
