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

  // ───── SVG, QR-код, аватарки ─────
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    for (let i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }
  /** Чёткий векторный QR-код (библиотека qrcode-generator, MIT). null — если библиотека не загружена. */
  function qrSvg(text, px) {
    if (typeof global.qrcode !== 'function' || !text) return null;
    try {
      const qr = global.qrcode(0, 'M');
      qr.addData(String(text));
      qr.make();
      const n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2;
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      return svg('svg', { viewBox: '0 0 ' + size + ' ' + size, width: px, height: px, role: 'img', 'aria-label': 'QR-код для оплаты', 'shape-rendering': 'crispEdges' },
        svg('rect', { width: size, height: size, fill: '#fff' }), svg('path', { d, fill: '#000' }));
    } catch (e) { return null; }
  }
  /** Ссылка только http(s), иначе пустая строка (защита от javascript: в href). */
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    return /^https?:\/\/[^\s<>"']{3,400}$/i.test(s) ? s : '';
  }
  /** Аватарка: фото из ВК, а если его нет или оно не загрузилось — цветной кружок с буквой. */
  function avatar(name, photo, size) {
    const st = size ? { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' } : null;
    const letter = h('div', { class: 'avatar', style: st, 'aria-hidden': 'true' }, String(name || '?').charAt(0).toUpperCase());
    letter.style.background = avatarColor(String(name || '?'));
    const url = safeUrl(photo);
    if (!url) return letter;
    const img = h('img', { class: 'avatar avatar-img', style: st, src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', 'aria-hidden': 'true' });
    img.addEventListener('error', () => { if (img.parentNode) img.parentNode.replaceChild(letter, img); });
    return img;
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

  /**
   * Таймер брони. Показывает сколько АКТИВНОГО времени осталось: ночью (тихие часы) оно стоит.
   * q — блок quiet из ответа сервера (nowQuiet, nextStart). data-run — сколько мс часы ещё могут идти до остановки.
   */
  function timerSpan(b, q) {
    const act = b.activeLeftMin != null ? b.activeLeftMin * 60000 : Math.max(0, (b.deadline || 0) - nowMs());
    let run = 1e15;
    if (q && q.nowQuiet) run = 0;
    else if (q && q.on && q.nextStart) run = Math.max(0, q.nextStart - nowMs());
    return h('span', { class: 'timer', 'data-act': Math.round(act), 'data-t0': nowMs(), 'data-run': Math.round(run) }, '');
  }
  function tickTimer(el) {
    const act = Number(el.getAttribute('data-act')), t0 = Number(el.getAttribute('data-t0')), run = Number(el.getAttribute('data-run'));
    const left = act - Math.min(Math.max(nowMs() - t0, 0), run);
    el.textContent = left <= 0 ? 'проверяем…' : fmtLeft(left);
  }
  /** Строка про срок брони: «Подтвердить до … · осталось …» (+ пометка про тихие часы ночью). */
  function timerNodes(b, q, off) {
    if (b.deadline == null) return ['⏸ Таймер на паузе, осталось ' + fmtMin(b.leftMin || 0)];
    const nodes = ['Подтвердить до ', h('b', null, fmtDT(b.deadline, off) + ' ' + tzName(off)), ' · осталось ', timerSpan(b, q)];
    if (q && q.nowQuiet && q.resumeAt) nodes.push(' · 🌙 тихие часы: таймер стоит до ', h('b', null, fmtDT(q.resumeAt, off).slice(6)));
    return nodes;
  }

  // ───── Прочее ─────
  function clientId() {
    const OK = /^[A-Za-z0-9_-]{8,64}$/;
    const ok = (x) => OK.test(x || '');
    // id хранится сразу в нескольких местах: во встроенных браузерах (например, внутри ВК) что-то из этого может быть недоступно
    const read = {
      ls: () => localStorage.getItem('nomerok_client'),
      ss: () => sessionStorage.getItem('nomerok_client'),
      wn: () => { const m = /nomerok_client=([A-Za-z0-9_-]+)/.exec(global.name || ''); return m ? m[1] : ''; },
      ck: () => { const m = /(?:^|; )nomerok_client=([A-Za-z0-9_-]+)/.exec(document.cookie || ''); return m ? m[1] : ''; }
    };
    let id = '';
    for (const k of Object.keys(read)) { try { const v = read[k](); if (ok(v)) { id = v; break; } } catch (e) { /* недоступно */ } }
    if (!ok(id)) {
      const a = new Uint8Array(16);
      (global.crypto || {}).getRandomValues ? global.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    try { localStorage.setItem('nomerok_client', id); } catch (e) { /* ignore */ }
    try { sessionStorage.setItem('nomerok_client', id); } catch (e) { /* ignore */ }
    try { if (!/nomerok_client=/.test(global.name || '')) global.name = (global.name || '') + ' nomerok_client=' + id; } catch (e) { /* ignore */ }
    try { document.cookie = 'nomerok_client=' + id + '; max-age=31536000; path=/; SameSite=Lax'; } catch (e) { /* ignore */ }
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
    balances: () => call('GET', 'balances', { action: 'balances' }),
    post: (action, body) => call('POST', action, body)
  };

  // ───── Демо-режим: работает без сервера, чтобы можно было посмотреть вёрстку ─────
  const Demo = (function () {
    const OFF = 180, H = 3600000;
    const cfg = { quietFrom: '00:00', soldOutEnabled: true, soldOutText: 'Все места забронированы. Прямой эфир проведем {date}', waitText: '', bulkMin: 4, bulkText: 'Для брони от 4х и более билетов становится доступна оплата без комиссии', bulkButton: 'ЗАПРОСИТЬ РЕКВИЗИТЫ', bulkUrl: 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all', number: '187', title: 'Прямой эфир мастерской', date: '2 сентября в 21:10 МСК', count: 63, hours: 6, maxPending: 5, paused: false, open: true, pauseMessage: 'Технический перерыв. Бронирование скоро возобновится.' };
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

    const rules = { missLimit: 3, exchangeMin: 30, rate: 200, mode: 'точный', url: 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all', button: 'ОБМЕНЯТЬ НА СКИДКУ' };
    const roster = [
      { key: '1', name: 'Анна Кузнецова', balance: 34, misses: 0, frozen: false, wins: 0, bought: 34, note: '' },
      { key: '2', name: 'Борис Иванов', balance: 12, misses: 2, frozen: false, wins: 0, bought: 12, note: '' },
      { key: '3', name: 'Вера Петрова', balance: 5, misses: 1, frozen: true, wins: 1, bought: 9, note: '' },
      { key: '4', name: 'Игнат Орлов', balance: 0, misses: 0, frozen: false, wins: 2, bought: 6, note: '' }
    ];
    const ledger = [];
    const pkey = (b) => { const f = roster.find((x) => x.name === b.name); return f ? f.key : null; };
    const worth = (p) => Math.round(p.balance * rules.rate);
    const balShow = (n) => rules.mode === 'скрыт' ? null : rules.mode === 'ступени' ? (n >= 50 ? '50+' : n >= 30 ? '30+' : n >= 20 ? '20+' : n >= 10 ? '10+' : n >= 5 ? '5+' : n >= 1 ? '1+' : 0) : n;
    const mark = (p) => (p ? { bal: balShow(p.balance), miss: p.misses, frozen: p.frozen, ex: p.balance >= rules.exchangeMin } : { bal: null, miss: 0, frozen: false, ex: false });
    const logOp = (p, type, delta, comment) => ledger.unshift({ key: p.key, time: Date.now(), type, delta, balance: p.balance, misses: p.misses, event: cfg.number, who: 'админ', comment: comment || '' });
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
    const tpl = (t) => String(t).replace(/\{date\}/g, cfg.date).replace(/\{number\}/g, cfg.number).replace(/[ \t]+(\r?\n|$)/g, '$1').trim();
    const overlay = (t) => {
      const free = t.filter((x) => x === 'f').length, pend = t.filter((x) => x === 'p').length, taken = t.filter((x) => x === 't').length;
      if (!free && !pend && taken && cfg.soldOutEnabled && cfg.soldOutText) return { kind: 'soldout', text: tpl(cfg.soldOutText) };
      if (!free && pend && cfg.waitText) return { kind: 'waiting', text: tpl(cfg.waitText) };
      return null;
    };
    const pubState = () => {
      const g = {};
      bookings.forEach((b) => {
        if (!['ПОДТВЕРЖДЕНА', 'ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА'].includes(b.status)) return;
        const k = b.name; g[k] = g[k] || Object.assign({ name: fmtName(b.name), photo: '', items: [] }, mark(roster.find((x) => x.name === b.name)));
        b.numbers.forEach((n) => g[k].items.push([n, b.status === 'ПОДТВЕРЖДЕНА' ? 1 : 0]));
      });
      const players = Object.values(g).map((x) => { x.items.sort((a, b) => a[0] - b[0]); return x; });
      const t = tickets(false);
      return {
        ok: true, now: Date.now(), event: { number: cfg.number, title: cfg.title, date: cfg.date }, price: '250 ₽',
        ticketCount: cfg.count, confirmHours: cfg.hours, limits: { pending: cfg.maxPending, total: 0 },
        quiet: { on: true, from: '00:00', to: '09:00' }, tzOffsetMin: OFF, open: cfg.open, paused: cfg.paused, pauseMessage: cfg.pauseMessage,
        info: { payUrl: 'https://spasibomir.ru/pay/33434', postUrl: 'https://vk.com/wall-1_1', payment: '', bulk: cfg.bulkMin > 0 && cfg.bulkUrl ? { min: cfg.bulkMin, text: cfg.bulkText.replace(/\{n\}/g, String(cfg.bulkMin)), button: cfg.bulkButton, url: cfg.bulkUrl } : null },
        tickets: t, overlay: overlay(t), players, counts: { free: t.filter((x) => x === 'f').length, total: cfg.count }
      };
    };
    const adm = (b) => ({ code: b.code, created: b.created, name: b.name, vkUrl: b.vk, numbers: b.numbers, count: b.numbers.length, status: b.status, deadline: b.deadline, leftMin: null, source: b.source, note: b.note, photo: '', key: pkey(b) || ('demo' + b.code) });
    const form = () => [
      { key: 'eventNumber', label: 'Номер эфира', hint: 'Показывается участникам: «Эфир №…»', type: 'text', options: null, value: cfg.number },
      { key: 'eventTitle', label: 'Название эфира', hint: '', type: 'text', options: null, value: cfg.title },
      { key: 'eventDate', label: 'Дата и время эфира', hint: 'Текст для участников', type: 'text', options: null, value: cfg.date },
      { key: 'ticketCount', label: 'Количество номерков', hint: '1–500', type: 'number', options: null, value: String(cfg.count) },
      { key: 'confirmHours', label: 'Часов на подтверждение брони', hint: 'Считаются без тихих часов', type: 'number', options: null, value: String(cfg.hours) },
      { key: 'maxPending', label: 'Лимит неподтверждённых номерков на человека', hint: '', type: 'number', options: null, value: String(cfg.maxPending) },
      { key: 'quietFrom', label: 'Тихие часы: с', hint: 'ЧЧ:ММ', type: 'time', options: null, value: cfg.quietFrom },
      { key: 'quietTo', label: 'Тихие часы: до', hint: 'ЧЧ:ММ', type: 'time', options: null, value: '09:00' },
      { key: 'payUrl', label: 'Ссылка на оплату', hint: 'Кнопка и QR-код для участников', type: 'text', options: null, value: 'https://spasibomir.ru/pay/33434' },
      { key: 'postUrl', label: 'Ссылка на пост для комментария', hint: 'Под ним участники оставляют номерки и скриншот', type: 'text', options: null, value: 'https://vk.com/wall-1_1' },
      { key: 'bulkMin', label: 'Оплата без комиссии: от скольки номерков', hint: '0 — отключить', type: 'number', options: null, value: String(cfg.bulkMin) },
      { key: 'bulkText', label: 'Оплата без комиссии: надпись', hint: 'Можно написать {n}', type: 'textarea', options: null, value: cfg.bulkText },
      { key: 'bulkButton', label: 'Оплата без комиссии: текст кнопки', hint: '', type: 'text', options: null, value: cfg.bulkButton },
      { key: 'bulkUrl', label: 'Оплата без комиссии: ссылка кнопки', hint: 'Пусто — кнопка скрыта', type: 'text', options: null, value: cfg.bulkUrl },
      { key: 'soldOutEnabled', label: 'Надпись «все места забронированы»: показывать', hint: 'Поверх сетки, когда всё подтверждено', type: 'yesno', options: null, value: cfg.soldOutEnabled ? 'ДА' : 'НЕТ' },
      { key: 'soldOutText', label: 'Надпись «все места забронированы»: текст', hint: '{date} — дата эфира, {number} — номер', type: 'textarea', options: null, value: cfg.soldOutText },
      { key: 'waitText', label: 'Надпись «идёт подтверждение»: текст', hint: 'Пусто — не показывать', type: 'textarea', options: null, value: cfg.waitText },
      { key: 'bookingOpen', label: 'Приём броней открыт', hint: '', type: 'yesno', options: null, value: cfg.open ? 'ДА' : 'НЕТ' },
      { key: 'paused', label: 'Технический перерыв (заморозка бронирования)', hint: 'ДА — новые брони закрыты, таймеры стоят', type: 'yesno', options: null, value: cfg.paused ? 'ДА' : 'НЕТ' },
      { key: 'pauseMessage', label: 'Текст на время перерыва', hint: '', type: 'text', options: null, value: cfg.pauseMessage },
      { key: 'missLimit', label: 'Пропусков подряд до обнуления баланса', hint: 'На этом пропуске накопленные номерки сгорают', type: 'number', options: null, value: String(rules.missLimit) },
      { key: 'exchangeRate', label: 'Курс обмена: рублей скидки за 1 номерок', hint: '1 номерок = 200 ₽ по умолчанию', type: 'number', options: null, value: String(rules.rate) },
      { key: 'exchangeMin', label: 'Обмен на скидку: от скольки номерков', hint: '', type: 'number', options: null, value: String(rules.exchangeMin) },
      { key: 'exchangeButton', label: 'Обмен на скидку: текст кнопки', hint: '', type: 'text', options: null, value: rules.button },
      { key: 'exchangeUrl', label: 'Обмен на скидку: ссылка кнопки', hint: 'Пусто — кнопка скрыта', type: 'text', options: null, value: rules.url },
      { key: 'balanceMode', label: 'Как показывать балансы публично', hint: 'точный — число; ступени — «10+»; скрыт — не показывать', type: 'select', options: ['точный', 'ступени', 'скрыт'], value: rules.mode },
      { key: 'nameFormat', label: 'Формат имени в списке', hint: '', type: 'select', options: ['полное имя', 'имя и инициал', 'только имя'], value: 'имя и инициал' },
      { key: 'notifyEmail', label: 'E-mail для уведомлений', hint: '', type: 'text', options: null, value: '' }
    ];
    let lastUndo = null;
    const admState = () => {
      const t = tickets(true), c = { free: 0, pending: 0, paid: 0, taken: 0, blocked: 0 };
      t.forEach((x) => { c[{ f: 'free', p: 'pending', a: 'paid', t: 'taken', b: 'blocked' }[x.s]]++; });
      return {
        ok: true, version: 5, now: Date.now(), tzOffsetMin: OFF, event: { number: cfg.number, title: cfg.title }, ticketCount: cfg.count,
        paused: cfg.paused, open: cfg.open, confirmHours: cfg.hours, tickets: t, counts: c, form: form(), rules, undo: lastUndo ? { event: lastUndo.event, possible: true, reason: '' } : null,
        warnings: /^\d{1,2}([:.\-]\d{2}(:\d{2})?)?$/.test(cfg.quietFrom.trim()) ? [] : ['«Тихие часы: с»: значение «' + cfg.quietFrom + '» не распознано — тихие часы сейчас выключены, таймер идёт круглосуточно. Нужен формат ЧЧ:ММ, например 09:00.'],
        bookings: bookings.filter((b) => b.status !== 'БЛОК').sort((a, b) => b.created - a.created).map(adm)
      };
    };
    const find = (code) => bookings.find((b) => b.code === code);

    function handle(action, p) {
      if (action === 'state') return pubState();
      if (action === 'mine') return { ok: true, now: Date.now(), paused: cfg.paused, bookings: bookings.filter((b) => b.client === p.client && b.status !== 'ОТМЕНЕНА').map(pub) };
      if (action === 'resolveVk' || action === 'adminResolveVk') return { ok: true, display: 'Демо Г.', name: 'Демо Гость', photo: '', key: 'demo' };
      if (action === 'balances') {
        return {
          ok: true, now: Date.now(), rules,
          players: roster.filter((x) => x.balance > 0 || x.misses > 0).map((x) => Object.assign({ name: fmtName(x.name), photo: '', worth: x.balance >= rules.exchangeMin && rules.mode === 'точный' ? worth(x) : null }, mark(x)))
        };
      }
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
          if (String(p.vkUrl || '').trim() && !/vk\.(com|ru)\//i.test(p.vkUrl)) return err('BAD_VK', 'Это не похоже на ссылку ВКонтакте. Пример: vk.com/id12345');
          const nm = (p.name || '').trim().length >= 2 ? p.name.trim() : (String(p.vkUrl || '').trim() ? 'Демо Участник' : '');
          if (nm.length < 2) return err('NEED_NAME', 'Укажите имя участника или ссылку на его профиль ВК', { needName: true });
          add(nm, p.numbers.slice().sort((a, c) => a - c), p.mode === 'confirmed' ? 'ПОДТВЕРЖДЕНА' : 'ОЖИДАЕТ', { source: 'админ', note: p.note || '', deadline: p.mode === 'confirmed' ? null : Date.now() + cfg.hours * H });
          return admState();
        }
        case 'adminBlock': (p.numbers || []).forEach((n) => { if (!busy()[n]) add('БЛОК', [n], 'БЛОК', { source: 'админ' }); }); return admState();
        case 'adminUnblock': bookings.forEach((x) => { if (x.status === 'БЛОК' && x.numbers.some((n) => (p.numbers || []).includes(n))) x.status = 'ОТМЕНЕНА'; }); return admState();
        case 'adminArchive': {
          if (!Array.isArray(p.winners)) return err('NO_WINNERS', 'Укажите победителя или отметьте «без победителя»');
          const open = bookings.filter((x) => ['ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА'].includes(x.status));
          if (open.length && !p.force) return err('PENDING', 'Есть неподтверждённые брони: ' + open.length + '. Подтвердите или отмените их либо закройте вместе с эфиром.', { pending: open.length });
          const part = {};
          bookings.filter((x) => x.status === 'ПОДТВЕРЖДЕНА').forEach((x) => { const k = pkey(x) || ('demo' + x.code); part[k] = part[k] || { name: x.name, tickets: 0 }; part[k].tickets += x.numbers.length; });
          for (const w of p.winners) if (!part[w]) return err('BAD_WINNER', 'Победитель должен быть среди участников этого эфира с подтверждёнными номерками');
          const changes = [];
          Object.keys(part).forEach((k) => {
            const pl = roster.find((x) => x.key === k), win = p.winners.includes(k), before = pl ? pl.balance : 0;
            changes.push({ name: part[k].name, type: win ? 'ПОБЕДА' : 'ЭФИР', tickets: part[k].tickets, isNew: !pl, before: { balance: before, misses: pl ? pl.misses : 0 }, after: { balance: win ? 0 : before + part[k].tickets, misses: 0 }, comment: win ? 'победа: баланс обнулён' : '+' + part[k].tickets + ' номерков' });
          });
          roster.forEach((pl) => { if (!part[pl.key] && pl.balance > 0 && !pl.frozen) changes.push({ name: pl.name, type: pl.misses + 1 >= rules.missLimit ? 'СГОРАНИЕ' : 'ПРОПУСК', tickets: 0, isNew: false, before: { balance: pl.balance, misses: pl.misses }, after: { balance: pl.misses + 1 >= rules.missLimit ? 0 : pl.balance, misses: pl.misses + 1 >= rules.missLimit ? 0 : pl.misses + 1 }, comment: 'пропустил эфир' }); });
          const old = cfg.number, next = String(p.newNumber || '').trim() || (/^\d+$/.test(old) ? String(Number(old) + 1) : '');
          const summary = { participants: Object.keys(part).length, credited: changes.filter((x) => x.type === 'ЭФИР').reduce((s, x) => s + x.tickets, 0), winners: p.winners.length, missed: changes.filter((x) => x.type === 'ПРОПУСК').length, burned: changes.filter((x) => x.type === 'СГОРАНИЕ').length, skipped: 0, unconfirmedClosed: open.length };
          if (p.dryRun) return { ok: true, dryRun: true, event: old, newNumber: next, summary, changes, skipped: [] };
          changes.forEach((ch) => {
            let pl = roster.find((x) => x.name === ch.name);
            if (!pl) { pl = { key: 'n' + Math.random().toString(36).slice(2, 6), name: ch.name, balance: 0, misses: 0, frozen: false, wins: 0, bought: 0, note: '' }; roster.push(pl); }
            pl.balance = ch.after.balance; pl.misses = ch.after.misses; if (ch.type === 'ПОБЕДА') pl.wins++;
          });
          const real = bookings.filter((x) => x.status !== 'БЛОК').length;
          bookings.length = 0;
          lastUndo = { event: old };
          cfg.number = next; cfg.date = String(p.newDate || '').trim();
          const st = admState();
          st.archive = { sheet: real ? 'Архив №' + old : '', rows: real, closed: open.length, oldNumber: old, newNumber: next, summary };
          return st;
        }
        case 'adminUndoClose': lastUndo = null; return admState();
        case 'adminPlayers': return { ok: true, rules, players: roster.map((x) => Object.assign({ url: 'https://vk.com/id' + x.key, photo: '', last: '', updated: Date.now() }, x)) };
        case 'adminPlayerAdd': {
          const nm = (p.name || '').trim() || 'Демо Игрок';
          const pl = { key: 'n' + Math.random().toString(36).slice(2, 6), name: nm, balance: Number(p.balance) || 0, misses: Number(p.misses) || 0, frozen: false, wins: 0, bought: 0, note: p.note || '' };
          roster.push(pl); logOp(pl, 'СТАРТ', pl.balance, 'игрок добавлен вручную');
          return { ok: true, rules, players: roster.map((x) => Object.assign({ url: '', photo: '', last: '', updated: Date.now() }, x)), player: pl };
        }
        case 'adminPlayerAdjust': case 'adminPlayerSetMisses': case 'adminPlayerFreeze': case 'adminExchange': {
          const pl = roster.find((x) => x.key === p.key);
          if (!pl) return err('NOT_FOUND', 'Игрок не найден');
          if (action === 'adminPlayerAdjust') { if (pl.balance + Number(p.delta) < 0) return err('NEGATIVE', 'Баланс не может стать отрицательным (сейчас ' + pl.balance + ')'); pl.balance += Number(p.delta); logOp(pl, 'РУЧНАЯ', Number(p.delta), p.reason); }
          if (action === 'adminPlayerSetMisses') { pl.misses = Number(p.misses) || 0; logOp(pl, 'ПРОПУСКИ', 0, 'пропусков стало ' + pl.misses); }
          if (action === 'adminPlayerFreeze') { pl.frozen = !!p.frozen; logOp(pl, 'ЗАМОРОЗКА', 0, pl.frozen ? 'заморожен' : 'разморожен'); }
          if (action === 'adminExchange') { const n = Number(p.tickets) || 0; if (n > pl.balance) return err('NEGATIVE', 'На балансе всего ' + pl.balance + ' номерков'); pl.balance -= n; logOp(pl, 'ОБМЕН', -n, 'скидка ' + n * rules.rate + ' ₽'); }
          return { ok: true, rules, players: roster.map((x) => Object.assign({ url: '', photo: '', last: '', updated: Date.now() }, x)), player: pl, discountRub: action === 'adminExchange' ? Number(p.tickets) * rules.rate : undefined };
        }
        case 'adminPlayerHistory': return { ok: true, history: ledger.filter((x) => x.key === p.key).slice(0, 60) };
        case 'adminImport': return err('EMPTY', 'В демо-режиме импорт из таблицы недоступен');
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
          if (u.quietFrom !== undefined) cfg.quietFrom = String(u.quietFrom);
          if (u.soldOutEnabled !== undefined) cfg.soldOutEnabled = String(u.soldOutEnabled).toUpperCase() === 'ДА';
          if (u.soldOutText !== undefined) cfg.soldOutText = String(u.soldOutText);
          if (u.waitText !== undefined) cfg.waitText = String(u.waitText);
          if (u.bulkMin !== undefined) cfg.bulkMin = Math.max(0, Math.floor(Number(u.bulkMin) || 0));
          if (u.bulkText !== undefined) cfg.bulkText = String(u.bulkText);
          if (u.bulkButton !== undefined) cfg.bulkButton = String(u.bulkButton);
          if (u.bulkUrl !== undefined) cfg.bulkUrl = String(u.bulkUrl);
          if (u.missLimit !== undefined) rules.missLimit = Math.max(1, Math.floor(Number(u.missLimit) || 3));
          if (u.exchangeRate !== undefined) rules.rate = Math.max(0, Number(u.exchangeRate) || 0);
          if (u.exchangeMin !== undefined) rules.exchangeMin = Math.max(1, Math.floor(Number(u.exchangeMin) || 30));
          if (u.exchangeButton !== undefined) rules.button = String(u.exchangeButton);
          if (u.exchangeUrl !== undefined) rules.url = String(u.exchangeUrl);
          if (u.balanceMode !== undefined) rules.mode = ['точный', 'ступени', 'скрыт'].includes(u.balanceMode) ? u.balanceMode : rules.mode;
          return admState();
        }
        default: return err('BAD_ACTION', 'Неизвестное действие');
      }
    }
    return { handle };
  })();

  global.Nomerok = { CFG, DEMO, h, fill, timerSpan, tickTimer, timerNodes, svg, qrSvg, safeUrl, avatar, nowMs, tzName, fmtDT, fmtLeft, fmtMin, clientId, store, copyText, toast, beep, unlockAudio, avatarColor, api };
})(window);
