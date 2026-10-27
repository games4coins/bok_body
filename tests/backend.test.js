const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const MIN = 60000, HOUR = 3600000;
const CLIENT_A = 'clientAAAA1111';
const CLIENT_B = 'clientBBBB2222';

function book(env, over = {}) {
  return env.post({
    action: 'book', clientId: CLIENT_A, vkUrl: 'https://vk.com/id1001', name: 'Анна Кузнецова', numbers: [1, 2], ...over
  });
}

// ───────────── Время и тихие часы ─────────────

test('addActiveMinutes: тихое окно 00:00–09:00 МСК', () => {
  const env = createEnv();
  const q = { enabled: true, fromMin: 0, toMin: 540, offsetMin: 180 };
  const add = (start, hours) => env.ctx.addActiveMinutes(start, hours * 60, q);
  assert.equal(add(env.msk(2, 14), 6), env.msk(2, 20), '14:00 + 6ч = 20:00');
  assert.equal(add(env.msk(2, 22), 6), env.msk(3, 13), '22:00 + 6ч = 13:00 следующего дня');
  assert.equal(add(env.msk(3, 3), 6), env.msk(3, 15), 'старт внутри окна: отсчёт с 09:00');
  assert.equal(add(env.msk(2, 18), 6), env.msk(3, 0), 'ровно до начала окна');
  assert.equal(add(env.msk(2, 9), 6), env.msk(2, 15), 'ровно с конца окна');
  assert.equal(add(env.msk(2, 14), 0), env.msk(2, 14), '0 часов');
});

test('addActiveMinutes: окно через полночь 23:00–08:00 и выключенное окно', () => {
  const env = createEnv();
  const wrap = { enabled: true, fromMin: 23 * 60, toMin: 8 * 60, offsetMin: 180 };
  assert.equal(env.ctx.addActiveMinutes(env.msk(2, 20), 360, wrap), env.msk(3, 11));
  assert.equal(env.ctx.addActiveMinutes(env.msk(3, 2), 60, wrap), env.msk(3, 9));
  const off = { enabled: false, fromMin: 0, toMin: 540, offsetMin: 180 };
  assert.equal(env.ctx.addActiveMinutes(env.msk(2, 22), 360, off), env.msk(3, 4));
  const same = { enabled: true, fromMin: 600, toMin: 600, offsetMin: 180 };
  assert.equal(env.ctx.addActiveMinutes(env.msk(2, 22), 360, same), env.msk(3, 4), 'from == to — окно выключено');
});

test('activeMinutesBetween согласована с addActiveMinutes (свойство)', () => {
  const env = createEnv();
  const configs = [
    { enabled: true, fromMin: 0, toMin: 540, offsetMin: 180 },
    { enabled: true, fromMin: 23 * 60, toMin: 8 * 60, offsetMin: 180 },
    { enabled: true, fromMin: 13 * 60 + 30, toMin: 15 * 60, offsetMin: -300 },
    { enabled: false, fromMin: 0, toMin: 0, offsetMin: 0 }
  ];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const q of configs) {
    for (let i = 0; i < 300; i++) {
      const start = env.msk(2, 0) + Math.floor(rnd() * 5 * 24 * 60) * MIN;
      const minutes = 1 + Math.floor(rnd() * 3000);
      const end = env.ctx.addActiveMinutes(start, minutes, q);
      const back = env.ctx.activeMinutesBetween(start, end, q);
      assert.ok(Math.abs(back - minutes) < 1e-6, `q=${JSON.stringify(q)} start=${start} min=${minutes} back=${back}`);
      assert.ok(end >= start + minutes * MIN, 'не раньше реального времени');
    }
  }
});

test('fmtLocal_ и parseHM_', () => {
  const env = createEnv();
  assert.equal(env.ctx.fmtLocal_(env.msk(3, 13, 5), 180), '03.09 13:05');
  assert.equal(env.ctx.parseHM_('09:00'), 540);
  assert.equal(env.ctx.parseHM_('9.30'), 570);
  assert.equal(env.ctx.parseHM_('24:00'), 0);
  assert.equal(env.ctx.parseHM_('25:00'), null);
  assert.equal(env.ctx.parseHM_('abc'), null);
});

// ───────────── Ссылки ВК ─────────────

test('parseVkLink_: форматы ссылок', () => {
  const env = createEnv();
  const p = (s) => JSON.parse(JSON.stringify(env.ctx.parseVkLink_(s)));
  assert.equal(p('https://vk.com/id12345').key, '12345');
  assert.equal(p('vk.com/anna_k').key, 'anna_k');
  assert.equal(p('https://m.vk.com/Anna_K?from=search').key, 'anna_k');
  assert.equal(p('http://www.vk.ru/id777/').numericId, '777');
  assert.equal(p('https://vk.com/profile.php?id=555').key, '555');
  assert.equal(p('@durov').key, 'durov');
  assert.equal(p('https://vk.com/club123').ok, false);
  assert.equal(p('https://example.com/id1').ok, false);
  assert.equal(p('').ok, false);
  assert.equal(p('привет').ok, false);
});

// ───────────── Публичное бронирование ─────────────

test('начальное состояние: все номерки свободны, секреты не утекают', () => {
  const env = createEnv();
  const st = env.get();
  assert.equal(st.ok, true);
  assert.equal(st.tickets.length, 63);
  assert.ok(st.tickets.every((t) => t === 'f'));
  assert.equal(st.counts.free, 63);
  assert.equal(st.paused, false);
  assert.equal(st.quiet.from, '00:00');
});

test('бронь без VK_TOKEN: просит имя; с именем — создаётся, дедлайн = 20:00 МСК', () => {
  const env = createEnv();
  const noName = env.post({ action: 'book', clientId: CLIENT_A, vkUrl: 'vk.com/id1001', numbers: [5] });
  assert.equal(noName.ok, false);
  assert.equal(noName.error.code, 'NEED_NAME');

  const r = book(env);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.booking.code, /^Б-\d{4}$/);
  assert.deepEqual(r.booking.numbers, [1, 2]);
  assert.equal(r.booking.status, 'ОЖИДАЕТ');
  assert.equal(r.booking.deadline, env.msk(2, 20));
  assert.equal(r.booking.name, 'Анна К.');
  assert.equal(r.info.payUrl, 'https://spasibomir.ru/pay/33434');

  const st = env.get();
  assert.equal(st.tickets[0], 'p');
  assert.equal(st.tickets[1], 'p');
  assert.equal(st.tickets[2], 'f');
  assert.equal(st.counts.free, 61);
});

test('публичное состояние не раскрывает ссылки, коды и id клиентов', () => {
  const env = createEnv();
  const r = book(env);
  const raw = JSON.stringify(env.get());
  assert.ok(!raw.includes('vk.com'));
  assert.ok(!raw.includes(r.booking.code));
  assert.ok(!raw.includes(CLIENT_A));
  assert.ok(!raw.includes('Кузнецова'), 'по умолчанию — имя и инициал');
});

test('двойная бронь одного номерка невозможна', () => {
  const env = createEnv();
  assert.equal(book(env, { numbers: [3, 4] }).ok, true);
  const second = book(env, { clientId: CLIENT_B, vkUrl: 'vk.com/id2002', name: 'Борис Иванов', numbers: [4, 5] });
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'TAKEN');
  assert.deepEqual(second.error.taken, [4]);
  assert.equal(env.get().tickets[4], 'f', 'номерок 5 не занят частично');
});

test('валидация номеров: вне диапазона, дубли, мусор', () => {
  const env = createEnv();
  assert.equal(book(env, { numbers: [] }).error.code, 'EMPTY');
  assert.equal(book(env, { numbers: [0, 64, -1, 'x', 1.5] }).error.code, 'EMPTY');
  const r = book(env, { numbers: [7, 7, '8', 63] });
  assert.deepEqual(r.booking.numbers, [7, 8, 63]);
});

test('лимит неподтверждённых: нельзя сверх лимита; подтверждение освобождает лимит', () => {
  const env = createEnv();
  assert.equal(book(env, { numbers: [1, 2, 3] }).ok, true);
  const over = book(env, { numbers: [4, 5, 6] });
  assert.equal(over.ok, false);
  assert.equal(over.error.code, 'LIMIT');
  assert.equal(over.error.pending, 3);
  assert.equal(book(env, { numbers: [4, 5] }).ok, true, 'до лимита (5) можно');
  assert.equal(book(env, { numbers: [6] }).error.code, 'LIMIT');

  // тот же человек с другого браузера (другой clientId), но той же ссылкой ВК
  const otherBrowser = book(env, { clientId: CLIENT_B, numbers: [6] });
  assert.equal(otherBrowser.error.code, 'LIMIT');
  // тот же браузер, но другая ссылка ВК
  const otherLink = book(env, { vkUrl: 'vk.com/id9999', name: 'Другой Человек', numbers: [6] });
  assert.equal(otherLink.error.code, 'LIMIT');

  const st = env.admin('adminState');
  const codes = st.bookings.map((b) => b.code);
  for (const c of codes) assert.equal(env.admin('adminConfirm', { code: c }).ok, true);
  assert.equal(book(env, { numbers: [6, 7, 8] }).ok, true, 'после подтверждения лимит сброшен');
});

test('потолок подтверждённых на человека (maxConfirmed)', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { maxConfirmed: 6 } });
  const a = book(env, { numbers: [1, 2, 3, 4, 5] });
  env.admin('adminConfirm', { code: a.booking.code });
  const r = book(env, { numbers: [6, 7] });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'LIMIT_TOTAL');
  assert.equal(book(env, { numbers: [6] }).ok, true);
});

test('вход через VK_TOKEN: имя из профиля, один человек = один ключ при разных ссылках', () => {
  const env = createEnv({ props: { VK_TOKEN: 'secret-token' } });
  env.vkHandler = (url) => {
    assert.ok(url.includes('users.get'));
    return { response: [{ id: 777, first_name: 'Анна', last_name: 'Кузнецова' }] };
  };
  const a = book(env, { vkUrl: 'https://vk.com/anna_k', name: 'Подмена Имени', numbers: [1, 2, 3, 4, 5] });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.booking.name, 'Анна К.', 'имя из ВК, а не из формы');
  // та же страница по другой ссылке (числовой id) → тот же человек → лимит
  const b = book(env, { clientId: CLIENT_B, vkUrl: 'vk.com/id777', numbers: [6] });
  assert.equal(b.error.code, 'LIMIT');
  assert.ok(env.fetches.every((u) => u.includes('access_token=secret-token')));
});

test('VK: профиль не найден → ошибка; сбой VK → просим имя вручную', () => {
  const env = createEnv({ props: { VK_TOKEN: 'secret-token' } });
  env.vkHandler = () => ({ response: [] });
  assert.equal(book(env).error.code, 'VK_NOT_FOUND');
  env.vkHandler = () => ({ error: { error_code: 5 } });
  assert.equal(book(env, { name: '' }).error.code, 'NEED_NAME');
  assert.equal(book(env).ok, true);
});

test('resolveVk возвращает отображаемое имя', () => {
  const env = createEnv({ props: { VK_TOKEN: 't' } });
  env.vkHandler = () => ({ response: [{ id: 5, first_name: 'Вера', last_name: 'Петрова' }] });
  const r = env.post({ action: 'resolveVk', clientId: CLIENT_A, vkUrl: 'vk.com/vera' });
  assert.equal(r.ok, true);
  assert.equal(r.display, 'Вера П.');
});

test('список игроков отсортирован по алфавиту, ё учитывается как е', () => {
  const env = createEnv();
  const mk = (name, id, n) => book(env, { clientId: 'client' + id + 'XXXXXX', vkUrl: 'vk.com/id' + id, name, numbers: [n] });
  mk('Вера Петрова', 3, 3);
  mk('Борис Иванов', 2, 2);
  mk('Елена Ёлкина', 5, 5);
  mk('Анна Кузнецова', 1, 1);
  mk('Егор Смирнов', 4, 4);
  const names = env.get().players.map((p) => p.name);
  assert.deepEqual(names, ['Анна К.', 'Борис И.', 'Вера П.', 'Егор С.', 'Елена Ё.']);
});

test('формат имени и скрытие неподтверждённых в списке', () => {
  const env = createEnv();
  book(env, { numbers: [1] });
  env.admin('adminSettings', { updates: { nameFormat: 'полное имя' } });
  assert.equal(env.get().players[0].name, 'Анна Кузнецова');
  env.admin('adminSettings', { updates: { nameFormat: 'только имя' } });
  assert.equal(env.get().players[0].name, 'Анна');
  env.admin('adminSettings', { updates: { showPending: 'НЕТ' } });
  assert.equal(env.get().players.length, 0);
  assert.equal(env.get().tickets[0], 'p', 'но номерок всё равно занят');
});

test('«Я оплатил»: только владелец брони; письмо админу', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { notifyEmail: 'owner@example.com' } });
  const r = book(env);
  const stranger = env.post({ action: 'markPaid', clientId: CLIENT_B, code: r.booking.code });
  assert.equal(stranger.error.code, 'NOT_FOUND');
  const ok = env.post({ action: 'markPaid', clientId: CLIENT_A, code: r.booking.code });
  assert.equal(ok.ok, true);
  assert.equal(ok.booking.status, 'ОПЛАТА ЗАЯВЛЕНА');
  assert.ok(env.mails.length >= 1);
  assert.equal(env.mails[0].to, 'owner@example.com');
  assert.match(env.mails[0].body, /Новая бронь/);
  // повторное нажатие безопасно
  assert.equal(env.post({ action: 'markPaid', clientId: CLIENT_A, code: r.booking.code }).ok, true);
});

test('письма склеиваются не чаще раза в 2 минуты, остаток уходит по таймеру', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { notifyEmail: 'owner@example.com' } });
  book(env, { numbers: [1] });                       // уйдёт сразу
  assert.equal(env.mails.length, 1);
  book(env, { clientId: CLIENT_B, vkUrl: 'vk.com/id2', name: 'Борис Иванов', numbers: [2] });
  book(env, { clientId: 'clientCCCC3333', vkUrl: 'vk.com/id3', name: 'Вера Петрова', numbers: [3] });
  assert.equal(env.mails.length, 1, 'задержаны');
  env.advance(3 * MIN);
  env.ctx.tick();
  assert.equal(env.mails.length, 2);
  assert.match(env.mails[1].subject, /2 новых события|2 новых/);
  assert.match(env.mails[1].body, /Борис/);
  assert.match(env.mails[1].body, /Вера/);
});

test('отмена участником: только ожидающая бронь', () => {
  const env = createEnv();
  const r = book(env);
  assert.equal(env.post({ action: 'cancelMine', clientId: CLIENT_B, code: r.booking.code }).error.code, 'NOT_FOUND');
  env.post({ action: 'markPaid', clientId: CLIENT_A, code: r.booking.code });
  assert.equal(env.post({ action: 'cancelMine', clientId: CLIENT_A, code: r.booking.code }).error.code, 'STATE');
  const r2 = book(env, { numbers: [10] });
  assert.equal(env.post({ action: 'cancelMine', clientId: CLIENT_A, code: r2.booking.code }).ok, true);
  assert.equal(env.get().tickets[9], 'f');
});

test('«мои брони» видны по clientId', () => {
  const env = createEnv();
  const r = book(env);
  const mine = env.get({ action: 'mine', client: CLIENT_A });
  assert.equal(mine.bookings.length, 1);
  assert.equal(mine.bookings[0].code, r.booking.code);
  assert.equal(env.get({ action: 'mine', client: CLIENT_B }).bookings.length, 0);
});

// ───────────── Истечение и тихие часы ─────────────

test('бронь истекает по таймеру, номерки освобождаются, админ может восстановить', () => {
  const env = createEnv();
  const r = book(env);                                // 14:00 → 20:00
  env.setClock(env.msk(2, 19, 59));
  assert.equal(env.get().tickets[0], 'p');
  env.setClock(env.msk(2, 20, 1));
  const st = env.get();
  assert.equal(st.tickets[0], 'f');
  assert.equal(env.get({ action: 'mine', client: CLIENT_A }).bookings[0].status, 'ИСТЕКЛА');
  assert.equal(env.post({ action: 'markPaid', clientId: CLIENT_A, code: r.booking.code }).error.code, 'EXPIRED');

  const restored = env.admin('adminRestore', { code: r.booking.code });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  const b = restored.bookings.find((x) => x.code === r.booking.code);
  assert.equal(b.status, 'ОЖИДАЕТ');
  // 20:01 + 6 активных часов: 3ч59м до полуночи, затем 2ч01м с 09:00 → 11:01 следующего дня
  assert.equal(b.deadline, env.msk(3, 11, 1));
});

test('бронь вечером: таймер не идёт ночью (22:00 + 6ч = 13:00)', () => {
  const env = createEnv();
  env.setClock(env.msk(2, 22));
  const r = book(env);
  assert.equal(r.booking.deadline, env.msk(3, 13));
  env.setClock(env.msk(3, 8));                         // ночью/утром не истекла
  assert.equal(env.get().tickets[0], 'p');
  env.setClock(env.msk(3, 13, 1));
  assert.equal(env.get().tickets[0], 'f');
});

test('восстановление не работает, если номерки уже заняты другими', () => {
  const env = createEnv();
  const r = book(env, { numbers: [1, 2] });
  env.setClock(env.msk(2, 21));
  env.get();                                           // истекла
  book(env, { clientId: CLIENT_B, vkUrl: 'vk.com/id2', name: 'Борис Иванов', numbers: [2] });
  const res = env.admin('adminRestore', { code: r.booking.code });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'TAKEN');
});

// ───────────── Пауза ─────────────

test('техперерыв: новые брони закрыты, таймеры стоят и продолжаются после возобновления', () => {
  const env = createEnv();
  const r = book(env);                                 // 14:00 → дедлайн 20:00
  env.setClock(env.msk(2, 15));
  const paused = env.admin('adminSettings', { updates: { paused: 'ДА', pauseMessage: 'Перерыв до вечера' } });
  assert.equal(paused.ok, true, JSON.stringify(paused));
  let b = paused.bookings.find((x) => x.code === r.booking.code);
  assert.equal(b.deadline, null);
  assert.equal(b.leftMin, 300);

  const blocked = book(env, { clientId: CLIENT_B, vkUrl: 'vk.com/id2', name: 'Борис Иванов', numbers: [9] });
  assert.equal(blocked.error.code, 'PAUSED');
  assert.equal(blocked.error.message, 'Перерыв до вечера');
  assert.equal(env.get().paused, true);

  env.setClock(env.msk(2, 22));                        // перерыв длится 7 часов, дедлайн «прошёл»
  assert.equal(env.get().tickets[0], 'p', 'во время перерыва не истекает');

  const resumed = env.admin('adminSettings', { updates: { paused: 'НЕТ' } });
  b = resumed.bookings.find((x) => x.code === r.booking.code);
  assert.equal(b.leftMin, null);
  // 22:00 + 5 активных часов с учётом ночи (00:00–09:00): 2ч до полуночи + 3ч с 09:00 = 12:00
  assert.equal(b.deadline, env.msk(3, 12));
  assert.equal(book(env, { clientId: CLIENT_B, vkUrl: 'vk.com/id2', name: 'Борис Иванов', numbers: [9] }).ok, true);
});

test('админ включил перерыв прямо в таблице (с телефона) — таймеры тоже замораживаются', () => {
  const env = createEnv();
  const r = book(env);
  env.setClock(env.msk(2, 16));
  env.editSettingInSheet('Технический перерыв (заморозка бронирования)', 'ДА');
  const st = env.get();
  assert.equal(st.paused, true);
  const adm = env.admin('adminState');
  const b = adm.bookings.find((x) => x.code === r.booking.code);
  assert.equal(b.deadline, null);
  assert.equal(b.leftMin, 240);
  env.editSettingInSheet('Технический перерыв (заморозка бронирования)', 'НЕТ');
  const adm2 = env.admin('adminState');
  assert.equal(adm2.bookings.find((x) => x.code === r.booking.code).deadline, env.msk(2, 20));
});

test('ручная бронь с таймером во время перерыва не истекает сразу', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { paused: 'ДА' } });
  const r = env.admin('adminBook', { name: 'Гость', numbers: [4], mode: 'timer' });
  assert.equal(r.ok, true);
  env.advance(10 * HOUR);
  assert.equal(env.get().tickets[3], 'p');
  const back = env.admin('adminSettings', { updates: { paused: 'НЕТ' } });
  assert.ok(back.bookings[0].deadline > env.ctx.Date.now());
});

// ───────────── Админка ─────────────

test('админка: неверный пароль и отсутствие пароля', () => {
  const env = createEnv();
  assert.equal(env.post({ action: 'adminState', password: 'wrong' }).error.code, 'AUTH');
  assert.equal(env.post({ action: 'adminState' }).error.code, 'AUTH');
  assert.equal(env.post({ action: 'adminConfirm', password: 'nope', code: 'Б-1000' }).error.code, 'AUTH');
  assert.equal(env.admin('adminState').ok, true);
  const noPass = createEnv();
  noPass.props.delete('ADMIN_PASSWORD');
  assert.equal(noPass.post({ action: 'adminState', password: '' }).error.code, 'NO_PASSWORD');
});

test('админка: подтверждение, отмена, продление', () => {
  const env = createEnv();
  const r = book(env, { numbers: [1, 2] });
  const code = r.booking.code;

  const ext = env.admin('adminExtend', { code, hours: 2 });
  assert.equal(ext.bookings.find((b) => b.code === code).deadline, env.msk(2, 22));

  const ok = env.admin('adminConfirm', { code });
  assert.equal(ok.bookings.find((b) => b.code === code).status, 'ПОДТВЕРЖДЕНА');
  assert.equal(ok.counts.taken, 2);
  assert.equal(env.get().tickets[0], 't');
  assert.equal(env.get().players[0].items[0][1], 1);

  const cancel = env.admin('adminCancel', { code });
  assert.equal(cancel.counts.free, 63);
  assert.equal(env.admin('adminCancel', { code }).error.code, 'STATE');
});

test('админка: ручная бронь — сразу подтверждённая и с таймером', () => {
  const env = createEnv();
  const a = env.admin('adminBook', { name: 'Мария Сидорова', vkUrl: 'vk.com/id55', numbers: [10, 11], mode: 'confirmed', note: 'оплатила в чате' });
  assert.equal(a.ok, true, JSON.stringify(a));
  const ba = a.bookings[0];
  assert.equal(ba.status, 'ПОДТВЕРЖДЕНА');
  assert.equal(ba.source, 'админ');
  assert.equal(ba.deadline, null);

  const t = env.admin('adminBook', { name: 'Олег', numbers: [12], mode: 'timer' });
  const bt = t.bookings.find((b) => b.name === 'Олег');
  assert.equal(bt.status, 'ОЖИДАЕТ');
  assert.equal(bt.deadline, env.msk(2, 20));

  assert.equal(env.admin('adminBook', { name: 'Занято', numbers: [10], mode: 'confirmed' }).error.code, 'TAKEN');
  assert.equal(env.admin('adminBook', { name: '', numbers: [20], mode: 'confirmed' }).error.code, 'NEED_NAME');
  assert.equal(env.admin('adminBook', { name: 'Х Y', numbers: [20], vkUrl: 'bad link!', mode: 'confirmed' }).error.code, 'BAD_VK');
});

test('админка: блок и разблок номерков', () => {
  const env = createEnv();
  const b = env.admin('adminBlock', { numbers: [1, 2, 3] });
  assert.equal(b.counts.blocked, 3);
  assert.equal(env.get().tickets[0], 'b');
  assert.equal(book(env, { numbers: [2] }).error.code, 'TAKEN');
  assert.equal(env.admin('adminBlock', { numbers: [2] }).error.code, 'TAKEN', 'нельзя блокировать занятый');
  const u = env.admin('adminUnblock', { numbers: [2] });
  assert.equal(u.counts.blocked, 2);
  assert.equal(book(env, { numbers: [2] }).ok, true);
  assert.equal(env.admin('adminUnblock', { numbers: [40] }).error.code, 'STATE');
});

test('админка: настройки — проверка значений и количество номерков', () => {
  const env = createEnv();
  let r = env.admin('adminSettings', { updates: { eventNumber: '188', eventTitle: 'Эфир про шарниры', ticketCount: 80, confirmHours: '4,5' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const st = env.get();
  assert.equal(st.event.number, '188');
  assert.equal(st.event.title, 'Эфир про шарниры');
  assert.equal(st.tickets.length, 80);
  assert.equal(st.confirmHours, 4.5);

  assert.equal(env.admin('adminSettings', { updates: { quietFrom: '25:99' } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { ticketCount: 'много' } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { ticketCount: 9999 } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { nameFormat: 'как угодно' } }).error.code, 'BAD_SETTING');

  book(env, { numbers: [70] });
  const shrink = env.admin('adminSettings', { updates: { ticketCount: 60 } });
  assert.equal(shrink.error.code, 'BAD_SETTING');
  assert.match(shrink.error.message, /70/);
  assert.equal(env.get().tickets.length, 80, 'ничего не записалось');
});

test('настройки: тихие часы можно изменить и выключить', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { quietFrom: '23:00', quietTo: '08:00' } });
  env.setClock(env.msk(2, 20));
  assert.equal(book(env).booking.deadline, env.msk(3, 11));
  const env2 = createEnv();
  env2.admin('adminSettings', { updates: { quietEnabled: 'НЕТ' } });
  env2.setClock(env2.msk(2, 22));
  assert.equal(book(env2).booking.deadline, env2.msk(3, 4));
});

test('приём броней закрыт', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { bookingOpen: 'НЕТ' } });
  assert.equal(book(env).error.code, 'CLOSED');
  assert.equal(env.get().open, false);
});

test('напоминание о скором истечении оплаченной брони — один раз', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { notifyEmail: 'owner@example.com' } });
  const r = book(env);
  env.post({ action: 'markPaid', clientId: CLIENT_A, code: r.booking.code });
  env.mails.length = 0;
  env.run('PropertiesService.getScriptProperties().deleteProperty("NOTIFY_LAST")');
  env.setClock(env.msk(2, 19, 40));
  env.ctx.tick();
  assert.equal(env.mails.length, 1);
  assert.match(env.mails[0].body, /Скоро истекает/);
  env.advance(3 * MIN); env.ctx.tick();
  assert.equal(env.mails.length, 1, 'повторно не шлём');
});

test('ручное редактирование таблицы: статус «ПОДТВЕРЖДЕНА» руками подхватывается', () => {
  const env = createEnv();
  const r = book(env);
  const row = env.sheets['Брони'].rows.find((x) => x && x[0] === r.booking.code);
  row[6] = 'ПОДТВЕРЖДЕНА';
  env.advance(10 * HOUR);                              // дедлайн давно прошёл, но бронь подтверждена
  env.run('invalidate_()');
  assert.equal(env.get().tickets[0], 't');
});

test('неизвестное действие и битый JSON', () => {
  const env = createEnv();
  assert.equal(env.post({ action: 'hack' }).error.code, 'BAD_ACTION');
  const raw = JSON.parse(env.ctx.doPost({ postData: { contents: '{not json' } }).text);
  assert.equal(raw.error.code, 'BAD_REQUEST');
});

test('защита от HTML в имени', () => {
  const env = createEnv();
  const r = book(env, { name: '<img src=x onerror=alert(1)> Иван', numbers: [3] });
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(env.get()).includes('<'));
});
