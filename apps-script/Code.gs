/**
 * Номерок — бронирование. Серверная часть на Google Apps Script.
 * Данные хранятся в Google Таблице (листы «Настройки», «Брони», «Журнал»).
 * Все записи идут под блокировкой (LockService) — двойных броней не будет.
 *
 * Свойства скрипта (Project Settings → Script properties):
 *   ADMIN_PASSWORD — пароль админки (обязательно, 12+ символов)
 *   VK_TOKEN       — сервисный ключ VK-приложения (необязательно: имя подтягивается из профиля)
 */

/** Версия серверной части. Админка предупреждает, если сайт новее сервера (забыли обновить Apps Script). */
var SERVER_VERSION = 5;

var SHEET_SETTINGS = 'Настройки';
var SHEET_BOOKINGS = 'Брони';
var SHEET_LOG = 'Журнал';

var ST = {
  PENDING: 'ОЖИДАЕТ',
  PAID: 'ОПЛАТА ЗАЯВЛЕНА',
  OK: 'ПОДТВЕРЖДЕНА',
  EXPIRED: 'ИСТЕКЛА',
  CANCELLED: 'ОТМЕНЕНА',
  BLOCK: 'БЛОК'
};
var HOLDING = [ST.PENDING, ST.PAID, ST.OK, ST.BLOCK];   // номерки заняты
var UNCONFIRMED = [ST.PENDING, ST.PAID];                // идёт таймер

var BOOKING_HEADERS = ['Код', 'Создана', 'Имя', 'Ссылка ВК', 'Номерки', 'Кол-во', 'Статус', 'Дедлайн',
  'Осталось мин (пауза)', 'Источник', 'Заметка', 'Ключ ВК', 'Клиент', 'Обновлена', 'Напомнено', 'Фото', 'Эфир'];
var C = { CODE: 0, CREATED: 1, NAME: 2, VKURL: 3, NUMS: 4, COUNT: 5, STATUS: 6, DEADLINE: 7, LEFT: 8,
  SOURCE: 9, NOTE: 10, VKKEY: 11, CLIENT: 12, UPDATED: 13, REMINDED: 14, PHOTO: 15, EVENT: 16 };

var SETTINGS_SCHEMA = [
  { key: 'eventNumber', label: 'Номер эфира', def: '1', type: 'text', hint: 'Показывается участникам: «Эфир №…»' },
  { key: 'eventTitle', label: 'Название эфира', def: 'Прямой эфир мастерской', type: 'text', hint: '' },
  { key: 'eventDate', label: 'Дата и время эфира', def: '', type: 'text', hint: 'Текст для участников, например: 2 сентября в 21:10 МСК' },
  { key: 'ticketCount', label: 'Количество номерков', def: '63', type: 'number', hint: '1–500. Уменьшить можно, если номерки с большими номерами свободны' },
  { key: 'priceText', label: 'Цена номерка', def: '250 ₽', type: 'text', hint: 'Текстом, как увидят участники' },
  { key: 'confirmHours', label: 'Часов на подтверждение брони', def: '6', type: 'number', hint: 'Считаются без тихих часов. Можно дробное: 0.5' },
  { key: 'maxPending', label: 'Лимит неподтверждённых номерков на человека', def: '5', type: 'number', hint: 'Пока бронь не подтверждена, сверх лимита брать нельзя. После подтверждения лимит освобождается' },
  { key: 'maxConfirmed', label: 'Потолок номерков на человека за эфир', def: '0', type: 'number', hint: '0 — без потолка' },
  { key: 'quietEnabled', label: 'Тихие часы включены', def: 'ДА', type: 'yesno', hint: 'В тихие часы таймер брони не идёт' },
  { key: 'quietFrom', label: 'Тихие часы: с', def: '00:00', type: 'time', hint: 'ЧЧ:ММ' },
  { key: 'quietTo', label: 'Тихие часы: до', def: '09:00', type: 'time', hint: 'ЧЧ:ММ. Окно может переходить через полночь (23:00 – 08:00)' },
  { key: 'utcOffset', label: 'Часовой пояс организатора (UTC+, часов)', def: '3', type: 'number', hint: 'Москва = 3. Переход на летнее время не учитывается' },
  { key: 'bookingOpen', label: 'Приём броней открыт', def: 'ДА', type: 'yesno', hint: 'НЕТ — сетка видна, но бронировать нельзя' },
  { key: 'paused', label: 'Технический перерыв (заморозка бронирования)', def: 'НЕТ', type: 'yesno', hint: 'ДА — новые брони закрыты, таймеры стоят и продолжатся после возобновления' },
  { key: 'pauseMessage', label: 'Текст на время перерыва', def: 'Технический перерыв. Бронирование скоро возобновится.', type: 'text', hint: '' },
  { key: 'payUrl', label: 'Ссылка на оплату', def: 'https://spasibomir.ru/pay/33434', type: 'text', hint: 'Участники увидят её кнопкой и QR-кодом. Пусто — блок оплаты скрыт' },
  { key: 'postUrl', label: 'Ссылка на пост для комментария', def: '', type: 'text', hint: 'Пост, под которым участники оставляют комментарий с номерками и скриншотом оплаты' },
  { key: 'bulkMin', label: 'Оплата без комиссии: от скольки номерков', def: '4', type: 'number', hint: 'При брони от этого числа номерков показывается надпись и кнопка запроса реквизитов. 0 — отключить' },
  { key: 'bulkText', label: 'Оплата без комиссии: надпись', def: 'Для брони от 4х и более билетов становится доступна оплата без комиссии', type: 'textarea', hint: 'Можно написать {n} — подставится число из настройки выше' },
  { key: 'bulkButton', label: 'Оплата без комиссии: текст кнопки', def: 'ЗАПРОСИТЬ РЕКВИЗИТЫ', type: 'text', hint: '' },
  { key: 'bulkUrl', label: 'Оплата без комиссии: ссылка кнопки', def: 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all', type: 'text', hint: 'Куда ведёт кнопка (например, сообщения сообщества). Пусто — кнопка скрыта' },
  { key: 'missLimit', label: 'Пропусков подряд до обнуления баланса', def: '3', type: 'number', hint: 'На этом пропуске накопительный баланс обнуляется (если он не заморожен)' },
  { key: 'exchangeRate', label: 'Курс обмена: рублей скидки за 1 номерок', def: '200', type: 'number', hint: '1 номерок = 200 ₽ по умолчанию' },
  { key: 'exchangeMin', label: 'Обмен на скидку: от скольки номерков', def: '30', type: 'number', hint: 'С этого баланса игроку показывается кнопка обмена' },
  { key: 'exchangeButton', label: 'Обмен на скидку: текст кнопки', def: 'ОБМЕНЯТЬ НА СКИДКУ', type: 'text', hint: '' },
  { key: 'exchangeUrl', label: 'Обмен на скидку: ссылка кнопки', def: 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all', type: 'text', hint: 'Куда ведёт кнопка (переписка ВК с администратором). Пусто — кнопка скрыта' },
  { key: 'balanceMode', label: 'Как показывать балансы публично', def: 'точный', type: 'select', options: ['точный', 'ступени', 'скрыт'], hint: 'точный — число; ступени — «10+», «30+»; скрыт — баланс не показывается (пропуски видны)' },
  { key: 'soldOutEnabled', label: 'Надпись «все места забронированы»: показывать', def: 'ДА', type: 'yesno', hint: 'Появляется поверх сетки, когда свободных номерков нет и все брони подтверждены' },
  { key: 'soldOutText', label: 'Надпись «все места забронированы»: текст', def: 'Все места забронированы. Прямой эфир проведем {date}', type: 'textarea', hint: '{date} — подставится «Дата и время эфира» (например: в 15:00 28.10.2026), {number} — номер эфира. Первое предложение выводится крупно' },
  { key: 'waitText', label: 'Надпись «идёт подтверждение»: текст', def: '', type: 'textarea', hint: 'Необязательно. Показывается над сеткой, когда свободных нет, но часть броней ещё не подтверждена. Пусто — не показывать' },
  { key: 'paymentInfo', label: 'Реквизиты и инструкция по оплате', def: '', type: 'textarea', hint: 'Необязательно: дополнительный текст (например, реквизиты для перевода без ссылки)' },
  { key: 'nameFormat', label: 'Формат имени в списке', def: 'имя и инициал', type: 'select', options: ['полное имя', 'имя и инициал', 'только имя'], hint: '' },
  { key: 'showPending', label: 'Показывать неподтверждённые брони в списке', def: 'ДА', type: 'yesno', hint: '' },
  { key: 'notifyEmail', label: 'E-mail для уведомлений', def: '', type: 'text', hint: 'Сюда придут письма о новых бронях и заявленной оплате' },
  { key: 'adminUrl', label: 'Ссылка на админку (для писем)', def: '', type: 'text', hint: '' }
];

// ───────────────────────── Таблица ─────────────────────────

function ss_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Таблица не найдена. Откройте скрипт из таблицы (Расширения → Apps Script) и запустите init().');
  props.setProperty('SS_ID', active.getId());
  return active;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Нет листа «' + name + '». Запустите init().');
  return sh;
}

/** Создаёт листы и заполняет настройки. Безопасно запускать повторно. */
function init() {
  var ss = ss_();
  var st = ss.getSheetByName(SHEET_SETTINGS) || ss.insertSheet(SHEET_SETTINGS);
  var bk = ss.getSheetByName(SHEET_BOOKINGS) || ss.insertSheet(SHEET_BOOKINGS);
  var lg = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG);

  // Настройки
  if (st.getLastRow() < 1) st.getRange(1, 1, 1, 3).setValues([['Параметр', 'Значение', 'Подсказка']]);
  st.getRange('B:B').setNumberFormat('@');
  var existing = {};
  var last = st.getLastRow();
  if (last >= 2) st.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { existing[String(r[0]).trim()] = true; });
  SETTINGS_SCHEMA.forEach(function (s) {
    if (!existing[s.label]) st.appendRow([s.label, s.def, s.hint]);
  });
  st.setFrozenRows(1);
  st.setColumnWidth(1, 330); st.setColumnWidth(2, 260); st.setColumnWidth(3, 420);
  st.getRange(1, 1, 1, 3).setFontWeight('bold');

  // Брони
  if (bk.getMaxColumns() < BOOKING_HEADERS.length) bk.insertColumnsAfter(bk.getMaxColumns(), BOOKING_HEADERS.length - bk.getMaxColumns());
  bk.getRange(1, 1, 1, BOOKING_HEADERS.length).setValues([BOOKING_HEADERS]);
  bk.getRange('E:E').setNumberFormat('@');
  bk.getRange('B:B').setNumberFormat('dd.mm.yyyy HH:mm');
  bk.getRange('H:H').setNumberFormat('dd.mm.yyyy HH:mm');
  bk.getRange('N:N').setNumberFormat('dd.mm.yyyy HH:mm');
  bk.setFrozenRows(1);
  bk.getRange(1, 1, 1, BOOKING_HEADERS.length).setFontWeight('bold');
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([ST.PENDING, ST.PAID, ST.OK, ST.EXPIRED, ST.CANCELLED, ST.BLOCK], true).build();
  bk.getRange('G2:G2000').setDataValidation(rule);
  var colors = [[ST.OK, '#d9f2e3'], [ST.PAID, '#fff0c2'], [ST.PENDING, '#ffe3cf'], [ST.EXPIRED, '#eeeeee'], [ST.CANCELLED, '#eeeeee'], [ST.BLOCK, '#d9d4ee']];
  var rules = colors.map(function (c) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c[0]).setBackground(c[1])
      .setRanges([bk.getRange('G2:G2000')]).build();
  });
  bk.setConditionalFormatRules(rules);

  // Журнал
  if (lg.getLastRow() < 1) lg.getRange(1, 1, 1, 4).setValues([['Время', 'Кто', 'Действие', 'Подробности']]);
  lg.setFrozenRows(1);
  lg.getRange('A:A').setNumberFormat('dd.mm.yyyy HH:mm:ss');

  initPlayerSheets_();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  return 'Готово: листы созданы.';
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Номерок')
      .addItem('1. Создать листы / обновить настройки', 'init')
      .addItem('2. Включить таймер (каждые 5 минут)', 'installTrigger')
      .addItem('3. Проверить настройки', 'selfCheck')
      .addToUi();
  } catch (e) { /* нет интерфейса */ }
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  return 'Таймер включён.';
}

function selfCheck() {
  var props = PropertiesService.getScriptProperties();
  var out = [];
  var pass = props.getProperty('ADMIN_PASSWORD');
  out.push(!pass ? '✗ ADMIN_PASSWORD не задан' : (pass.length < 12 ? '△ ADMIN_PASSWORD короче 12 символов' : '✓ ADMIN_PASSWORD задан'));
  out.push(props.getProperty('VK_TOKEN') ? '✓ VK_TOKEN задан (имя берётся из профиля)' : '△ VK_TOKEN не задан — имя участники будут вводить вручную');
  try { sheet_(SHEET_SETTINGS); sheet_(SHEET_BOOKINGS); sheet_(SHEET_LOG); out.push('✓ Листы на месте'); } catch (e) { out.push('✗ ' + e.message); }
  var s = readSettings_();
  out.push(s.notifyEmail ? '✓ E-mail для уведомлений: ' + s.notifyEmail : '△ E-mail для уведомлений не указан');
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; });
  out.push(hasTrigger ? '✓ Таймер (tick) включён' : '✗ Таймер не включён — пункт меню «Включить таймер»');
  settingsWarnings_().forEach(function (w) { out.push('△ ' + w); });
  var text = out.join('\n');
  try { SpreadsheetApp.getUi().alert(text); } catch (e) { Logger.log(text); }
  return text;
}

// ───────────────────────── Настройки ─────────────────────────

function schemaByKey_(key) {
  for (var i = 0; i < SETTINGS_SCHEMA.length; i++) if (SETTINGS_SCHEMA[i].key === key) return SETTINGS_SCHEMA[i];
  return null;
}

function yes_(v) {
  if (v === true) return true;
  return ['да', 'yes', 'true', '1', 'y', 'вкл'].indexOf(String(v).trim().toLowerCase()) >= 0;
}

function rawSettings_() {
  var raw = {};
  SETTINGS_SCHEMA.forEach(function (s) { raw[s.key] = s.def; });
  var sh = ss_().getSheetByName(SHEET_SETTINGS);
  if (!sh || sh.getLastRow() < 2) return raw;
  var byLabel = {};
  SETTINGS_SCHEMA.forEach(function (s) { byLabel[s.label] = s.key; });
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
    var k = byLabel[String(r[0]).trim()];
    if (k) raw[k] = (r[1] === null || r[1] === undefined) ? '' : r[1];
  });
  return raw;
}

function num_(v, def, min, max) {
  var n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || String(v).trim() === '') n = def;
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

function readSettings_() {
  var r = rawSettings_();
  var from = parseHM_(r.quietFrom), to = parseHM_(r.quietTo);
  var fmt = String(r.nameFormat).trim().toLowerCase();
  if (['полное имя', 'имя и инициал', 'только имя'].indexOf(fmt) < 0) fmt = 'имя и инициал';
  return {
    eventNumber: String(r.eventNumber).trim(),
    eventTitle: String(r.eventTitle).trim(),
    eventDate: String(r.eventDate).trim(),
    ticketCount: Math.floor(num_(r.ticketCount, 63, 1, 500)),
    priceText: String(r.priceText).trim(),
    confirmHours: num_(r.confirmHours, 6, 0.1, 168),
    maxPending: Math.floor(num_(r.maxPending, 5, 1, 500)),
    maxConfirmed: Math.floor(num_(r.maxConfirmed, 0, 0, 500)),
    quietEnabled: yes_(r.quietEnabled) && from !== null && to !== null && from !== to,
    quietFrom: from === null ? 0 : from,
    quietTo: to === null ? 0 : to,
    utcOffset: num_(r.utcOffset, 3, -12, 14),
    bookingOpen: yes_(r.bookingOpen),
    paused: yes_(r.paused),
    pauseMessage: String(r.pauseMessage).trim(),
    payUrl: safeUrl_(r.payUrl),
    postUrl: safeUrl_(r.postUrl),
    bulkMin: Math.floor(num_(r.bulkMin, 4, 0, 500)),
    bulkText: String(r.bulkText == null ? '' : r.bulkText).trim(),
    bulkButton: String(r.bulkButton == null ? '' : r.bulkButton).trim(),
    bulkUrl: safeUrl_(r.bulkUrl),
    missLimit: Math.floor(num_(r.missLimit, 3, 1, 50)),
    exchangeRate: num_(r.exchangeRate, 200, 0, 1000000),
    exchangeMin: Math.floor(num_(r.exchangeMin, 30, 0, 100000)),
    exchangeButton: String(r.exchangeButton == null ? '' : r.exchangeButton).trim(),
    exchangeUrl: safeUrl_(r.exchangeUrl),
    balanceMode: ['точный', 'ступени', 'скрыт'].indexOf(String(r.balanceMode).trim().toLowerCase()) >= 0 ? String(r.balanceMode).trim().toLowerCase() : 'точный',
    soldOutEnabled: yes_(r.soldOutEnabled),
    soldOutText: String(r.soldOutText == null ? '' : r.soldOutText).trim(),
    waitText: String(r.waitText == null ? '' : r.waitText).trim(),
    paymentInfo: String(r.paymentInfo).trim() === 'Укажите здесь реквизиты для доната.' ? '' : String(r.paymentInfo).trim(),
    nameFormat: fmt,
    showPending: yes_(r.showPending),
    notifyEmail: String(r.notifyEmail).trim(),
    adminUrl: String(r.adminUrl).trim()
  };
}

/** Только http(s)-ссылки без пробелов и кавычек; всё остальное — пустая строка. */
function safeUrl_(v) {
  var u = String(v == null ? '' : v).trim();
  return /^https?:\/\/[^\s<>"']{3,400}$/i.test(u) ? u : '';
}

/**
 * Настройки, значение которых не распознано. Раньше такие значения молча заменялись умолчаниями
 * (например, тихие часы тихо выключались) — теперь админка показывает предупреждение.
 */
function settingsWarnings_() {
  var raw = rawSettings_(), out = [];
  var YES = ['да', 'yes', 'true', '1', 'y', 'вкл'], NO = ['нет', 'no', 'false', '0', 'n', 'выкл', ''];
  SETTINGS_SCHEMA.forEach(function (d) {
    var v = String(raw[d.key] == null ? '' : raw[d.key]).trim();
    if (d.type === 'time' && parseHM_(v) === null) {
      if (yes_(raw.quietEnabled)) out.push('«' + d.label + '»: значение «' + v + '» не распознано — тихие часы сейчас выключены, таймер идёт круглосуточно. Нужен формат ЧЧ:ММ, например 09:00.');
    } else if (d.type === 'number' && v !== '' && !isFinite(Number(v.replace(',', '.')))) {
      out.push('«' + d.label + '»: значение «' + v + '» не число — используется значение по умолчанию (' + d.def + ').');
    } else if (d.type === 'yesno' && YES.indexOf(v.toLowerCase()) < 0 && NO.indexOf(v.toLowerCase()) < 0) {
      out.push('«' + d.label + '»: значение «' + v + '» не распознано (нужно ДА или НЕТ) — считается «НЕТ».');
    } else if (d.type === 'select' && d.options.indexOf(v.toLowerCase()) < 0 && v !== '') {
      out.push('«' + d.label + '»: значение «' + v + '» не из списка (' + d.options.join(' / ') + ').');
    }
  });
  if (yes_(raw.quietEnabled) && parseHM_(raw.quietFrom) !== null && parseHM_(raw.quietFrom) === parseHM_(raw.quietTo)) {
    out.push('Тихие часы: начало и конец совпадают — окно пустое, таймер идёт круглосуточно.');
  }
  return out;
}

function qCfg_(s) {
  return { enabled: s.quietEnabled, fromMin: s.quietFrom, toMin: s.quietTo, offsetMin: Math.round(s.utcOffset * 60) };
}

function hmStr_(min) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(Math.floor(min / 60)) + ':' + p(min % 60);
}

function writeSetting_(key, value) {
  var def = schemaByKey_(key);
  var sh = sheet_(SHEET_SETTINGS);
  var last = sh.getLastRow();
  var labels = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < labels.length; i++) {
    if (String(labels[i][0]).trim() === def.label) {
      sh.getRange(i + 2, 2).setValue(String(value));
      return;
    }
  }
  sh.appendRow([def.label, String(value), def.hint]);
}

/** Проверяет и приводит значение настройки к виду для записи. Возвращает {value} или {error}. */
function coerceSetting_(def, v) {
  var t = def.type, n;
  if (t === 'yesno') return { value: yes_(v) ? 'ДА' : 'НЕТ' };
  if (t === 'time') {
    var m = parseHM_(v);
    if (m === null) return { error: '«' + def.label + '»: время в формате ЧЧ:ММ' };
    return { value: hmStr_(m) };
  }
  if (t === 'select') {
    var sv = String(v).trim().toLowerCase();
    if (def.options.indexOf(sv) < 0) return { error: '«' + def.label + '»: допустимо ' + def.options.join(' / ') };
    return { value: sv };
  }
  if (t === 'number') {
    n = Number(String(v).replace(',', '.'));
    if (!isFinite(n) || String(v).trim() === '') return { error: '«' + def.label + '»: нужно число' };
    var lim = { ticketCount: [1, 500], confirmHours: [0.1, 168], maxPending: [1, 500], maxConfirmed: [0, 500], bulkMin: [0, 500], missLimit: [1, 50], exchangeRate: [0, 1000000], exchangeMin: [0, 100000], utcOffset: [-12, 14] }[def.key] || [0, 100000];
    if (n < lim[0] || n > lim[1]) return { error: '«' + def.label + '»: от ' + lim[0] + ' до ' + lim[1] };
    if (['ticketCount', 'maxPending', 'maxConfirmed', 'bulkMin', 'missLimit', 'exchangeMin'].indexOf(def.key) >= 0) n = Math.floor(n);
    return { value: String(n) };
  }
  if (def.key === 'payUrl' || def.key === 'postUrl' || def.key === 'bulkUrl' || def.key === 'exchangeUrl') {
    var url = String(v == null ? '' : v).trim();
    if (url && !safeUrl_(url)) return { error: '«' + def.label + '»: нужна ссылка вида https://…' };
    return { value: url };
  }
  return { value: String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 2000) };
}

// ───────────────────────── Брони ─────────────────────────

function toMs_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') { var t = v.getTime(); return isFinite(t) ? t : null; }
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var p = Date.parse(String(v));
  return isFinite(p) ? p : null;
}

function parseNums_(v) {
  if (typeof v === 'number') return isFinite(v) && v % 1 === 0 ? [v] : [];
  var out = [];
  String(v == null ? '' : v).split(/[^0-9]+/).forEach(function (x) { if (x) out.push(Number(x)); });
  return out;
}

function rowToBooking_(r, rowNum) {
  return {
    row: rowNum,
    code: String(r[C.CODE]).trim(),
    created: toMs_(r[C.CREATED]),
    name: String(r[C.NAME]),
    vkUrl: String(r[C.VKURL]),
    numbers: parseNums_(r[C.NUMS]),
    count: Number(r[C.COUNT]) || 0,
    status: String(r[C.STATUS]).trim(),
    deadline: toMs_(r[C.DEADLINE]),
    leftMin: (r[C.LEFT] === '' || r[C.LEFT] === null || r[C.LEFT] === undefined) ? null : Number(r[C.LEFT]),
    source: String(r[C.SOURCE]),
    note: String(r[C.NOTE]),
    vkKey: String(r[C.VKKEY]),
    client: String(r[C.CLIENT]),
    updated: toMs_(r[C.UPDATED]),
    reminded: r[C.REMINDED] === true || String(r[C.REMINDED]) === '1',
    photo: String(r[C.PHOTO] || ''),
    event: String(r[C.EVENT] || '')
  };
}

function bookingToRow_(b) {
  function d(ms) { return ms ? new Date(ms) : ''; }
  return [b.code, d(b.created), b.name, b.vkUrl, b.numbers.join(', '), b.numbers.length, b.status, d(b.deadline),
    b.leftMin === null || b.leftMin === undefined ? '' : Math.round(b.leftMin * 10) / 10,
    b.source || '', b.note || '', b.vkKey || '', b.client || '', d(b.updated), b.reminded ? '1' : '', b.photo || '', b.event || ''];
}

function readBookings_() {
  var sh = sheet_(SHEET_BOOKINGS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var out = [];
  sh.getRange(2, 1, last - 1, BOOKING_HEADERS.length).getValues().forEach(function (r, i) {
    if (String(r[C.CODE]).trim() === '') return;
    out.push(rowToBooking_(r, i + 2));
  });
  return out;
}

function appendBooking_(b) {
  var sh = sheet_(SHEET_BOOKINGS);
  sh.appendRow(bookingToRow_(b));
  SpreadsheetApp.flush();
  b.row = sh.getLastRow();
  // Проверка: строка действительно записана (иначе участнику показали бы бронь, которой нет в таблице)
  if (String(sh.getRange(b.row, C.CODE + 1).getValue()).trim() !== b.code) {
    throw new Error('Бронь ' + b.code + ' не записалась в таблицу');
  }
  return b;
}

function saveBooking_(b) {
  b.updated = Date.now();
  sheet_(SHEET_BOOKINGS).getRange(b.row, 1, 1, BOOKING_HEADERS.length).setValues([bookingToRow_(b)]);
}

function busyMap_(bookings) {
  var map = {};
  bookings.forEach(function (b) {
    if (HOLDING.indexOf(b.status) < 0) return;
    b.numbers.forEach(function (n) { map[n] = b; });
  });
  return map;
}

function newCode_(bookings, prefix) {
  var used = {};
  bookings.forEach(function (b) { used[b.code] = true; });
  for (var i = 0; i < 200; i++) {
    var code = (prefix || 'Б-') + String(1000 + Math.floor(Math.random() * 9000));
    if (!used[code]) return code;
  }
  return (prefix || 'Б-') + String(Date.now()).slice(-6);
}

function cleanNumbers_(arr, max) {
  var seen = {}, out = [];
  (Object.prototype.toString.call(arr) === '[object Array]' ? arr : []).forEach(function (v) {
    var n = Number(v);
    if (isFinite(n) && n % 1 === 0 && n >= 1 && n <= max && !seen[n]) { seen[n] = true; out.push(n); }
  });
  return out.sort(function (a, b) { return a - b; }).slice(0, 100);
}

function cleanName_(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanClient_(v) {
  var s = String(v == null ? '' : v);
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : '';
}

function fmtName_(full, fmt) {
  var parts = String(full || '').trim().split(/\s+/).filter(function (x) { return x; });
  if (!parts.length) return 'Участник';
  if (fmt === 'полное имя' || parts.length === 1) return parts.join(' ');
  if (fmt === 'только имя') return parts[0];
  return parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.';
}

function cmpName_(a, b) {
  var x = a.toLowerCase().replace(/ё/g, 'е'), y = b.toLowerCase().replace(/ё/g, 'е');
  return x < y ? -1 : (x > y ? 1 : 0);
}

// ───────────────────────── Служебное ─────────────────────────

function err_(code, message, extra) {
  var e = { code: code, message: message };
  if (extra) for (var k in extra) e[k] = extra[k];
  return { ok: false, error: e };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally {
    // Записи в таблицу должны попасть на диск ДО снятия блокировки, иначе следующий запрос может прочитать старые данные
    try { SpreadsheetApp.flush(); } catch (e) { /* ignore */ }
    lock.releaseLock();
  }
}

function invalidate_() {
  try { var c = CacheService.getScriptCache(); c.remove('state'); c.remove('balances'); c.remove('playerlist'); } catch (e) { /* ignore */ }
}

function rateLimit_(key, max, seconds) {
  var cache = CacheService.getScriptCache();
  var k = 'rl:' + key;
  var n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), seconds);
  return n <= max;
}

function log_(who, action, details) {
  try { sheet_(SHEET_LOG).appendRow([new Date(Date.now()), who, action, String(details || '').slice(0, 500)]); } catch (e) { /* ignore */ }
}

function trimLog_() {
  var sh = sheet_(SHEET_LOG);
  if (sh.getLastRow() > 5000) sh.deleteRows(2, 1000);
}

// ───────────────────────── Уведомления ─────────────────────────

function queueNotify_(text) {
  var props = PropertiesService.getScriptProperties();
  var q = [];
  try { q = JSON.parse(props.getProperty('NOTIFY_QUEUE') || '[]'); } catch (e) { q = []; }
  q.push(text);
  if (q.length > 50) q = q.slice(-50);
  props.setProperty('NOTIFY_QUEUE', JSON.stringify(q));
  flushNotify_();
}

/** Отправляет накопленные события одним письмом, не чаще раза в 2 минуты. */
function flushNotify_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var q = JSON.parse(props.getProperty('NOTIFY_QUEUE') || '[]');
    if (!q.length) return;
    var s = readSettings_();
    if (!s.notifyEmail) { props.deleteProperty('NOTIFY_QUEUE'); return; }
    var last = Number(props.getProperty('NOTIFY_LAST') || 0);
    if (Date.now() - last < 120000) return;
    var subject = 'Номерок: ' + (q.length === 1 ? q[0].slice(0, 70) : q.length + ' новых событий');
    var body = q.join('\n') + (s.adminUrl ? '\n\nАдминка: ' + s.adminUrl : '');
    MailApp.sendEmail(s.notifyEmail, subject, body);
    props.setProperty('NOTIFY_LAST', String(Date.now()));
    props.deleteProperty('NOTIFY_QUEUE');
  } catch (e) {
    log_('система', 'ошибка письма', e.message);
  }
}

// ───────────────────────── Пауза и истечение ─────────────────────────

/** Истекает ожидающие брони. Вызывать под блокировкой. */
function expireStaleLocked_(s, force) {
  if (s.paused && !force) return 0;
  var now = Date.now(), n = 0;
  // Тихие часы: ночью брони не сгорают, что бы ни было с дедлайном. Всё, что «просрочилось» за ночь, истечёт после её окончания.
  if (isQuietAt(now, qCfg_(s))) return 0;
  readBookings_().forEach(function (b) {
    if (UNCONFIRMED.indexOf(b.status) >= 0 && b.deadline && b.deadline <= now) {
      b.status = ST.EXPIRED;
      saveBooking_(b);
      log_('система', 'истекла', b.code + ' ' + b.name + ' №' + b.numbers.join(','));
      n++;
    }
  });
  if (n) invalidate_();
  return n;
}

/** Приводит таймеры в соответствие с настройкой «Технический перерыв». Вызывать под блокировкой. */
function syncPauseLocked_(s) {
  var props = PropertiesService.getScriptProperties();
  var applied = props.getProperty('PAUSE_APPLIED') === '1';
  if (s.paused === applied) return false;
  var now = Date.now(), q = qCfg_(s);
  if (s.paused) {
    expireStaleLocked_(s, true);
    readBookings_().forEach(function (b) {
      if (UNCONFIRMED.indexOf(b.status) >= 0 && b.deadline) {
        b.leftMin = activeMinutesBetween(now, b.deadline, q);
        b.deadline = null;
        saveBooking_(b);
      }
    });
    log_('система', 'перерыв начат', 'таймеры остановлены');
  } else {
    readBookings_().forEach(function (b) {
      if (UNCONFIRMED.indexOf(b.status) >= 0 && b.leftMin !== null) {
        b.deadline = addActiveMinutes(now, b.leftMin, q);
        b.leftMin = null;
        saveBooking_(b);
      }
    });
    log_('система', 'перерыв окончен', 'таймеры продолжены');
  }
  props.setProperty('PAUSE_APPLIED', s.paused ? '1' : '0');
  invalidate_();
  return true;
}

/** Ставит таймер брони: при перерыве запоминает остаток, иначе считает дедлайн. */
function armTimer_(b, s, minutes) {
  if (s.paused) { b.leftMin = minutes; b.deadline = null; }
  else { b.deadline = addActiveMinutes(Date.now(), minutes, qCfg_(s)); b.leftMin = null; }
}

/** Подготовка перед любой операцией: синхронизация паузы + истечение. Под блокировкой. */
function prepareLocked_() {
  var s = readSettings_();
  syncPauseLocked_(s);
  expireStaleLocked_(s, false);
  return s;
}

/** Срабатывает по таймеру раз в 5 минут. */
function tick() {
  withLock_(function () {
    var s = prepareLocked_();
    if (!s.paused) {
      readBookings_().forEach(function (b) {
        if (b.status === ST.PAID && !b.reminded && b.deadline && b.deadline - Date.now() < 30 * 60000) {
          queueNotify_('⏰ Скоро истекает (оплата заявлена): ' + b.code + ' ' + b.name + ' №' + b.numbers.join(', ') +
            ' — до ' + fmtLocal_(b.deadline, Math.round(s.utcOffset * 60)));
          b.reminded = true;
          saveBooking_(b);
        }
      });
    }
    trimLog_();
  });
  flushNotify_();
}

// ───────────────────────── Представления ─────────────────────────

function buildTickets_(s, bookings, admin) {
  var busy = busyMap_(bookings);
  var tickets = [];
  for (var n = 1; n <= s.ticketCount; n++) {
    var b = busy[n];
    var code = !b ? 'f' : b.status === ST.BLOCK ? 'b' : b.status === ST.OK ? 't' : (admin && b.status === ST.PAID ? 'a' : 'p');
    tickets.push(admin ? { n: n, s: code, code: b ? b.code : '' } : code);
  }
  return tickets;
}

function publicState_(s, bookings) {
  var groups = {}, pmap = {};
  readPlayers_().forEach(function (p) { pmap[p.key] = p; });
  bookings.forEach(function (b) {
    var visible = b.status === ST.OK || (s.showPending && (b.status === ST.PENDING || b.status === ST.PAID));
    if (!visible) return;
    var key = b.vkKey || b.code;
    var g = groups[key];
    if (!g) {
      g = groups[key] = { name: fmtName_(b.name, s.nameFormat), photo: '', items: [], bal: null, miss: 0, frozen: false, ex: false };
      if (b.vkKey && pmap[b.vkKey]) {
        var pub = playerPublic_(pmap[b.vkKey], s);
        g.bal = pub.bal; g.miss = pub.miss; g.frozen = pub.frozen; g.ex = pub.ex;
      }
    }
    if (!g.photo && b.photo) g.photo = b.photo;
    b.numbers.forEach(function (n) { g.items.push([n, b.status === ST.OK ? 1 : 0]); });
  });
  var players = Object.keys(groups).map(function (k) {
    groups[k].items.sort(function (a, b) { return a[0] - b[0]; });
    return groups[k];
  }).sort(function (a, b) { return cmpName_(a.name, b.name); });

  var tickets = buildTickets_(s, bookings, false);
  var free = tickets.filter(function (t) { return t === 'f'; }).length;
  return {
    ok: true,
    version: SERVER_VERSION,
    now: Date.now(),
    rules: rulesInfo_(s),
    event: { number: s.eventNumber, title: s.eventTitle, date: s.eventDate },
    price: s.priceText,
    ticketCount: s.ticketCount,
    confirmHours: s.confirmHours,
    limits: { pending: s.maxPending, total: s.maxConfirmed },
    quiet: quietInfo_(s, Date.now()),
    tzOffsetMin: Math.round(s.utcOffset * 60),
    open: s.bookingOpen,
    paused: s.paused,
    pauseMessage: s.pauseMessage,
    info: payInfo_(s),
    tickets: tickets,
    overlay: overlayInfo_(s, tickets),
    players: players,
    counts: { free: free, total: s.ticketCount }
  };
}

/** Блок «оплата без комиссии»: показывается, когда в брони не меньше bulk.min номерков. null — отключён. */
function bulkInfo_(s) {
  if (s.bulkMin < 1 || !s.bulkUrl) return null;
  return {
    min: s.bulkMin,
    text: s.bulkText.replace(/\{n\}/g, String(s.bulkMin)),
    button: s.bulkButton || 'Запросить реквизиты',
    url: s.bulkUrl
  };
}

function fillTemplate_(t, s) {
  return String(t).replace(/\{date\}/g, s.eventDate).replace(/\{number\}/g, s.eventNumber)
    .replace(/[ \t]+(\r?\n|$)/g, '$1').replace(/ {2,}/g, ' ').trim();
}

/** Надпись поверх сетки: «все места забронированы» (всё подтверждено) или «идёт подтверждение». */
function overlayInfo_(s, tickets) {
  var free = 0, pend = 0, taken = 0;
  tickets.forEach(function (t) { if (t === 'f') free++; else if (t === 'p') pend++; else if (t === 't') taken++; });
  if (free === 0 && pend === 0 && taken > 0 && s.soldOutEnabled && s.soldOutText) {
    return { kind: 'soldout', text: fillTemplate_(s.soldOutText, s) };
  }
  if (free === 0 && pend > 0 && s.waitText) return { kind: 'waiting', text: fillTemplate_(s.waitText, s) };
  return null;
}

function payInfo_(s) {
  return { payUrl: s.payUrl, postUrl: s.postUrl, payment: s.paymentInfo, bulk: bulkInfo_(s) };
}

/** Тихие часы для экрана: идут ли сейчас, когда закончатся / начнутся. */
function quietInfo_(s, now) {
  var q = qCfg_(s), on = qOn_(q);
  return {
    on: on, from: hmStr_(s.quietFrom), to: hmStr_(s.quietTo),
    nowQuiet: on && isQuietAt(now, q), resumeAt: on ? quietEndsAt(now, q) : null, nextStart: on ? nextQuietStartAt(now, q) : null
  };
}

/** Сколько минут АКТИВНОГО времени осталось у брони (ночью таймер стоит). */
function activeLeft_(b, s, now) {
  if (b.deadline) return Math.round(activeMinutesBetween(now, b.deadline, qCfg_(s)) * 10) / 10;
  return b.leftMin === null || b.leftMin === undefined ? null : b.leftMin;
}

function publicBooking_(b, s) {
  return {
    code: b.code, numbers: b.numbers, count: b.numbers.length, status: b.status,
    deadline: b.deadline, leftMin: b.leftMin, activeLeftMin: activeLeft_(b, s, Date.now()),
    name: fmtName_(b.name, s.nameFormat), created: b.created
  };
}

function adminBooking_(b, s) {
  return {
    code: b.code, created: b.created, name: b.name, vkUrl: b.vkUrl, numbers: b.numbers, count: b.numbers.length,
    status: b.status, deadline: b.deadline, leftMin: b.leftMin, activeLeftMin: activeLeft_(b, s, Date.now()),
    source: b.source, note: b.note, photo: b.photo, key: b.vkKey
  };
}

// ───────────────────────── VK ─────────────────────────

function parseVkLink_(raw) {
  var s = String(raw == null ? '' : raw).trim().replace(/^@/, '');
  if (!s) return { ok: false, message: 'Укажите ссылку на ваш профиль ВКонтакте' };
  var m = s.match(/^(?:https?:\/\/)?(?:(?:www|m|new)\.)?(?:vk\.com|vk\.ru|vkontakte\.ru)\/([^?#\s]+)(?:\?([^#\s]*))?/i);
  var slug, query = '';
  if (m) { slug = m[1]; query = m[2] || ''; }
  else if (/^[A-Za-z0-9_.]{2,64}$/.test(s)) { slug = s; }
  else return { ok: false, message: 'Это не похоже на ссылку ВКонтакте. Пример: vk.com/id12345' };
  try { slug = decodeURIComponent(slug); } catch (e) { /* оставляем как есть */ }
  slug = slug.replace(/\/+$/, '').split('/')[0];
  if (slug === 'profile.php') {
    var idm = query.match(/(?:^|&)id=(\d+)/);
    if (!idm) return { ok: false, message: 'Не удалось разобрать ссылку на профиль' };
    slug = 'id' + idm[1];
  }
  if (/^(club|public|event|group)\d+$/i.test(slug)) return { ok: false, message: 'Нужна ссылка на личную страницу, а не на сообщество' };
  if (!/^[A-Za-z0-9_.]{2,64}$/.test(slug)) return { ok: false, message: 'Не удалось разобрать ссылку на профиль' };
  var numeric = slug.match(/^id(\d+)$/i);
  return {
    ok: true, slug: slug, numericId: numeric ? numeric[1] : '',
    key: numeric ? numeric[1] : slug.toLowerCase(),
    url: 'https://vk.com/' + slug
  };
}

var VK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var VK_PHOTO_HOSTS = /^https:\/\/[a-z0-9.-]+\.(userapi\.com|vk\.com|vk\.ru|vk\.me|vk-cdn\.net|vkuser\.net|vkuserphoto\.ru)\//i;
var VK_BAD_TITLES = /^(вконтакте|vk|вход|vk login|login|ошибка|error|404|страница удалена.*|страница не найдена.*)$/i;

/** Принимаем только картинки с серверов ВК (https), без служебных заглушек «нет фото». */
function cleanPhoto_(u) {
  var url = String(u == null ? '' : u).trim();
  if (url.length > 500 || /[\s<>"']/.test(url) || !VK_PHOTO_HOSTS.test(url)) return '';
  if (/camera_|deactivated_|community_|\/images\//i.test(url)) return '';
  return url;
}

function cp_(n) { return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : ''; }

function decodeEntities_(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function (m, x) { return cp_(parseInt(x, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return cp_(Number(d)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** Значение <meta property="…" content="…"> независимо от порядка атрибутов и вида кавычек. */
function metaContent_(html, prop) {
  var tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    var pm = tags[i].match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    if (pm && pm[1].toLowerCase() === prop) {
      var cm = tags[i].match(/content\s*=\s*"([^"]*)"/i) || tags[i].match(/content\s*=\s*'([^']*)'/i);
      return cm ? decodeEntities_(cm[1]) : '';
    }
  }
  return '';
}

/** Имя и фото из HTML страницы ВК (og:title / og:image, запасной вариант — <title>). */
function parseVkHtml_(html) {
  var text = String(html || '');
  var name = metaContent_(text, 'og:title');
  if (!name) {
    var tm = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) name = decodeEntities_(tm[1]);
  }
  name = cleanName_(String(name).split(/\s+[|•—–]\s+/)[0]);
  if (name.length < 2 || VK_BAD_TITLES.test(name)) return { ok: false };
  return { ok: true, name: name, photo: cleanPhoto_(metaContent_(text, 'og:image')) };
}

function fetchVkPage_(url) {
  var resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': VK_UA, 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5', 'Accept': 'text/html,application/xhtml+xml' }
  });
  var status = resp.getResponseCode();
  if (status !== 200) return { status: status, text: '', charset: '' };
  var ct = '', hdrs = resp.getHeaders() || {};
  for (var k in hdrs) if (String(k).toLowerCase() === 'content-type') ct = String(hdrs[k]);
  var charset = /1251/i.test(ct) ? 'windows-1251' : 'UTF-8';
  var text = resp.getContentText(charset);
  if (charset === 'UTF-8' && /<meta[^>]+charset\s*=\s*["']?windows-1251/i.test(text.slice(0, 4000))) {
    charset = 'windows-1251';
    text = resp.getContentText(charset);
  }
  return { status: status, text: text, charset: charset };
}

/** Без токена: читаем открытую страницу профиля (vk.com, затем m.vk.com). */
function lookupVkHtml_(p) {
  var urls = ['https://vk.com/' + p.slug, 'https://m.vk.com/' + p.slug];
  for (var i = 0; i < urls.length; i++) {
    try {
      var r = fetchVkPage_(urls[i]);
      if (r.status !== 200) continue;
      var parsed = parseVkHtml_(r.text);
      if (parsed.ok) return { ok: true, name: parsed.name, photo: parsed.photo, id: '', src: 'html' };
    } catch (e) { /* пробуем следующий адрес */ }
  }
  // «Не найден» по странице не утверждаем: ВК мог просто не отдать страницу серверу Google.
  return { ok: false, reason: 'unavailable' };
}

/** С токеном: официальный API — надёжнее всего. */
function lookupVkApi_(p, token) {
  try {
    var url = 'https://api.vk.com/method/users.get?user_ids=' + encodeURIComponent(p.numericId || p.slug) +
      '&fields=photo_200&v=5.199&access_token=' + encodeURIComponent(token);
    var data = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    if (data.error) return { ok: false, reason: 'vk_error' };
    var u = data.response && data.response[0];
    if (!u) return { ok: false, reason: 'not_found' };
    return { ok: true, id: u.id, name: cleanName_((u.first_name || '') + ' ' + (u.last_name || '')), photo: cleanPhoto_(u.photo_200), src: 'api' };
  } catch (e) {
    return { ok: false, reason: 'exception' };
  }
}

/** Имя и фото профиля: токен (если есть) → страница ВК → ручной ввод. Удачные ответы кэшируются на 6 часов. */
function lookupVk_(p, fresh) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('vk:' + p.key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* ignore */ } }
  if (!fresh && cache.get('vkf:' + p.key)) return { ok: false, reason: 'unavailable' };   // админ (fresh) повторяет запрос, не дожидаясь 5 минут
  var token = PropertiesService.getScriptProperties().getProperty('VK_TOKEN');
  var res = { ok: false, reason: 'unavailable' };
  if (token) {
    res = lookupVkApi_(p, token);
    if (res.reason === 'not_found') return res;
  }
  if (!res.ok) res = lookupVkHtml_(p);
  try {
    if (res.ok) cache.put('vk:' + p.key, JSON.stringify(res), 21600);
    else cache.put('vkf:' + p.key, '1', 300);
  } catch (e) { /* ignore */ }
  return res;
}

/** Единая идентификация участника по ссылке ВК. */
function identify_(body, s, fresh) {
  var p = parseVkLink_(body.vkUrl);
  if (!p.ok) return err_('BAD_VK', p.message);
  var info = lookupVk_(p, fresh);
  if (!info.ok && info.reason === 'not_found') return err_('VK_NOT_FOUND', 'Профиль ВКонтакте не найден. Проверьте ссылку.');
  var name = info.ok ? info.name : cleanName_(body.name);
  if (!name || name.length < 2) return err_('NEED_NAME', 'Не удалось получить имя из профиля — введите имя вручную', { needName: true });
  return {
    ok: true, key: info.ok && info.id ? String(info.id) : p.key, name: name, photo: info.ok ? (info.photo || '') : '', url: p.url,
    source: info.ok ? 'сайт (ВК)' : 'сайт (имя вручную)', display: fmtName_(name, s.nameFormat)
  };
}

/** Диагностика: что именно отвечает ВК серверу Google. Запускается из редактора скриптов. */
function vkDiagnose_(input) {
  var p = parseVkLink_(input);
  var out = { parsed: p, tokenSet: !!PropertiesService.getScriptProperties().getProperty('VK_TOKEN'), attempts: [] };
  if (!p.ok) return out;
  ['https://vk.com/' + p.slug, 'https://m.vk.com/' + p.slug].forEach(function (u) {
    var a = { url: u };
    try {
      var r = fetchVkPage_(u);
      a.status = r.status; a.charset = r.charset; a.length = r.text.length;
      var t = r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      a.title = t ? decodeEntities_(t[1]).slice(0, 120) : '';
      a.ogTitle = metaContent_(r.text, 'og:title').slice(0, 120);
      a.ogImage = metaContent_(r.text, 'og:image').slice(0, 200);
      a.parsed = parseVkHtml_(r.text);
    } catch (e) { a.error = String(e.message || e); }
    out.attempts.push(a);
  });
  return out;
}

/** Запустите из редактора (Выполнить → testVk) и откройте «Журнал выполнения». Замените ссылку на свою. */
function testVk() {
  var report = vkDiagnose_('https://vk.com/durov');
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// ───────────────────────── Действия участников ─────────────────────────

function actionState_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('state');
  if (hit) { var obj = JSON.parse(hit); obj.now = Date.now(); return obj; }

  var s = readSettings_();
  var applied = PropertiesService.getScriptProperties().getProperty('PAUSE_APPLIED') === '1';
  var now = Date.now();
  var bookings = readBookings_();
  var needWork = s.paused !== applied ||
    (!s.paused && !isQuietAt(now, qCfg_(s)) && bookings.some(function (b) { return UNCONFIRMED.indexOf(b.status) >= 0 && b.deadline && b.deadline <= now; }));
  if (needWork) {
    withLock_(function () { prepareLocked_(); });
    s = readSettings_();
    bookings = readBookings_();
  }
  var state = publicState_(s, bookings);
  try { cache.put('state', JSON.stringify(state), 8); } catch (e) { /* слишком большой — не кэшируем */ }
  return state;
}

function actionResolveVk_(body) {
  var client = cleanClient_(body.clientId);
  if (!client) return err_('BAD_CLIENT', 'Обновите страницу и попробуйте снова');
  if (!rateLimit_('resolve:' + client, 20, 600)) return err_('RATE', 'Слишком много запросов, подождите несколько минут');
  var s = readSettings_();
  var who = identify_(body, s);
  if (!who.ok) return who;
  return { ok: true, display: who.display, photo: who.photo, key: who.key };
}

function actionBook_(body) {
  var client = cleanClient_(body.clientId);
  if (!client) return err_('BAD_CLIENT', 'Обновите страницу и попробуйте снова');
  if (!rateLimit_('book:' + client, 12, 600)) return err_('RATE', 'Слишком много попыток, подождите несколько минут');

  // Быстрые проверки и (медленный) запрос к ВК — до блокировки, чтобы не задерживать остальных
  var s0 = readSettings_();
  if (!s0.bookingOpen) return err_('CLOSED', 'Приём броней закрыт');
  if (s0.paused) return err_('PAUSED', s0.pauseMessage || 'Технический перерыв');
  if (!cleanNumbers_(body.numbers, s0.ticketCount).length) return err_('EMPTY', 'Выберите хотя бы один номерок');
  var who;
  if (body.playerKey) {
    // Игрок выбран из общего списка: ссылку и запрос к ВК не используем, берём данные из базы
    ensurePlayerSheets_();
    var kp = findPlayer_(String(body.playerKey));
    if (!kp) return err_('PLAYER_NOT_FOUND', 'Игрок не найден в списке. Вставьте ссылку на ваш профиль ВК.');
    who = { ok: true, key: kp.key, name: kp.name, photo: kp.photo || '', url: kp.url || '', source: 'сайт (из списка)' };
  } else {
    who = identify_(body, s0);
    if (!who.ok) return who;
  }

  return withLock_(function () {
    var s = prepareLocked_();
    if (!s.bookingOpen) return err_('CLOSED', 'Приём броней закрыт');
    if (s.paused) return err_('PAUSED', s.pauseMessage || 'Технический перерыв');
    var nums = cleanNumbers_(body.numbers, s.ticketCount);
    if (!nums.length) return err_('EMPTY', 'Выберите хотя бы один номерок');
    who.display = fmtName_(who.name, s.nameFormat);

    var bookings = readBookings_();
    var busy = busyMap_(bookings);
    var taken = nums.filter(function (n) { return busy[n]; });
    if (taken.length) {
      invalidate_();
      return err_('TAKEN', 'Номерки уже заняты: ' + taken.join(', '), { taken: taken });
    }

    var pending = 0, confirmed = 0;
    bookings.forEach(function (b) {
      if (b.vkKey !== who.key && b.client !== client) return;
      if (UNCONFIRMED.indexOf(b.status) >= 0) pending += b.numbers.length;
      else if (b.status === ST.OK) confirmed += b.numbers.length;
    });
    if (pending + nums.length > s.maxPending) {
      return err_('LIMIT', pending > 0
        ? 'У вас уже есть неподтверждённые номерки (' + pending + ' из ' + s.maxPending + '). Дождитесь подтверждения предыдущей брони.'
        : 'За один раз можно взять не больше ' + s.maxPending + ' номерков.', { pending: pending, limit: s.maxPending });
    }
    if (s.maxConfirmed > 0 && pending + confirmed + nums.length > s.maxConfirmed) {
      return err_('LIMIT_TOTAL', 'На одного участника за эфир — не больше ' + s.maxConfirmed + ' номерков.', { limit: s.maxConfirmed });
    }

    var b = {
      code: newCode_(bookings), created: Date.now(), name: who.name, vkUrl: who.url, numbers: nums,
      status: ST.PENDING, deadline: null, leftMin: null, source: who.source, note: '', vkKey: who.key,
      client: client, updated: null, reminded: false, photo: who.photo, event: s.eventNumber
    };
    armTimer_(b, s, s.confirmHours * 60);
    appendBooking_(b);
    log_(who.display, 'бронь', b.code + ' №' + nums.join(','));
    queueNotify_('🆕 Новая бронь ' + b.code + ': ' + who.name + ' (' + who.url + ') — №' + nums.join(', ') +
      ' до ' + fmtLocal_(b.deadline, Math.round(s.utcOffset * 60)));
    invalidate_();
    return { ok: true, booking: publicBooking_(b, s), quiet: quietInfo_(s, Date.now()), info: payInfo_(s) };
  });
}

function findByCode_(bookings, code) {
  var c = String(code || '').trim();
  for (var i = 0; i < bookings.length; i++) if (bookings[i].code === c) return bookings[i];
  return null;
}

function actionMine_(clientId) {
  var client = cleanClient_(clientId);
  if (!client) return { ok: true, bookings: [] };
  var s = readSettings_();
  var now = Date.now();
  var mine = readBookings_().filter(function (b) {
    if (b.client !== client) return false;
    if (b.status === ST.EXPIRED) return b.updated && now - b.updated < 48 * 3600000;
    return [ST.PENDING, ST.PAID, ST.OK].indexOf(b.status) >= 0;
  }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).slice(0, 10);
  return { ok: true, now: now, paused: s.paused, quiet: quietInfo_(s, now), bookings: mine.map(function (b) { return publicBooking_(b, s); }) };
}

function actionMarkPaid_(body) {
  var client = cleanClient_(body.clientId);
  if (!client) return err_('BAD_CLIENT', 'Обновите страницу и попробуйте снова');
  if (!rateLimit_('paid:' + client, 20, 600)) return err_('RATE', 'Слишком много запросов');
  return withLock_(function () {
    var s = prepareLocked_();
    var b = findByCode_(readBookings_(), body.code);
    // Код брони знает только тот, кому его показали, поэтому для «оплата заявлена» достаточно кода
    // (раньше требовалось ещё совпадение браузера — если id браузера менялся, бронь «терялась»)
    if (!b) {
      log_('система', 'бронь не найдена', 'код «' + String(body.code || '').slice(0, 12) + '», клиент ' + client.slice(0, 6));
      return err_('NOT_FOUND', 'Бронь с таким кодом не найдена. Возможно, эфир уже завершён, а брони очищены. Обновите страницу.');
    }
    if (b.client !== client) log_('система', 'оплата из другого браузера', b.code + ' ' + b.name);
    if (b.status === ST.EXPIRED) return err_('EXPIRED', 'Время брони истекло. Если вы уже оплатили — напишите организатору, он восстановит бронь.');
    if (b.status === ST.OK) return { ok: true, booking: publicBooking_(b, s) };
    if (b.status !== ST.PENDING && b.status !== ST.PAID) return err_('STATE', 'Бронь уже неактивна');
    if (b.status === ST.PENDING) {
      b.status = ST.PAID;
      saveBooking_(b);
      log_(b.name, 'оплата заявлена', b.code);
      queueNotify_('💰 Оплата заявлена ' + b.code + ': ' + b.name + ' (' + b.vkUrl + ') — №' + b.numbers.join(', ') +
        (b.deadline ? ' — до ' + fmtLocal_(b.deadline, Math.round(s.utcOffset * 60)) : ''));
      invalidate_();
    }
    return { ok: true, booking: publicBooking_(b, s) };
  });
}

function actionCancelMine_(body) {
  var client = cleanClient_(body.clientId);
  if (!client) return err_('BAD_CLIENT', 'Обновите страницу и попробуйте снова');
  return withLock_(function () {
    prepareLocked_();
    var b = findByCode_(readBookings_(), body.code);
    if (!b || b.client !== client) return err_('NOT_FOUND', 'Бронь не найдена');
    if (b.status !== ST.PENDING) return err_('STATE', 'Отменить можно только бронь, по которой ещё не заявлена оплата');
    b.status = ST.CANCELLED;
    b.deadline = null; b.leftMin = null;
    saveBooking_(b);
    log_(b.name, 'отмена участником', b.code);
    invalidate_();
    return { ok: true };
  });
}

// ───────────────────────── Админка ─────────────────────────

function checkAdmin_(body) {
  var pass = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pass) return err_('NO_PASSWORD', 'ADMIN_PASSWORD не задан в свойствах скрипта');
  var given = String(body.password == null ? '' : body.password);
  var diff = given.length ^ pass.length;
  for (var i = 0; i < pass.length; i++) diff |= (given.charCodeAt(i) || 0) ^ pass.charCodeAt(i);
  if (diff !== 0) {
    Utilities.sleep(1200);   // замедляет перебор
    return err_('AUTH', 'Неверный пароль');
  }
  return null;
}

function settingsForm_(s) {
  var raw = rawSettings_();
  return SETTINGS_SCHEMA.map(function (d) {
    var val = String(raw[d.key] == null ? '' : raw[d.key]);
    if (d.type === 'time' && parseHM_(val) !== null) val = hmStr_(parseHM_(val));
    return { key: d.key, label: d.label, hint: d.hint, type: d.type, options: d.options || null, value: val };
  });
}

function adminState_() {
  var s = readSettings_();
  var bookings = readBookings_();
  var tickets = buildTickets_(s, bookings, true);
  var counts = { free: 0, pending: 0, paid: 0, taken: 0, blocked: 0 };
  tickets.forEach(function (t) {
    counts[{ f: 'free', p: 'pending', a: 'paid', t: 'taken', b: 'blocked' }[t.s]]++;
  });
  var list = bookings.filter(function (b) { return b.status !== ST.BLOCK; })
    .sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).slice(0, 400).map(function (b) { return adminBooking_(b, s); });
  return {
    ok: true, version: SERVER_VERSION, now: Date.now(), tzOffsetMin: Math.round(s.utcOffset * 60),
    event: { number: s.eventNumber, title: s.eventTitle },
    ticketCount: s.ticketCount, paused: s.paused, open: s.bookingOpen, confirmHours: s.confirmHours,
    quiet: quietInfo_(s, Date.now()), warnings: settingsWarnings_(), undo: undoInfo_(), rules: rulesInfo_(s),
    tickets: tickets, bookings: list, counts: counts, form: settingsForm_(s)
  };
}

function adminLoad_() {
  return withLock_(function () { prepareLocked_(); return adminState_(); });
}

function adminSetStatus_(body, kind) {
  return withLock_(function () {
    var s = prepareLocked_();
    var bookings = readBookings_();
    var b = findByCode_(bookings, body.code);
    if (!b) return err_('NOT_FOUND', 'Бронь не найдена');
    if (kind === 'confirm') {
      if ([ST.PENDING, ST.PAID, ST.EXPIRED].indexOf(b.status) < 0) return err_('STATE', 'Подтвердить можно ожидающую или истёкшую бронь');
      if (b.status === ST.EXPIRED && !numbersFree_(bookings, b)) return err_('TAKEN', 'Номерки уже заняты другими — восстановить нельзя');
      b.status = ST.OK; b.deadline = null; b.leftMin = null;
    } else if (kind === 'cancel') {
      if (HOLDING.indexOf(b.status) < 0) return err_('STATE', 'Бронь уже неактивна');
      b.status = ST.CANCELLED; b.deadline = null; b.leftMin = null;
    } else if (kind === 'restore') {
      if (b.status !== ST.EXPIRED && b.status !== ST.CANCELLED) return err_('STATE', 'Восстановить можно только истёкшую или отменённую бронь');
      if (!numbersFree_(bookings, b)) return err_('TAKEN', 'Номерки уже заняты другими — восстановить нельзя');
      b.status = ST.PENDING; b.reminded = false;
      armTimer_(b, s, s.confirmHours * 60);
    }
    saveBooking_(b);
    log_('админ', kind, b.code);
    invalidate_();
    return adminState_();
  });
}

function numbersFree_(bookings, b) {
  var busy = busyMap_(bookings);
  return b.numbers.every(function (n) { return !busy[n] || busy[n].code === b.code; });
}

function adminExtend_(body) {
  return withLock_(function () {
    var s = prepareLocked_();
    var b = findByCode_(readBookings_(), body.code);
    if (!b) return err_('NOT_FOUND', 'Бронь не найдена');
    if (UNCONFIRMED.indexOf(b.status) < 0) return err_('STATE', 'Продлить можно только ожидающую бронь');
    var hours = num_(body.hours, 1, 0.1, 72);
    if (s.paused || b.leftMin !== null) {
      b.leftMin = (b.leftMin || 0) + hours * 60;
      b.deadline = null;
    } else {
      b.deadline = addActiveMinutes(Math.max(Date.now(), b.deadline || 0), hours * 60, qCfg_(s));
    }
    b.reminded = false;
    saveBooking_(b);
    log_('админ', 'продление', b.code + ' +' + hours + 'ч');
    invalidate_();
    return adminState_();
  });
}

/** Для формы админа: имя и фото по ссылке ВК (до создания брони). */
function adminResolveVk_(body) {
  var who = identify_({ vkUrl: body.vkUrl, name: '' }, readSettings_(), true);
  if (!who.ok) return who;
  return { ok: true, name: who.name, display: who.display, photo: who.photo, key: who.key };
}

function adminBook_(body) {
  // Запрос к ВК — до блокировки (он медленный), как и при брони участником
  var s0 = readSettings_();
  var who = null, typedName = cleanName_(body.name);
  if (body.playerKey) ensurePlayerSheets_();
  var known = body.playerKey ? findPlayer_(String(body.playerKey)) : null;
  if (known) {
    // Игрок выбран из базы — запрос к ВК не нужен
    who = { ok: true, key: known.key, name: known.name, url: known.url || '', photo: known.photo || '', source: 'база игроков' };
  } else if (String(body.vkUrl || '').trim()) {
    who = identify_({ vkUrl: body.vkUrl, name: body.name }, s0, true);
    if (!who.ok) return who;                            // BAD_VK / VK_NOT_FOUND / NEED_NAME (профиль не определился, имя не введено)
  }
  var name = typedName.length >= 2 ? typedName : (who ? who.name : '');
  if (name.length < 2) return err_('NEED_NAME', 'Укажите имя участника или ссылку на его профиль ВК', { needName: true });

  return withLock_(function () {
    var s = prepareLocked_();
    var nums = cleanNumbers_(body.numbers, s.ticketCount);
    if (!nums.length) return err_('EMPTY', 'Выберите номерки');
    var bookings = readBookings_();
    var busy = busyMap_(bookings);
    var taken = nums.filter(function (n) { return busy[n]; });
    if (taken.length) return err_('TAKEN', 'Номерки уже заняты: ' + taken.join(', '), { taken: taken });

    var code = newCode_(bookings);
    var confirmed = body.mode === 'confirmed';
    var b = {
      code: code, created: Date.now(), name: name, vkUrl: who ? who.url : '', numbers: nums,
      status: confirmed ? ST.OK : ST.PENDING, deadline: null, leftMin: null, source: 'админ',
      note: cleanName_(body.note || ''), vkKey: who ? who.key : ('adm:' + code), client: '', updated: null, reminded: false,
      photo: who ? who.photo : '', event: s.eventNumber
    };
    if (!confirmed) armTimer_(b, s, s.confirmHours * 60);
    appendBooking_(b);
    log_('админ', 'ручная бронь', code + ' ' + name + ' №' + nums.join(',') + (confirmed ? ' (подтверждена)' : ' (с таймером)') + (who ? ' [ВК: ' + who.source + ']' : ''));
    invalidate_();
    return adminState_();
  });
}

function adminBlock_(body, block) {
  return withLock_(function () {
    var s = prepareLocked_();
    var nums = cleanNumbers_(body.numbers, s.ticketCount);
    if (!nums.length) return err_('EMPTY', 'Выберите номерки');
    var bookings = readBookings_();
    var busy = busyMap_(bookings);
    if (block) {
      var taken = nums.filter(function (n) { return busy[n]; });
      if (taken.length) return err_('TAKEN', 'Номерки уже заняты: ' + taken.join(', '), { taken: taken });
      nums.forEach(function (n) {
        appendBooking_({
          code: newCode_(readBookings_(), 'БЛ-'), created: Date.now(), name: 'БЛОК', vkUrl: '', numbers: [n], status: ST.BLOCK,
          deadline: null, leftMin: null, source: 'админ', note: '', vkKey: 'block', client: '', updated: null, reminded: false, event: s.eventNumber
        });
      });
      log_('админ', 'блок', '№' + nums.join(','));
    } else {
      var changed = 0;
      bookings.forEach(function (b) {
        if (b.status === ST.BLOCK && b.numbers.some(function (n) { return nums.indexOf(n) >= 0; })) {
          b.status = ST.CANCELLED; saveBooking_(b); changed++;
        }
      });
      if (!changed) return err_('STATE', 'Среди выбранных нет заблокированных номерков');
      log_('админ', 'разблок', '№' + nums.join(','));
    }
    invalidate_();
    return adminState_();
  });
}

function uniqueSheetName_(ss, base) {
  var clean = String(base).replace(/[\[\]*?:\/\\]/g, '-').slice(0, 90);
  var name = clean, i = 2;
  while (ss.getSheetByName(name)) { name = clean + ' (' + i + ')'; i++; }
  return name;
}

function adminSettings_(body) {
  return withLock_(function () {
    var updates = body.updates || {};
    var checked = {};
    for (var key in updates) {
      var def = schemaByKey_(key);
      if (!def) continue;
      var c = coerceSetting_(def, updates[key]);
      if (c.error) return err_('BAD_SETTING', c.error);
      checked[key] = c.value;
    }
    if (checked.ticketCount !== undefined) {
      var maxUsed = 0;
      readBookings_().forEach(function (b) {
        if (HOLDING.indexOf(b.status) >= 0) b.numbers.forEach(function (n) { if (n > maxUsed) maxUsed = n; });
      });
      if (Number(checked.ticketCount) < maxUsed) {
        return err_('BAD_SETTING', 'Нельзя уменьшить до ' + checked.ticketCount + ': номерок №' + maxUsed + ' уже занят');
      }
    }
    for (var k in checked) writeSetting_(k, checked[k]);
    var s = readSettings_();
    syncPauseLocked_(s);
    log_('админ', 'настройки', Object.keys(checked).join(', '));
    invalidate_();
    return adminState_();
  });
}

// ───────────────────────── Точки входа ─────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'mine') return json_(actionMine_(p.client));
    if (p.action === 'balances') return json_(actionBalances_());
    if (p.action === 'players') return json_(actionPlayerList_());
    if (p.action === 'ping') return json_({ ok: true, now: Date.now() });
    return json_(actionState_());
  } catch (ex) {
    log_('система', 'ошибка GET', ex.message);
    return json_(err_('SERVER', 'Сервер временно недоступен, попробуйте ещё раз'));
  }
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (ex) { return json_(err_('BAD_REQUEST', 'Некорректный запрос')); }
  var action = String(body.action || '');
  try {
    // публичные
    if (action === 'resolveVk') return json_(actionResolveVk_(body));
    if (action === 'book') return json_(actionBook_(body));
    if (action === 'markPaid') return json_(actionMarkPaid_(body));
    if (action === 'cancelMine') return json_(actionCancelMine_(body));
    // админские
    if (action.indexOf('admin') === 0) {
      var denied = checkAdmin_(body);
      if (denied) return json_(denied);
      if (action === 'adminState') return json_(adminLoad_());
      if (action === 'adminConfirm') return json_(adminSetStatus_(body, 'confirm'));
      if (action === 'adminCancel') return json_(adminSetStatus_(body, 'cancel'));
      if (action === 'adminRestore') return json_(adminSetStatus_(body, 'restore'));
      if (action === 'adminExtend') return json_(adminExtend_(body));
      if (action === 'adminBook') return json_(adminBook_(body));
      if (action === 'adminBlock') return json_(adminBlock_(body, true));
      if (action === 'adminUnblock') return json_(adminBlock_(body, false));
      if (action === 'adminSettings') return json_(adminSettings_(body));
      if (action === 'adminArchive') return json_(adminArchive_(body));
      if (action === 'adminUndoClose') return json_(adminUndoClose_());
      if (action === 'adminResolveVk') return json_(adminResolveVk_(body));
      if (action === 'adminPlayers') return json_(adminPlayers_());
      if (action === 'adminPlayerAdd') return json_(adminPlayerAdd_(body));
      if (action === 'adminPlayerAdjust') return json_(adminPlayerAdjust_(body));
      if (action === 'adminPlayerSetMisses') return json_(adminPlayerSetMisses_(body));
      if (action === 'adminPlayerFreeze') return json_(adminPlayerFreeze_(body));
      if (action === 'adminPlayerHistory') return json_(adminPlayerHistory_(body));
      if (action === 'adminExchange') return json_(adminExchange_(body));
      if (action === 'adminImport') return json_(adminImport_(body));
    }
    return json_(err_('BAD_ACTION', 'Неизвестное действие'));
  } catch (ex) {
    log_('система', 'ошибка ' + action, ex.message);
    var busy = String(ex.message).indexOf('lock') >= 0 || String(ex.message).indexOf('блокир') >= 0;
    return json_(err_(busy ? 'BUSY' : 'SERVER', busy ? 'Сервер занят, повторите через пару секунд' : 'Внутренняя ошибка сервера'));
  }
}
