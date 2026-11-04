/** Регрессии: «бронь не найдена» при подтверждении и имя при ручной брони админом. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const MIN = 60000;
const A = 'clientAAAA1111', B = 'clientBBBB2222';
const PHOTO = 'https://sun9-12.userapi.com/s/v1/ig2/abc.jpg?size=200x200';
const page = (t) => `<title>${t} | ВКонтакте</title><meta property="og:title" content="${t}"><meta property="og:image" content="${PHOTO}">`;
const book = (env, c = A) => env.post({ action: 'book', clientId: c, vkUrl: 'vk.com/id1001', name: 'Анна Кузнецова', numbers: [5] });

test('бронь → «оплата заявлена» работает в любой час суток, в том числе ночью', () => {
  for (const h of [0.25, 3, 8.9, 9, 12, 23.9]) {
    const env = createEnv();
    env.setClock(env.msk(2, 0) + h * 60 * MIN);
    const b = book(env);
    assert.equal(b.ok, true);
    const p = env.post({ action: 'markPaid', clientId: A, code: b.booking.code });
    assert.equal(p.ok, true, 'час ' + h + ': ' + JSON.stringify(p.error));
    assert.equal(env.admin('adminState').bookings[0].status, 'ОПЛАТА ЗАЯВЛЕНА');
  }
});

test('«оплата заявлена» из другого браузера (id сменился) проходит по коду брони, бронь не теряется', () => {
  const env = createEnv();
  const b = book(env);
  const p = env.post({ action: 'markPaid', clientId: B, code: b.booking.code });
  assert.equal(p.ok, true, JSON.stringify(p.error));
  assert.equal(env.admin('adminState').bookings[0].status, 'ОПЛАТА ЗАЯВЛЕНА');
});

test('отмена брони по-прежнему только из того же браузера', () => {
  const env = createEnv();
  const b = book(env);
  assert.equal(env.post({ action: 'cancelMine', clientId: B, code: b.booking.code }).error.code, 'NOT_FOUND');
  assert.equal(env.post({ action: 'cancelMine', clientId: A, code: b.booking.code }).ok, true);
});

test('несуществующий код: понятное сообщение и запись в журнале', () => {
  const env = createEnv();
  const p = env.post({ action: 'markPaid', clientId: A, code: 'Б-0000' });
  assert.equal(p.error.code, 'NOT_FOUND');
  assert.match(p.error.message, /не найдена/);
  assert.ok(env.sheets['Журнал'].rows.some((r) => String(r[2]).includes('бронь не найдена')));
});

test('если строка брони не записалась в таблицу — участнику не показывают «успех»', () => {
  const env = createEnv();
  const sh = env.sheets['Брони'];
  const orig = sh.appendRow.bind(sh);
  sh.appendRow = () => { /* запись потерялась */ };
  const b = book(env);
  assert.equal(b.ok, false);
  assert.equal(b.error.code, 'SERVER');
  sh.appendRow = orig;
  assert.equal(book(env).ok, true, 'после сбоя номерок не «застрял»');
});

test('ручная бронь: после неудачной попытки админ может повторить — отрицательный кэш ВК не мешает', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 403 });
  const first = env.admin('adminResolveVk', { vkUrl: 'vk.com/maria_s' });
  assert.equal(first.ok, false);
  env.htmlHandler = () => ({ status: 200, body: page('Мария Сидорова') });
  const again = env.admin('adminResolveVk', { vkUrl: 'vk.com/maria_s' });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.name, 'Мария Сидорова');
  assert.equal(again.photo, PHOTO);
  env.htmlHandler = () => ({ status: 403 });
  env.admin('adminBook', { vkUrl: 'vk.com/maria_s', numbers: [3], mode: 'confirmed' });   // из кэша успеха
  assert.equal(env.admin('adminState').bookings[0].name, 'Мария Сидорова');
});

test('adminResolveVk не ограничивается по частоте и не требует clientId', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Мария Сидорова') });
  for (let i = 0; i < 40; i++) assert.equal(env.admin('adminResolveVk', { vkUrl: 'vk.com/id' + (100 + i) }).ok, true);
});

test('ручная бронь: игрок выбран из базы — ВК не опрашивается, ключ игрока сохраняется (баланс потом зачтётся)', () => {
  const env = createEnv();
  env.admin('adminPlayerAdd', { vkUrl: 'vk.com/id601', name: 'Старый Игрок', balance: 5, misses: 1 });
  const key = env.admin('adminPlayers').players[0].key;
  const before = env.fetches.length;
  env.htmlHandler = () => ({ status: 403 });
  const r = env.admin('adminBook', { playerKey: key, name: 'Старый Игрок', vkUrl: 'https://vk.com/id601', numbers: [7, 8], mode: 'confirmed' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(env.fetches.length, before, 'запросов к ВК нет');
  const b = r.bookings[0];
  assert.equal(b.key, key);
  assert.equal(b.name, 'Старый Игрок');
  assert.equal(b.status, 'ПОДТВЕРЖДЕНА');
});

test('публичный список игроков: только имя в принятом формате, фото и id; ссылки ВК не отдаются', () => {
  const env = createEnv();
  env.admin('adminPlayerAdd', { vkUrl: 'vk.com/id601', name: 'Анна Кузнецова', balance: 5 });
  env.admin('adminPlayerAdd', { vkUrl: 'vk.com/id602', name: 'Борис Иванов', balance: 0 });
  const r = env.get({ action: 'players' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.players.map((p) => p.name), ['Анна К.', 'Борис И.']);
  assert.ok(!JSON.stringify(r).includes('vk.com'), 'ссылки не раскрываются');
});

test('бронь участником «из списка»: без ссылки и без запросов к ВК, привязка к игроку, лимиты действуют', () => {
  const env = createEnv();
  env.admin('adminPlayerAdd', { vkUrl: 'vk.com/id601', name: 'Анна Кузнецова', balance: 5 });
  const id = env.get({ action: 'players' }).players[0].id;
  const before = env.fetches.length;
  const r = env.post({ action: 'book', clientId: A, playerKey: id, numbers: [4, 5] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(env.fetches.length, before);
  const b = env.admin('adminState').bookings[0];
  assert.equal(b.key, id);
  assert.equal(b.name, 'Анна Кузнецова');
  assert.equal(env.post({ action: 'book', clientId: A, playerKey: 'нет-такого', numbers: [9] }).error.code, 'PLAYER_NOT_FOUND');
  assert.equal(env.post({ action: 'book', clientId: A, playerKey: id, numbers: [4] }).error.code, 'TAKEN');
  const pub = env.get().players.find((p) => p.name === 'Анна К.');
  assert.equal(pub.bal, 5, 'в списке участников у неё виден баланс');
});
