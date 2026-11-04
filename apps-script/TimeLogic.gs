/**
 * TimeLogic.gs — чистые функции без обращений к сервисам Google.
 * Считают «активное» время: часы тихого окна (например 00:00–09:00) в таймер брони не входят.
 *
 * q — конфиг тихих часов:
 *   { enabled: bool, fromMin: 0..1439, toMin: 0..1439, offsetMin: смещение часового пояса от UTC в минутах }
 * Все расчёты — в целых миллисекундах, поэтому без накопления ошибок округления.
 */

var DAY_MS = 86400000;
var MIN_MS = 60000;

function qOn_(q) {
  return !!(q && q.enabled && q.fromMin !== q.toMin);
}

function mod_(a, n) {
  return ((a % n) + n) % n;
}

/** Миллисекунды от начала локальных суток. */
function localDayMs_(ms, q) {
  return mod_(ms + q.offsetMin * MIN_MS, DAY_MS);
}

function inQuiet_(m, q) {
  var s = q.fromMin * MIN_MS, e = q.toMin * MIN_MS;
  return s < e ? (m >= s && m < e) : (m >= s || m < e);
}

/** Сколько мс до конца тихого окна (m — внутри окна). */
function untilQuietEnd_(m, q) {
  var s = q.fromMin * MIN_MS, e = q.toMin * MIN_MS;
  if (s < e) return e - m;
  return m >= s ? (DAY_MS - m) + e : e - m;
}

/** Сколько мс до начала тихого окна (m — вне окна). */
function untilQuietStart_(m, q) {
  var s = q.fromMin * MIN_MS;
  return m < s ? s - m : (DAY_MS - m) + s;
}

/** Момент (мс), наступающий через `minutes` активных минут после startMs. */
function addActiveMinutes(startMs, minutes, q) {
  var remaining = Math.round(minutes * MIN_MS);
  if (!(remaining > 0)) return startMs;
  if (!qOn_(q)) return startMs + remaining;
  var t = startMs;
  for (var guard = 0; guard < 100000; guard++) {
    var m = localDayMs_(t, q);
    if (inQuiet_(m, q)) { t += untilQuietEnd_(m, q); continue; }
    var u = untilQuietStart_(m, q);
    if (remaining <= u) { t += remaining; break; }
    remaining -= u;
    t += u;
  }
  return t;
}

/** Сколько активных минут между aMs и bMs (если b <= a — 0). */
function activeMinutesBetween(aMs, bMs, q) {
  if (!(bMs > aMs)) return 0;
  if (!qOn_(q)) return (bMs - aMs) / MIN_MS;
  var t = aMs, total = 0;
  for (var guard = 0; guard < 100000 && t < bMs; guard++) {
    var m = localDayMs_(t, q);
    if (inQuiet_(m, q)) {
      t += Math.min(untilQuietEnd_(m, q), bMs - t);
    } else {
      var step = Math.min(untilQuietStart_(m, q), bMs - t);
      total += step;
      t += step;
    }
  }
  return total / MIN_MS;
}

/** «ДД.ММ ЧЧ:ММ» в часовом поясе организатора. */
function fmtLocal_(ms, offsetMin) {
  if (!ms) return '';
  var d = new Date(ms + offsetMin * MIN_MS);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

/**
 * Время → минуты от начала суток, либо null. Понимает «09:00», «9:00», «9.00», «09-00», «9», «09:00:00»
 * (так Google Таблица показывает ячейки со временем) и долю суток из числа (0.375 = 09:00).
 */
function parseHM_(v) {
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 1440) % 1440 : null;
  var m = String(v == null ? '' : v).trim().match(/^(\d{1,2})(?:[:.\-](\d{2})(?::\d{2})?)?$/);
  if (!m) return null;
  var h = Number(m[1]), mi = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return (h * 60 + mi) % 1440;
}

/** Идут ли тихие часы в момент ms. */
function isQuietAt(ms, q) {
  return qOn_(q) && inQuiet_(localDayMs_(ms, q), q);
}

/** Когда закончатся тихие часы, если сейчас они идут (иначе null). */
function quietEndsAt(ms, q) {
  if (!isQuietAt(ms, q)) return null;
  return ms + untilQuietEnd_(localDayMs_(ms, q), q);
}

/** Когда начнутся ближайшие тихие часы, если сейчас они не идут (иначе null). */
function nextQuietStartAt(ms, q) {
  if (!qOn_(q) || isQuietAt(ms, q)) return null;
  return ms + untilQuietStart_(localDayMs_(ms, q), q);
}
