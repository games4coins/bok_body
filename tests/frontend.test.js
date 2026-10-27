/**
 * Дымовой тест фронтенда без браузера: минимальный фейковый DOM + встроенный демо-бэкенд.
 * Проверяет, что страницы собираются, кликабельные элементы работают и сценарий брони проходит.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FNode {}
class FText extends FNode {
  constructor(t) { super(); this.text = String(t); this.parent = null; }
  get textContent() { return this.text; }
}
class FEl extends FNode {
  constructor(tag) {
    super(); this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {};
    this.className = ''; this.parent = null; this.value = ''; this.disabled = false; this.open = false;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(typeof c === 'string' ? new FText(c) : c)); }
  replaceChildren(...cs) { this.children.forEach((c) => { c.parent = null; }); this.children = []; cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener() {}
  get classList() {
    const self = this;
    const set = () => new Set(self.className.split(/\s+/).filter(Boolean));
    return {
      add(c) { const s = set(); s.add(c); self.className = [...s].join(' '); },
      remove(c) { const s = set(); s.delete(c); self.className = [...s].join(' '); },
      contains(c) { return set().has(c); },
      toggle(c, force) { const s = set(); const on = force === undefined ? !s.has(c) : force; on ? s.add(c) : s.delete(c); self.className = [...s].join(' '); }
    };
  }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = [new FText(v)]; }
  focus() {} select() {} setSelectionRange() {}
  matches(sel) {
    if (sel === '[data-deadline]') return 'data-deadline' in this.attrs;
    if (sel === 'input[type=search]') return this.tag === 'input' && this.attrs.type === 'search';
    return false;
  }
  querySelectorAll(sel) { return findAll(this, (e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function findAll(root, pred, out = []) {
  if (root instanceof FEl) {
    if (pred(root)) out.push(root);
    root.children.forEach((c) => findAll(c, pred, out));
  }
  return out;
}
const textOf = (el) => el.textContent;
const hasText = (el, t) => textOf(el).includes(t);
const buttons = (root) => findAll(root, (e) => e.tag === 'button');
const buttonByText = (root, t) => buttons(root).find((b) => textOf(b).includes(t));
function click(el) {
  if (el.disabled) return;
  (el.listeners.click || []).forEach((f) => f({ target: el, preventDefault() {}, stopPropagation() {} }));
}

function boot(files) {
  const body = new FEl('body');
  const app = new FEl('main'), demo = new FEl('div');
  body.append(demo, app);
  const byId = { app, demo };
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const timers = [];
  const clip = [];
  const audio = { osc: 0 };
  class FakeAudio {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { audio.osc++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    resume() {}
  }
  const sandbox = {
    AudioContext: FakeAudio,
    console, Math, JSON, Object, Array, String, Number, Boolean, Date, Promise, Set, Map, Uint8Array, RegExp, Error, isFinite, parseInt,
    URLSearchParams, setTimeout, clearTimeout, setInterval: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearInterval() {}, crypto: webcrypto,
    Node: FNode,
    document: {
      body, title: '', hidden: false,
      createElement: (t) => new FEl(t), createElementNS: (ns, t) => new FEl(t), createTextNode: (t) => new FText(t),
      getElementById: (id) => byId[id] || null, addEventListener() {}, removeEventListener() {},
      querySelectorAll: (sel) => body.querySelectorAll(sel), execCommand: () => true
    },
    navigator: { clipboard: { writeText: async (t) => { clip.push(t); } } },
    localStorage: storage, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload() {} },
    matchMedia: () => ({ matches: true }),
    confirm: () => true
  };
  sandbox.window = sandbox;
  sandbox.NOMEROK_CONFIG = { API_URL: '' };   // тесты всегда работают на демо-бэкенде, независимо от боевого config.js
  sandbox.window.matchMedia = sandbox.matchMedia;
  sandbox.window.confirm = () => true;
  const ctx = vm.createContext(sandbox);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return { app, body, demo, ctx, sandbox, timers, audio, clip };
}

const PUBLIC = ['assets/qrcode.js', 'assets/common.js', 'assets/app.js'];
const ADMIN = ['assets/common.js', 'assets/admin.js'];

test('публичная страница: сборка, сетка, список участников по алфавиту', async () => {
  const { app, body } = boot(PUBLIC);
  await sleep(500);
  assert.ok(hasText(app, 'Эфир №187'), 'номер эфира');
  assert.ok(hasText(app, 'Прямой эфир мастерской'), 'название эфира');
  assert.ok(hasText(app, 'Как это работает'));
  const tiles = findAll(app, (e) => e.className.split(' ').includes('tile'));
  assert.equal(tiles.length, 63);
  assert.ok(tiles.filter((t) => t.className.includes('t-free')).length > 40);

  const rows = findAll(app, (e) => e.className === 'prow');
  const names = rows.map((r) => textOf(findAll(r, (e) => e.tag === 'b')[0]));
  assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().replace(/ё/g, 'е').localeCompare(b.toLowerCase().replace(/ё/g, 'е'), 'ru')));
  assert.ok(names.includes('Анна К.') && names.includes('Елена Ё.'));
  const letters = findAll(app, (e) => e.className === 'letter').map(textOf);
  assert.ok(letters.length >= 5);
  assert.ok(!hasText(app, 'vk.com'), 'ссылки ВК не показываются участникам');
});

test('публичная страница: выбор номерков → бронь → экран подтверждения скриншотом', async () => {
  const { app, body, clip } = boot(PUBLIC);
  await sleep(500);
  const free = () => findAll(app, (e) => e.className.includes('t-free'));
  const tile = (n) => findAll(app, (e) => e.className.split(' ').includes('tile') && textOf(e) === String(n))[0];

  click(tile(2)); click(tile(3));
  const bar = findAll(app, (e) => e.className.includes('actionbar'))[0];
  assert.ok(!bar.className.includes('hidden'), 'панель действий показана');
  assert.ok(hasText(bar, 'Выбрано: 2'));
  assert.ok(hasText(bar, '№2, №3'));
  assert.ok(tile(2).className.includes('t-sel'));

  click(buttonByText(bar, 'Забронировать'));
  const overlay = findAll(body, (e) => e.className === 'overlay')[0];
  assert.ok(overlay, 'модалка открыта');
  assert.ok(hasText(overlay, 'Ссылка на ваш профиль ВКонтакте'));

  // пустая ссылка → понятная ошибка
  const submit = buttonByText(overlay, 'Забронировать №2');
  click(submit); await sleep(50);
  assert.ok(hasText(overlay, 'Вставьте ссылку'));

  // ссылка не на ВК → ошибка сервера показана
  const vk = findAll(overlay, (e) => e.tag === 'input')[0];
  vk.value = 'example.com/me';
  click(submit); await sleep(400);
  assert.ok(hasText(overlay, 'не похоже на ссылку'));

  vk.value = 'https://vk.com/id12345';
  click(submit); await sleep(500);
  const ov2 = findAll(body, (e) => e.className === 'overlay')[0];
  assert.ok(hasText(ov2, 'Подтвердите бронирование номерков скриншотом доната'));
  assert.ok(!/Б-\d{4}/.test(textOf(ov2)), 'код брони участнику не показывается');
  assert.ok(hasText(ov2, 'Ваши номерки'));
  assert.ok(hasText(ov2, '2, 3'), 'номерки через запятую');

  // оплата: ссылка и QR-код
  const payLink = findAll(ov2, (e) => e.tag === 'a' && textOf(e).includes('Оплатить по ссылке'))[0];
  assert.ok(payLink, 'кнопка-ссылка оплаты');
  assert.equal(payLink.attrs.href, 'https://spasibomir.ru/pay/33434');
  assert.equal(payLink.attrs.rel, 'noopener noreferrer');
  const qrPath = findAll(ov2, (e) => e.tag === 'path' && (e.attrs.d || '').length > 100)[0];
  assert.ok(qrPath, 'QR-код нарисован');
  assert.ok(hasText(ov2, 'К оплате: 500 ₽ (2 × 250 ₽)'), 'сумма: ' + textOf(ov2).slice(0, 400));

  // комментарий под постом: копирование номерков и ссылка на пост
  assert.ok(hasText(ov2, 'Оставьте комментарий под постом'));
  const post = findAll(ov2, (e) => e.tag === 'a' && textOf(e).includes('Открыть пост'))[0];
  assert.ok(post && /^https:\/\//.test(post.attrs.href));
  click(buttonByText(ov2, 'Копировать номерки')); await sleep(30);
  assert.deepEqual(clip, ['2, 3'], 'в буфер ушли номерки через запятую');
  click(buttonByText(ov2, 'Копировать')); await sleep(30);
  assert.equal(clip[clip.length - 1], '2, 3');

  // после брони в «Ваши брони» — без кода, номерки заняты
  const mine = findAll(app, (e) => e.className.includes('mine'));
  assert.ok(mine.length > 0 && hasText(mine[0], 'Ждёт подтверждения'));
  assert.ok(!/Б-\d{4}/.test(textOf(mine[0])), 'кода нет и в «Ваших бронях»');
  assert.ok(tile(2).className.includes('t-pend'));
  assert.ok(tile(2).disabled);

  // «Я оставил(а) комментарий» → статус «Оплата заявлена»
  click(buttonByText(ov2, 'Я оставил(а) комментарий со скриншотом')); await sleep(500);
  const mine2 = findAll(app, (e) => e.className.includes('mine'));
  assert.ok(hasText(mine2[0], 'Оплата заявлена'));

  // лимит: 2 уже висят, ещё до 5 можно, сверх — отказ на клиенте
  [4, 5, 7].forEach((n) => click(tile(n)));
  click(tile(8));
  const toasts = findAll(body, (e) => e.className.includes('toast'));
  assert.ok(toasts.some((t) => hasText(t, 'не больше 3')), 'клиентский лимит: ' + toasts.map(textOf).join('|'));
});

test('публичная страница: перерыв показывает баннер и блокирует выбор', async () => {
  const { app, body, ctx, timers } = boot(PUBLIC);
  await sleep(400);
  await ctx.Nomerok.api.post('adminSettings', { password: 'demo', updates: { paused: 'ДА', pauseMessage: 'Вернёмся через 15 минут' } });
  await timers.find((t) => t.ms === 8000).f();
  await sleep(300);
  assert.ok(hasText(app, 'Вернёмся через 15 минут'), 'баннер перерыва');
  assert.ok(hasText(app, 'Технический перерыв'), 'метка в шапке');
  const tile = findAll(app, (e) => e.className.includes('t-free'))[0];
  click(tile);
  const toasts = findAll(body, (e) => e.className.includes('toast'));
  assert.ok(toasts.some((t) => hasText(t, 'Вернёмся через 15 минут')), 'тост при попытке выбрать');
  assert.ok(!tile.className.includes('t-sel'), 'выбор не сработал');
});

test('публичная страница: нет даты эфира — нигде не появляется «null»', async () => {
  const { app, ctx, timers } = boot(PUBLIC);
  await sleep(400);
  await ctx.Nomerok.api.post('adminSettings', { password: 'demo', updates: { eventDate: '' } });
  await timers.find((t) => t.ms === 8000).f();
  await sleep(300);
  assert.ok(!textOf(app).includes('null') && !textOf(app).includes('undefined'));
});

test('админка: вход, очередь, подтверждение, сетка, ручная бронь, настройки', async () => {
  const { app, body, ctx } = boot(ADMIN);
  await sleep(100);
  assert.ok(hasText(app, 'Введите пароль'));

  // неверный пароль
  const form = findAll(app, (e) => e.tag === 'form')[0];
  const pw = findAll(app, (e) => e.tag === 'input' && e.attrs.type === 'password')[0];
  pw.value = 'wrong';
  form.listeners.submit.forEach((f) => f({ preventDefault() {} }));
  await sleep(400);
  assert.ok(hasText(app, 'Неверный пароль'));

  pw.value = 'demo';
  form.listeners.submit.forEach((f) => f({ preventDefault() {} }));
  await sleep(500);
  assert.ok(hasText(app, 'Эфир №187'));
  assert.ok(hasText(app, 'Оплата заявлена'), 'очередь: заявленная оплата');
  assert.ok(hasText(app, 'Елена Ёлкина'));

  // подтверждаем бронь Елены
  const card = findAll(app, (e) => e.className.includes('bk') && hasText(e, 'Елена Ёлкина'))[0];
  click(buttonByText(card, 'Подтвердить'));
  await sleep(400);
  assert.ok(!findAll(app, (e) => e.className.includes('bk') && hasText(e, 'Елена Ёлкина')).length, 'ушла из «Проверить»');

  // вкладка «Сетка»
  click(buttonByText(app, 'Сетка'));
  const tiles = findAll(app, (e) => e.className.split(' ').includes('tile'));
  assert.equal(tiles.length, 63);
  assert.ok(tiles.some((t) => t.className.includes('t-block')), 'заблокированный номерок');
  const t10 = tiles.find((t) => textOf(t) === '10');
  click(t10);
  const t11 = findAll(app, (e) => e.className.split(' ').includes('tile')).find((t) => textOf(t) === '11');
  click(t11);
  assert.ok(buttonByText(app, 'Назначить вручную'));
  click(buttonByText(app, 'Назначить вручную'));
  const overlay = findAll(body, (e) => e.className === 'overlay')[0];
  const name = findAll(overlay, (e) => e.tag === 'input')[0];
  name.value = 'Мария Сидорова';
  click(buttonByText(overlay, 'Забронировать №10'));
  await sleep(500);
  assert.ok(!findAll(body, (e) => e.className === 'overlay').length, 'модалка закрылась');
  const t10b = findAll(app, (e) => e.className.split(' ').includes('tile')).find((t) => textOf(t) === '10');
  assert.ok(t10b.className.includes('t-pend') || t10b.className.includes('t-taken') || t10b.className.includes('t-paid'));

  // настройки
  click(buttonByText(app, 'Настройки'));
  assert.ok(hasText(app, 'Количество номерков'));
  assert.ok(hasText(app, 'Часов на подтверждение брони'));
  assert.ok(hasText(app, 'Тихие часы: с'));
  assert.ok(hasText(app, 'Технический перерыв'));
  const title = findAll(app, (e) => e.tag === 'input').find((i) => i.value === 'Прямой эфир мастерской');
  title.value = 'Новое название';
  title.listeners.input.forEach((f) => f({ target: title }));
  click(buttonByText(app, 'Сохранить настройки'));
  await sleep(500);
  const topBrand = findAll(app, (e) => e.className === 'brand')[0];
  assert.ok(topBrand);
  const st = await ctx.Nomerok.api.state();
  assert.equal(st.event.title, 'Новое название');
});

test('админка: звук и всплывающее уведомление о новой брони и заявленной оплате', async () => {
  const { app, body, ctx, timers, audio } = boot(ADMIN);
  await sleep(100);
  const form = findAll(app, (e) => e.tag === 'form')[0];
  findAll(app, (e) => e.tag === 'input' && e.attrs.type === 'password')[0].value = 'demo';
  form.listeners.submit.forEach((f) => f({ preventDefault() {} }));
  await sleep(500);
  const poll = timers.find((t) => t.ms === 10000).f;
  const beepsAfterLogin = audio.osc;
  const toastsNow = () => findAll(body, (e) => e.className.includes('toast')).map(textOf);
  assert.ok(!toastsNow().some((t) => t.includes('Новая бронь')), 'старые брони не шумят при входе');

  const r = await ctx.Nomerok.api.post('book', { clientId: 'testclient12345', vkUrl: 'vk.com/id7', name: 'Новый Участник', numbers: [20] });
  await poll(); await sleep(50);
  assert.ok(toastsNow().some((t) => t.includes('Новая бронь') && t.includes('Новый Участник')), toastsNow().join('|'));
  assert.ok(audio.osc > beepsAfterLogin, 'прозвучал сигнал');

  const beeps2 = audio.osc;
  await ctx.Nomerok.api.post('markPaid', { clientId: 'testclient12345', code: r.booking.code });
  await poll(); await sleep(50);
  assert.ok(toastsNow().some((t) => t.includes('Оплата заявлена') && t.includes(r.booking.code)));
  assert.ok(audio.osc > beeps2, 'сигнал на заявленную оплату');
  assert.ok(ctx.document.title.startsWith('('), 'счётчик в заголовке вкладки: ' + ctx.document.title);

  // без звука — тосты есть, сигнала нет
  click(buttonByText(app, 'Звук'));   // включали → выключаем
  const beeps3 = audio.osc;
  await ctx.Nomerok.api.post('book', { clientId: 'testclient54321', vkUrl: 'vk.com/id8', name: 'Тихий Гость', numbers: [21] });
  await poll(); await sleep(50);
  assert.ok(toastsNow().some((t) => t.includes('Тихий Гость')));
  assert.equal(audio.osc, beeps3, 'звук выключен');
});

test('админка: кнопка «Перерыв» замораживает и возобновляет бронирование', async () => {
  const { app, body, ctx } = boot(ADMIN);
  await sleep(100);
  const form = findAll(app, (e) => e.tag === 'form')[0];
  findAll(app, (e) => e.tag === 'input' && e.attrs.type === 'password')[0].value = 'demo';
  form.listeners.submit.forEach((f) => f({ preventDefault() {} }));
  await sleep(500);
  click(buttonByText(app, 'Перерыв')); await sleep(400);
  assert.equal((await ctx.Nomerok.api.state()).paused, true);
  assert.ok(hasText(app, 'Бронирование заморожено'));
  click(buttonByText(app, 'Возобновить')); await sleep(400);
  assert.equal((await ctx.Nomerok.api.state()).paused, false);
  assert.ok(!hasText(app, 'Бронирование заморожено'));
});

test('оплата без комиссии: при 3 номерках блока нет, при 4+ — надпись и кнопка, QR и ссылка на оплату остаются', async () => {
  for (const [count, shown] of [[3, false], [4, true], [5, true]]) {
    const { app, body } = boot(PUBLIC);
    await sleep(450);
    const tile = (n) => findAll(app, (e) => e.className.split(' ').includes('tile') && textOf(e) === String(n))[0];
    for (let n = 2; n < 2 + count; n++) click(tile(n));
    const bar = findAll(app, (e) => e.className.includes('actionbar'))[0];
    click(buttonByText(bar, 'Забронировать'));
    let overlay = findAll(body, (e) => e.className === 'overlay')[0];
    findAll(overlay, (e) => e.tag === 'input')[0].value = 'https://vk.com/id12345';
    click(buttonByText(overlay, 'Забронировать №2'));
    await sleep(500);
    overlay = findAll(body, (e) => e.className === 'overlay')[0];
    assert.ok(hasText(overlay, 'Подтвердите бронирование'), 'бронь создана, ' + count);

    const box = findAll(overlay, (e) => e.className === 'bulkbox')[0];
    assert.equal(!!box, shown, 'блок без комиссии при ' + count + ' номерках');
    if (shown) {
      assert.ok(hasText(box, 'Для брони от 4х и более билетов становится доступна оплата без комиссии'));
      const btn = findAll(box, (e) => e.tag === 'a')[0];
      assert.equal(btn.attrs.href, 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all');
      assert.equal(btn.attrs.target, '_blank');
      assert.equal(btn.attrs.rel, 'noopener noreferrer');
      assert.equal(textOf(btn), 'ЗАПРОСИТЬ РЕКВИЗИТЫ');
    }
    // оплата по ссылке и QR-код никуда не пропадают
    const payLink = findAll(overlay, (e) => e.tag === 'a' && textOf(e).includes('Оплатить по ссылке'))[0];
    assert.equal(payLink.attrs.href, 'https://spasibomir.ru/pay/33434');
    assert.ok(findAll(overlay, (e) => e.tag === 'path' && (e.attrs.d || '').length > 100).length === 1, 'QR на месте');
  }
});

test('оплата без комиссии: порог и тексты берутся из настроек, 0 скрывает блок', async () => {
  const run = async (updates) => {
    const env = boot(PUBLIC);
    await sleep(400);
    await env.ctx.Nomerok.api.post('adminSettings', { password: 'demo', updates });
    await env.timers.find((t) => t.ms === 8000).f();
    await sleep(300);
    const { app, body } = env;
    const tile = (n) => findAll(app, (e) => e.className.split(' ').includes('tile') && textOf(e) === String(n))[0];
    [2, 3, 4, 5, 7].forEach((n) => click(tile(n)));                       // 5 номерков
    click(buttonByText(findAll(app, (e) => e.className.includes('actionbar'))[0], 'Забронировать'));
    let ov = findAll(body, (e) => e.className === 'overlay')[0];
    findAll(ov, (e) => e.tag === 'input')[0].value = 'https://vk.com/id12345';
    click(buttonByText(ov, 'Забронировать №2'));
    await sleep(500);
    ov = findAll(body, (e) => e.className === 'overlay')[0];
    return findAll(ov, (e) => e.className === 'bulkbox')[0] || null;
  };

  assert.ok(await run({ bulkMin: 5 }), 'порог 5: при 5 номерках блок есть');
  assert.equal(await run({ bulkMin: 6 }), null, 'порог 6: при 5 номерках блока нет');
  assert.equal(await run({ bulkMin: 0 }), null, '0 — функция выключена');
  assert.equal(await run({ bulkUrl: '' }), null, 'без ссылки кнопка скрыта');
  const custom = await run({ bulkMin: 5, bulkText: 'Бронь от {n} — без комиссии', bulkButton: 'Узнать реквизиты', bulkUrl: 'https://vk.com/im?sel=-5' });
  assert.ok(hasText(custom, 'Бронь от 5 — без комиссии'));
  const link = findAll(custom, (e) => e.tag === 'a')[0];
  assert.equal(textOf(link), 'Узнать реквизиты');
  assert.equal(link.attrs.href, 'https://vk.com/im?sel=-5');
});

test('публичная страница: кнопка входа в админку', async () => {
  const { app } = boot(PUBLIC);
  await sleep(400);
  const link = findAll(app, (e) => e.tag === 'a' && e.className.includes('admin-link'))[0];
  assert.ok(link, 'ссылка на админку в шапке');
  assert.equal(link.attrs.href, 'admin.html');
  assert.ok(hasText(link, 'Админ'));
});

test('админка: переход обратно к бронированию (на входе и после входа)', async () => {
  const { app } = boot(ADMIN);
  await sleep(100);
  const loginBack = findAll(app, (e) => e.tag === 'a' && e.attrs.href === 'index.html')[0];
  assert.ok(loginBack && hasText(loginBack, 'К бронированию'), 'на экране входа');
  const form = findAll(app, (e) => e.tag === 'form')[0];
  findAll(app, (e) => e.tag === 'input' && e.attrs.type === 'password')[0].value = 'demo';
  form.listeners.submit.forEach((f) => f({ preventDefault() {} }));
  await sleep(500);
  const back = findAll(app, (e) => e.tag === 'a' && e.attrs.href === 'index.html' && e.className.includes('tab'))[0];
  assert.ok(back && hasText(back, 'К бронированию'), 'в панели администратора');
  click(buttonByText(app, 'Настройки'));
  assert.ok(hasText(app, 'Ссылка на оплату'));
  assert.ok(hasText(app, 'Ссылка на пост для комментария'));
});

test('аватарка: фото ВК или буква; чужие и опасные адреса игнорируются', async () => {
  const { ctx } = boot(PUBLIC);
  const { avatar, safeUrl } = ctx.Nomerok;
  const withPhoto = avatar('Анна К.', 'https://sun9-1.userapi.com/a.jpg', 40);
  assert.equal(withPhoto.tag, 'img');
  assert.equal(withPhoto.attrs.src, 'https://sun9-1.userapi.com/a.jpg');
  assert.equal(withPhoto.attrs.referrerpolicy, 'no-referrer');
  const letter = avatar('Анна К.', '', 40);
  assert.equal(letter.tag, 'div');
  assert.equal(textOf(letter), 'А');
  assert.equal(avatar('Анна', 'javascript:alert(1)').tag, 'div', 'javascript: отброшен');
  assert.equal(safeUrl('ftp://x.y/z'), '');
  assert.equal(safeUrl('https://spasibomir.ru/pay/33434'), 'https://spasibomir.ru/pay/33434');
});

test('QR-код: пустая ссылка оплаты скрывает блок оплаты', async () => {
  const { app, body, ctx, timers } = boot(PUBLIC);
  await sleep(400);
  assert.equal(ctx.Nomerok.qrSvg('', 100), null);
  assert.ok(ctx.Nomerok.qrSvg('https://spasibomir.ru/pay/33434', 100));
});

test('XSS: имена участников не интерпретируются как HTML', async () => {
  const { app, ctx } = boot(PUBLIC);
  await sleep(400);
  await ctx.Nomerok.api.post('book', { clientId: 'xssclient123456', vkUrl: 'vk.com/id9', name: '<img src=x onerror=alert(1)> Вася', numbers: [21] });
  const el = ctx.Nomerok.h('div', null, '<b>не жирный</b>');
  assert.equal(el.textContent, '<b>не жирный</b>');
  assert.equal(findAll(el, (e) => e.tag === 'b').length, 0);
});
