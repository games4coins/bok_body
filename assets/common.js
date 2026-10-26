/* Номерок — общие функции: сборка DOM без innerHTML, форматирование, клиент API, демо-режим. */
(function (global) {
  'use strict';

  const CFG = global.NOMEROK_CONFIG || {};
  const DEMO = !CFG.API_URL;

  // ───── DOM: безопасная сборка (текст всегда через textContent, XSS исключён) ─────
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach((k) => append(el, k)); return; }
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function flat(kid, out) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach((k) => flat(k, out)); return; }
    out.push(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  /** Безопасная замена содержимого: пропускает null/false и раскрывает массивы
   *  (нативный replaceChildren(null) вставил бы на страницу текст «null»). */
  function fill(el) {
    const out = [];
    for (let i = 1; i < arguments.length; i++) flat(arguments[i], out);
    el.replaceChildren(...out);
    return el;
  }

  // ───── Время ─────
  let skew = 0; // серверное время минус локальное
  const nowMs = () => Date.now() + skew;
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  function tzName(off) {
    if (off === 180) return 'МСК';
    return 'UTC' + (off >= 0 ? '+' : '−') + Math.abs(off / 60);
  }
  function fmtDT(ms, off) {
    if (!ms) return '';
    const d = new Date(ms + off * 60000);
    return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  }
  function fmtLeft(ms) {
    if (ms <= 0) return 'время вышло';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'меньше минуты';
    const hh = Math.floor(m / 60), mm = m % 60;
    return hh ? hh + ' ч ' + p2(mm) + ' мин' : mm + ' мин';
  }
  function fmtMin(min) { return fmtLeft(min * 60000); }

  // ───── Прочее ─────
  function clientId() {
    let id = '';
    try { id = localStorage.getItem('nomerok_client') || ''; } catch (e) { /* приватный режим */ }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const a = new Uint8Array(16);
      (global.crypto || {}).getRandomValues ? global.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem('nomerok_client', id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { /* ignore */ }
    return null;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
    return Promise.resolve(ok);
  }

  let toastBox = null;
  function toast(text, kind, ms) {
    if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    const t = h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : '') }, h('span', null, text),
      h('button', { 'aria-label': 'Закрыть', onclick: () => t.remove() }, '✕'));
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), ms || 5000);
  }

  let audio = null;
  function unlockAudio() {
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { /* ignore */ }
  }
  function beep() {
    try {
      unlockAudio();
      if (!audio) return;
      [[0, 880], [0.16, 1175]].forEach(([at, f]) => {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + at;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
        o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + 0.28);
      });
    } catch (e) { /* ignore */ }
  }

  const AV = ['#d9622b', '#b5461a', '#c98a2b', '#6d8f3c', '#2f8f83', '#3f6fb5', '#7a5bb5', '#b0508a'];
  function avatarColor(name) {
    let x = 0;
    for (let i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) >>> 0;
    return AV[x % AV.length];
  }

  // ───── Клиент API ─────
  async function call(method, action, payload) {
    if (DEMO) { await new Promise((r) => setTimeout(r, 120)); return Demo.handle(action, payload || {}); }
    try {
      let r;
      if (method === 'GET') r = await fetch(CFG.API_URL + '?' + new URLSearchParams(payload || {}));
      else r = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // без preflight-запроса CORS
        body: JSON.stringify(Object.assign({ action }, payload))
      });
      const data = await r.json();
      if (data && data.now) skew = data.now - Date.now();
      return data;
    } catch (e) {
      return { ok: false, error: { code: 'NETWORK', message: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' } };
    }
  }
  const api = {
    state: () => call('GET', 'state', { action: 'state' }),
    mine: (client) => call('GET', 'mine', { action: 'mine', client }),
    post: (action, body) => call('POST', action, body)
  };

  // ───── Демо-режим: работает без сервера, чтобы можно было посмотреть вёрстку ─────
  const Demo = (function () {
    const OFF = 180, H = 3600000;
    const cfg = { number: '187', title: 'Прямой эфир мастерской', date: '2 сентября в 21:10 МСК', count: 63, hours: 6, maxPending: 5, paused: false, open: true, pauseMessage: 'Технический перерыв. Бронирование скоро возобновится.' };
    const bookings = [];
    let seq = 4000;
    const add = (name, nums, status, extra) => bookings.push(Object.assign({
      code: 'Б-' + (++seq), name, vk: 'https://vk.com/id' + seq, numbers: nums, status,
      deadline: status === 'ОЖИДАЕТ' || status === 'ОПЛАТА ЗАЯВЛЕНА' ? Date.now() + 3 * H : null,
      created: Date.now() - seq * 60000, client: '', note: '', source: 'сайт (ВК)'
    }, extra || {}));
    add('Анна Кузнецова', [1, 14], 'ПОДТВЕРЖДЕНА');
    add('Борис Иванов', [6], 'ПОДТВЕРЖДЕНА');
    add('Вера Петрова', [12, 13], 'ОЖИДАЕТ');
    add('Егор Смирнов', [23, 24, 25], 'ПОДТВЕРЖДЕНА');
    add('Елена Ёлкина', [36], 'ОПЛАТА ЗАЯВЛЕНА');
    add('Игнат Орлов', [41], 'ПОДТВЕРЖДЕНА');
    add('Люда Белова', [47, 48], 'ПОДТВЕРЖДЕНА');
    add('Ярослав Мудров', [52], 'ПОДТВЕРЖДЕНА');
    add('БЛОК', [30], 'БЛОК', { source: 'админ' });

    const HOLD = ['ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА', 'ПОДТВЕРЖДЕНА', 'БЛОК'];
    const fmtName = (n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[1][0].toUpperCase() + '.' : p[0]; };
    const err = (code, message, extra) => ({ ok: false, error: Object.assign({ code, message }, extra) });
    const busy = () => { const m = {}; bookings.forEach((b) => { if (HOLD.includes(b.status)) b.numbers.forEach((n) => { m[n] = b; }); }); return m; };
    const pub = (b) => ({ code: b.code, numbers: b.numbers, count: b.numbers.length, status: b.status, deadline: b.deadline, leftMin: null, name: fmtName(b.name), created: b.created });
    const tickets = (admin) => {
      const m = busy(), out = [];
      for (let n = 1; n <= cfg.count; n++) {
        const b = m[n];
        const s = !b ? 'f' : b.status === 'БЛОК' ? 'b' : b.status === 'ПОДТВЕРЖДЕНА' ? 't' : (admin && b.status === 'ОПЛАТА ЗАЯВЛЕНА' ? 'a' : 'p');
        out.push(admin ? { n, s, code: b ? b.code : '' } : s);
      }
      return out;
    };
    const pubState = () => {
      const g = {};
      bookings.forEach((b) => {
        if (!['ПОДТВЕРЖДЕНА', 'ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА'].includes(b.status)) return;
        const k = b.name; g[k] = g[k] || { name: fmtName(b.name), items: [] };
        b.numbers.forEach((n) => g[k].items.push([n, b.status === 'ПОДТВЕРЖДЕНА' ? 1 : 0]));
      });
      const players = Object.values(g).map((x) => { x.items.sort((a, b) => a[0] - b[0]); return x; });
      const t = tickets(false);
      return {
        ok: true, now: Date.now(), event: { number: cfg.number, title: cfg.title, date: cfg.date }, price: '250 ₽',
        ticketCount: cfg.count, confirmHours: cfg.hours, limits: { pending: cfg.maxPending, total: 0 },
        quiet: { on: true, from: '00:00', to: '09:00' }, tzOffsetMin: OFF, open: cfg.open, paused: cfg.paused, pauseMessage: cfg.pauseMessage,
        info: { payment: 'Донат на карту 0000 0000 0000 0000 (Имя Ф.)\nили по СБП на +7 900 000-00-00.\nСумма — по числу номерков.', contact: 'Отправьте скриншот доната в личные сообщения ВК (vk.com/your_workshop) и укажите код брони.' },
        tickets: t, players, counts: { free: t.filter((x) => x === 'f').length, total: cfg.count }
      };
    };
    const adm = (b) => ({ code: b.code, created: b.created, name: b.name, vkUrl: b.vk, numbers: b.numbers, count: b.numbers.length, status: b.status, deadline: b.deadline, leftMin: null, source: b.source, note: b.note });
    const form = () => [
      { key: 'eventNumber', label: 'Номер эфира', hint: 'Показывается участникам: «Эфир №…»', type: 'text', options: null, value: cfg.number },
      { key: 'eventTitle', label: 'Название эфира', hint: '', type: 'text', options: null, value: cfg.title },
      { key: 'eventDate', label: 'Дата и время эфира', hint: 'Текст для участников', type: 'text', options: null, value: cfg.date },
      { key: 'ticketCount', label: 'Количество номерков', hint: '1–500', type: 'number', options: null, value: String(cfg.count) },
      { key: 'confirmHours', label: 'Часов на подтверждение брони', hint: 'Считаются без тихих часов', type: 'number', options: null, value: String(cfg.hours) },
      { key: 'maxPending', label: 'Лимит неподтверждённых номерков на человека', hint: '', type: 'number', options: null, value: String(cfg.maxPending) },
      { key: 'quietFrom', label: 'Тихие часы: с', hint: 'ЧЧ:ММ', type: 'time', options: null, value: '00:00' },
      { key: 'quietTo', label: 'Тихие часы: до', hint: 'ЧЧ:ММ', type: 'time', options: null, value: '09:00' },
      { key: 'bookingOpen', label: 'Приём броней открыт', hint: '', type: 'yesno', options: null, value: cfg.open ? 'ДА' : 'НЕТ' },
      { key: 'paused', label: 'Технический перерыв (заморозка бронирования)', hint: 'ДА — новые брони закрыты, таймеры стоят', type: 'yesno', options: null, value: cfg.paused ? 'ДА' : 'НЕТ' },
      { key: 'pauseMessage', label: 'Текст на время перерыва', hint: '', type: 'text', options: null, value: cfg.pauseMessage },
      { key: 'nameFormat', label: 'Формат имени в списке', hint: '', type: 'select', options: ['полное имя', 'имя и инициал', 'только имя'], value: 'имя и инициал' },
      { key: 'notifyEmail', label: 'E-mail для уведомлений', hint: '', type: 'text', options: null, value: '' }
    ];
    const admState = () => {
      const t = tickets(true), c = { free: 0, pending: 0, paid: 0, taken: 0, blocked: 0 };
      t.forEach((x) => { c[{ f: 'free', p: 'pending', a: 'paid', t: 'taken', b: 'blocked' }[x.s]]++; });
      return {
        ok: true, now: Date.now(), tzOffsetMin: OFF, event: { number: cfg.number, title: cfg.title }, ticketCount: cfg.count,
        paused: cfg.paused, open: cfg.open, confirmHours: cfg.hours, tickets: t, counts: c, form: form(),
        bookings: bookings.filter((b) => b.status !== 'БЛОК').sort((a, b) => b.created - a.created).map(adm)
      };
    };
    const find = (code) => bookings.find((b) => b.code === code);

    function handle(action, p) {
      if (action === 'state') return pubState();
      if (action === 'mine') return { ok: true, now: Date.now(), paused: cfg.paused, bookings: bookings.filter((b) => b.client === p.client && b.status !== 'ОТМЕНЕНА').map(pub) };
      if (action === 'resolveVk') return { ok: true, display: 'Демо Г.', key: 'demo' };
      if (action === 'book') {
        if (cfg.paused) return err('PAUSED', cfg.pauseMessage);
        if (!/vk\.(com|ru)\//i.test(p.vkUrl || '')) return err('BAD_VK', 'Это не похоже на ссылку ВКонтакте. Пример: vk.com/id12345');
        const m = busy(), taken = (p.numbers || []).filter((n) => m[n]);
        if (taken.length) return err('TAKEN', 'Номерки уже заняты: ' + taken.join(', '), { taken });
        const pend = bookings.filter((b) => b.client === p.clientId && ['ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА'].includes(b.status)).reduce((s, b) => s + b.numbers.length, 0);
        if (pend + p.numbers.length > cfg.maxPending) return err('LIMIT', 'У вас уже есть неподтверждённые номерки (' + pend + ' из ' + cfg.maxPending + '). Дождитесь подтверждения предыдущей брони.');
        add(p.name || 'Демо Гость', p.numbers.slice().sort((a, b) => a - b), 'ОЖИДАЕТ', { client: p.clientId, vk: p.vkUrl, deadline: Date.now() + cfg.hours * H });
        return { ok: true, booking: pub(bookings[bookings.length - 1]), info: pubState().info };
      }
      if (action === 'markPaid') { const b = find(p.code); if (!b) return err('NOT_FOUND', 'Бронь не найдена'); if (b.status === 'ОЖИДАЕТ') b.status = 'ОПЛАТА ЗАЯВЛЕНА'; return { ok: true, booking: pub(b) }; }
      if (action === 'cancelMine') { const b = find(p.code); if (b && b.status === 'ОЖИДАЕТ') b.status = 'ОТМЕНЕНА'; return { ok: true }; }

      if (!action.startsWith('admin')) return err('BAD_ACTION', 'Неизвестное действие');
      if (p.password !== 'demo') return err('AUTH', 'Неверный пароль (в демо-режиме пароль: demo)');
      const b = p.code ? find(p.code) : null;
      switch (action) {
        case 'adminState': return admState();
        case 'adminConfirm': if (b) { b.status = 'ПОДТВЕРЖДЕНА'; b.deadline = null; } return admState();
        case 'adminCancel': if (b) { b.status = 'ОТМЕНЕНА'; b.deadline = null; } return admState();
        case 'adminRestore': if (b) { b.status = 'ОЖИДАЕТ'; b.deadline = Date.now() + cfg.hours * H; } return admState();
        case 'adminExtend': if (b && b.deadline) b.deadline += (p.hours || 1) * H; return admState();
        case 'adminBook': {
          const m = busy(), taken = (p.numbers || []).filter((n) => m[n]);
          if (taken.length) return err('TAKEN', 'Номерки уже заняты: ' + taken.join(', '));
          if (!p.name || p.name.trim().length < 2) return err('NEED_NAME', 'Укажите имя участника');
          add(p.name, p.numbers.slice().sort((a, c) => a - c), p.mode === 'confirmed' ? 'ПОДТВЕРЖДЕНА' : 'ОЖИДАЕТ', { source: 'админ', note: p.note || '', deadline: p.mode === 'confirmed' ? null : Date.now() + cfg.hours * H });
          return admState();
        }
        case 'adminBlock': (p.numbers || []).forEach((n) => { if (!busy()[n]) add('БЛОК', [n], 'БЛОК', { source: 'админ' }); }); return admState();
        case 'adminUnblock': bookings.forEach((x) => { if (x.status === 'БЛОК' && x.numbers.some((n) => (p.numbers || []).includes(n))) x.status = 'ОТМЕНЕНА'; }); return admState();
        case 'adminSettings': {
          const u = p.updates || {};
          if (u.eventNumber !== undefined) cfg.number = String(u.eventNumber);
          if (u.eventTitle !== undefined) cfg.title = String(u.eventTitle);
          if (u.eventDate !== undefined) cfg.date = String(u.eventDate);
          if (u.ticketCount !== undefined) cfg.count = Math.max(1, Math.min(500, Number(u.ticketCount) || cfg.count));
          if (u.confirmHours !== undefined) cfg.hours = Number(String(u.confirmHours).replace(',', '.')) || cfg.hours;
          if (u.maxPending !== undefined) cfg.maxPending = Number(u.maxPending) || cfg.maxPending;
          if (u.bookingOpen !== undefined) cfg.open = String(u.bookingOpen).toUpperCase() === 'ДА';
          if (u.paused !== undefined) cfg.paused = String(u.paused).toUpperCase() === 'ДА';
          if (u.pauseMessage !== undefined) cfg.pauseMessage = String(u.pauseMessage);
          return admState();
        }
        default: return err('BAD_ACTION', 'Неизвестное действие');
      }
    }
    return { handle };
  })();

  global.Nomerok = { CFG, DEMO, h, fill, nowMs, tzName, fmtDT, fmtLeft, fmtMin, clientId, store, copyText, toast, beep, unlockAudio, avatarColor, api };
})(window);
