/**
 * Тихие часы и ручная бронь по ссылке ВК.
 * Расчёт дедлайна сверяется с независимой «посекундной» симуляцией, а не с теми же функциями, что в коде.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const MIN = 60000, DAY = 86400000;
const CLIENT = 'clientAAAA1111';
const PHOTO = 'https://sun9-12.userapi.com/s/v1/ig2/abc_def.jpg?size=200x200&ava=1';
const book = (env, over = {}) => env.post({ action: 'book', clientId: CLIENT, vkUrl: 'vk.com/id1001', name: 'Анна Кузнецова', numbers: [1], ...over });
const page = (title, img) => `<title>${title} | ВКонтакте</title><meta property="og:title" content="${title}"><meta property="og:image" content="${img.replace(/&/g, '&amp;')}">`;
const LABEL_FROM = 'Тихие часы: с', LABEL_TO = 'Тихие часы: до';

function oracle(start, minutes, q) {
  const target = minutes * MIN, from = q.fromMin * MIN, to = q.toMin * MIN;
  const quiet = (ms) => { const d = (((ms + q.offsetMin * MIN) % DAY) + DAY) % DAY; return q.enabled && from !== to && (from < to ? d >= from && d < to : d >= from || d < to); };
  let t = start, active = 0;
  while (active < target) { if (!quiet(t)) active += 1000; t += 1000; }
  return t;
}

test('дедлайн совпадает с независимой посекундной симуляцией (любая секунда, разные окна)', () => {
  const env = createEnv();
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const configs = [
    { enabled: true, fromMin: 0, toMin: 540, offsetMin: 180 },
    { enabled: true, fromMin: 23 * 60, toMin: 8 * 60, offsetMin: 180 },
    { enabled: true, fromMin: 22 * 60 + 30, toMin: 7 * 60 + 15, offsetMin: 180 },
    { enabled: true, fromMin: 0, toMin: 540, offsetMin: 300 }
  ];
  for (const q of configs) for (let i = 0; i < 80; i++) {
    const start = Date.UTC(2026, 8, 2) + Math.floor(rnd() * 3 * 86400) * 1000;
    const minutes = [30, 90, 360, 600][Math.floor(rnd() * 4)];
    assert.equal(env.ctx.addActiveMinutes(start, minutes, q), oracle(start, minutes, q), JSON.stringify([q, start, minutes]));
  }
});

test('ночь насквозь: бронь, созданная в любое время, не истекает в тихие часы и получает ровно 6 активных часов', () => {
  const q = { enabled: true, fromMin: 0, toMin: 540, offsetMin: 180 };
  for (let startMin = 20 * 60; startMin <= 33 * 60 + 30; startMin += 37) {            // с 20:00 до 09:30 следующего дня
    const env = createEnv();
    env.setClock(env.msk(2, 0) + startMin * MIN);
    const created = env.ctx.Date.now();
    assert.equal(book(env).ok, true);
    let expiredAt = null;
    for (let t = 0; t < 40 * 60 && expiredAt === null; t += 5) {
      env.advance(5 * MIN);
      env.ctx.tick();
      if (env.admin('adminState').bookings[0].status === 'ИСТЕКЛА') expiredAt = env.ctx.Date.now();
    }
    const at = new Date(created).toISOString();
    assert.ok(expiredAt !== null, 'бронь должна истечь: ' + at);
    assert.equal(env.ctx.isQuietAt(expiredAt, q), false, 'истекла посреди тихих часов: ' + at);
    const active = env.ctx.activeMinutesBetween(created, expiredAt, q);
    assert.ok(active >= 360 - 1e-6 && active <= 366, `активного времени ${active} мин, старт ${at}`);
  }
});

test('бронь на границе (18:00 + 6 ч → дедлайн 00:00) не истекает ночью, а только после окончания тихих часов', () => {
  const env = createEnv();
  env.setClock(env.msk(2, 18));
  const r = book(env);
  assert.equal(r.booking.deadline, env.msk(3, 0));
  for (const [h, m] of [[0, 1], [3, 0], [8, 59]]) {
    env.setClock(env.msk(3, h, m)); env.ctx.tick();
    assert.equal(env.admin('adminState').bookings[0].status, 'ОЖИДАЕТ', `в ${h}:${m} ещё ждёт`);
  }
  env.setClock(env.msk(3, 9, 1)); env.ctx.tick();
  assert.equal(env.admin('adminState').bookings[0].status, 'ИСТЕКЛА');
});

test('бронь с дедлайном внутри тихих часов (создана до включения окна) тоже не сгорает ночью', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { quietEnabled: 'НЕТ' } });
  env.setClock(env.msk(2, 20));
  book(env);                                                    // дедлайн 02:00
  env.admin('adminSettings', { updates: { quietEnabled: 'ДА' } });
  env.setClock(env.msk(3, 2, 30)); env.ctx.tick();
  assert.equal(env.admin('adminState').bookings[0].status, 'ОЖИДАЕТ');
  assert.equal(env.get().tickets[0], 'p');
  env.setClock(env.msk(3, 9, 2)); env.ctx.tick();
  assert.equal(env.admin('adminState').bookings[0].status, 'ИСТЕКЛА');
});

test('тихие часы выключены — истекает ровно по дедлайну, в том числе ночью', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { quietEnabled: 'НЕТ' } });
  env.setClock(env.msk(2, 20));
  book(env);
  env.setClock(env.msk(3, 2, 1)); env.ctx.tick();
  assert.equal(env.admin('adminState').bookings[0].status, 'ИСТЕКЛА');
});

test('время в таблице в любом привычном виде не отключает тихие часы', () => {
  for (const [from, to] of [['00:00', '09:00'], ['0:00', '9:00'], ['00:00:00', '09:00:00'], ['0', '9'], ['00.00', '09.00'], ['00-00', '09-00'], [' 00:00 ', ' 09:00 ']]) {
    const env = createEnv();
    env.sheets['Настройки'].rows.find((r) => r && r[0] === LABEL_FROM)[1] = from;
    env.sheets['Настройки'].rows.find((r) => r && r[0] === LABEL_TO)[1] = to;
    const q = env.get().quiet;
    assert.equal(q.on, true, JSON.stringify([from, to]));
    assert.deepEqual([q.from, q.to], ['00:00', '09:00']);
    env.setClock(env.msk(2, 22));
    assert.equal(book(env).booking.deadline, env.msk(3, 13), 'ночь не считается: ' + JSON.stringify([from, to]));
    assert.deepEqual(env.admin('adminState').warnings, [], 'предупреждений нет');
  }
});

test('нераспознанное время: предупреждение в админке (а не молчаливое отключение)', () => {
  const env = createEnv();
  assert.deepEqual(env.admin('adminState').warnings, [], 'по умолчанию всё чисто');
  env.sheets['Настройки'].rows.find((r) => r && r[0] === LABEL_FROM)[1] = '00;00';
  const w = env.admin('adminState').warnings;
  assert.equal(w.length, 1);
  assert.match(w[0], /Тихие часы: с/);
  assert.match(w[0], /00;00/);
  assert.match(w[0], /круглосуточно/);
  assert.equal(env.get().quiet.on, false);
});

test('предупреждения: не число, не ДА/НЕТ, одинаковые начало и конец окна', () => {
  const env = createEnv();
  const set = (label, v) => { env.sheets['Настройки'].rows.find((r) => r && r[0] === label)[1] = v; };
  set('Часов на подтверждение брони', 'шесть');
  set('Приём броней открыт', 'наверное');
  let w = env.admin('adminState').warnings.join('|');
  assert.match(w, /Часов на подтверждение брони.*шесть/);
  assert.match(w, /Приём броней открыт.*наверное/);
  set('Часов на подтверждение брони', '6'); set('Приём броней открыт', 'ДА');
  set(LABEL_FROM, '09:00');
  w = env.admin('adminState').warnings.join('|');
  assert.match(w, /начало и конец совпадают/);
});

test('форма настроек показывает время как ЧЧ:ММ даже если в ячейке «9:00:00»', () => {
  const env = createEnv();
  env.sheets['Настройки'].rows.find((r) => r && r[0] === LABEL_TO)[1] = '9:00:00';
  const f = env.admin('adminState').form.find((x) => x.key === 'quietTo');
  assert.equal(f.value, '09:00');
});

test('экран: остаток активного времени стоит ночью и убывает днём; сведения о тихих часах', () => {
  const env = createEnv();
  env.setClock(env.msk(2, 22));
  const r = book(env);
  const left = (h, m = 0) => { env.setClock(env.msk(h >= 22 ? 2 : 3, h, m)); return env.get({ action: 'mine', client: CLIENT }).bookings[0].activeLeftMin; };
  assert.equal(r.booking.activeLeftMin, 360);
  assert.equal(left(23), 300);
  assert.equal(left(23, 59), 241);
  const night = [left(0), left(3), left(8, 59)];
  assert.deepEqual(night, [240, 240, 240], 'ночью остаток не меняется');
  assert.equal(left(10), 180);
  assert.equal(left(13), 0);

  env.setClock(env.msk(3, 3));
  const q = env.get({ action: 'mine', client: CLIENT }).quiet;
  assert.equal(q.nowQuiet, true);
  assert.equal(q.resumeAt, env.msk(3, 9));
  assert.equal(q.nextStart, null);
  env.setClock(env.msk(3, 14));
  const q2 = env.get().quiet;
  assert.equal(q2.nowQuiet, false);
  assert.equal(q2.nextStart, env.msk(4, 0));
  assert.equal(q2.resumeAt, null);
});

test('ответ на бронь содержит сведения о тихих часах для экрана', () => {
  const env = createEnv();
  env.setClock(env.msk(2, 14));
  const r = book(env);
  assert.equal(r.quiet.on, true);
  assert.equal(r.quiet.nowQuiet, false);
  assert.equal(r.quiet.nextStart, env.msk(3, 0));
});

// ───── Ручная бронь администратора: профиль ВК ─────

test('ручная бронь по ссылке ВК: имя и фото берутся из профиля, имя вводить не нужно', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Мария Сидорова', PHOTO) });
  const r = env.admin('adminBook', { vkUrl: 'https://vk.com/maria_s', numbers: [10, 11], mode: 'confirmed' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = r.bookings[0];
  assert.equal(b.name, 'Мария Сидорова');
  assert.equal(b.photo, PHOTO);
  assert.equal(b.vkUrl, 'https://vk.com/maria_s');
  assert.equal(b.status, 'ПОДТВЕРЖДЕНА');
  assert.equal(b.source, 'админ');
  const pub = env.get().players[0];
  assert.equal(pub.name, 'Мария С.');
  assert.equal(pub.photo, PHOTO);
});

test('ручная бронь: введённое имя главнее профиля, фото всё равно из ВК', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Мария Сидорова', PHOTO) });
  const r = env.admin('adminBook', { vkUrl: 'vk.com/maria_s', name: 'Маша (мастерская)', numbers: [5], mode: 'timer' });
  assert.equal(r.bookings[0].name, 'Маша (мастерская)');
  assert.equal(r.bookings[0].photo, PHOTO);
  assert.equal(r.bookings[0].status, 'ОЖИДАЕТ');
});

test('ручная бронь с токеном ВК: имя и фото берутся из API', () => {
  const env = createEnv({ props: { VK_TOKEN: 'tok' } });
  env.vkHandler = () => ({ response: [{ id: 777, first_name: 'Анна', last_name: 'Кузнецова', photo_200: PHOTO }] });
  const r = env.admin('adminBook', { vkUrl: 'vk.com/anna_k', numbers: [1], mode: 'confirmed' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.bookings[0].name, 'Анна Кузнецова');
  assert.equal(r.bookings[0].photo, PHOTO);
  assert.ok(env.fetches.some((u) => u.includes('api.vk.com') && u.includes('access_token=tok')));
});

test('ручная бронь: профиль не определился и имя не введено — понятная ошибка; с именем — проходит', () => {
  const env = createEnv();                      // ВК недоступен (403)
  const r = env.admin('adminBook', { vkUrl: 'vk.com/maria_s', numbers: [10], mode: 'confirmed' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NEED_NAME');
  assert.equal(r.error.needName, true);
  const ok = env.admin('adminBook', { vkUrl: 'vk.com/maria_s', name: 'Мария Сидорова', numbers: [10], mode: 'confirmed' });
  assert.equal(ok.ok, true);
  assert.equal(ok.bookings[0].photo, '');
  assert.equal(ok.bookings[0].vkUrl, 'https://vk.com/maria_s');
});

test('ручная бронь: разные формы ссылок разбираются, мусор отклоняется, без ссылки нужно имя', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Мария Сидорова', PHOTO) });
  const links = ['https://vk.com/id12345', 'vk.com/profile.php?id=12345', 'https://m.vk.com/id12345?from=search', 'https://vk.ru/maria_s/', '@maria_s'];
  links.forEach((link, i) => {
    const r = env.admin('adminBook', { vkUrl: link, numbers: [20 + i], mode: 'confirmed' });
    assert.equal(r.ok, true, link + ' → ' + JSON.stringify(r.error));
  });
  assert.equal(env.admin('adminBook', { vkUrl: 'https://example.com/me', numbers: [30], mode: 'confirmed' }).error.code, 'BAD_VK');
  assert.equal(env.admin('adminBook', { vkUrl: 'https://vk.com/club123', numbers: [30], mode: 'confirmed' }).error.code, 'BAD_VK');
  assert.equal(env.admin('adminBook', { numbers: [30], mode: 'confirmed' }).error.code, 'NEED_NAME');
  assert.equal(env.admin('adminBook', { name: 'Гость Ручной', numbers: [30], mode: 'confirmed' }).ok, true);
});

test('ручная бронь: профиль «не найден» через токен — ошибка, номерки не заняты', () => {
  const env = createEnv({ props: { VK_TOKEN: 'tok' } });
  env.vkHandler = () => ({ response: [] });
  const r = env.admin('adminBook', { vkUrl: 'vk.com/nobody_here', name: 'Кто-то', numbers: [10], mode: 'confirmed' });
  assert.equal(r.error.code, 'VK_NOT_FOUND');
  assert.equal(env.get().tickets[9], 'f');
});
