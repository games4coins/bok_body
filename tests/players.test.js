/** Игроки: накопительный баланс, пропуски, обмен, закрытие эфира (предпросмотр, откат), импорт. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const PHOTO = 'https://sun9-12.userapi.com/s/v1/ig2/abc_def.jpg?size=200x200&ava=1';
const addPlayer = (env, id, name, balance = 0, misses = 0, extra = {}) =>
  env.admin('adminPlayerAdd', { vkUrl: 'vk.com/id' + id, name, balance, misses, ...extra });
const player = (env, id) => env.admin('adminPlayers').players.find((p) => p.key === String(id));
const bookConfirmed = (env, id, name, nums) => {
  const r = env.post({ action: 'book', clientId: 'client' + String(id).padStart(8, '0'), vkUrl: 'vk.com/id' + id, name, numbers: nums });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(env.admin('adminConfirm', { code: r.booking.code }).ok, true);
};
const close = (env, winners = [], extra = {}) => env.admin('adminArchive', { winners, ...extra });
const ledger = (env) => env.sheets['Операции'].rows.slice(1).filter((r) => r && r[0]);

test('значения по умолчанию: правила обмена и пропусков, пустой список балансов', () => {
  const env = createEnv();
  const st = env.get();
  assert.equal(st.version, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(st.rules)), {
    missLimit: 3, exchangeMin: 30, rate: 200, mode: 'точный',
    url: 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all', button: 'ОБМЕНЯТЬ НА СКИДКУ'
  });
  const b = env.get({ action: 'balances' });
  assert.equal(b.ok, true);
  assert.deepEqual(b.players, []);
  assert.equal(env.admin('adminState').version, 5);
});

test('добавить игрока: стартовый баланс и пропуски, запись в журнал, публичный список', () => {
  const env = createEnv();
  const r = addPlayer(env, 101, 'Анна Кузнецова', 18, 2, { note: 'из старой таблицы' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.player.balance, 18);
  assert.equal(r.player.misses, 2);
  assert.equal(r.player.key, '101');
  const l = ledger(env);
  assert.equal(l.length, 1);
  assert.equal(l[0][3], 'СТАРТОВЫЙ БАЛАНС');
  assert.equal(l[0][4], 18);
  assert.equal(l[0][5], 18);

  const pub = env.get({ action: 'balances' });
  assert.equal(pub.players.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(pub.players[0])), { name: 'Анна К.', photo: '', bal: 18, miss: 2, frozen: false, ex: false, worth: null });
  assert.ok(!JSON.stringify(pub).includes('101'), 'технический ключ не раскрывается');
});

test('добавить игрока: проверки значений и повтор', () => {
  const env = createEnv();
  assert.equal(addPlayer(env, 101, 'Анна Кузнецова', -1).error.code, 'BAD_BALANCE');
  assert.equal(addPlayer(env, 101, 'Анна Кузнецова', 'много').error.code, 'BAD_BALANCE');
  assert.equal(addPlayer(env, 101, 'Анна Кузнецова', 5, 3).error.code, 'BAD_MISSES', 'на 3-м пропуске баланс обнуляется');
  assert.equal(env.admin('adminPlayerAdd', { vkUrl: 'не ссылка', name: 'Х Y' }).error.code, 'BAD_VK');
  assert.equal(env.admin('adminPlayerAdd', { vkUrl: 'vk.com/id999', balance: 1 }).error.code, 'NEED_NAME');
  assert.equal(addPlayer(env, 101, 'Анна Кузнецова', 5).ok, true);
  assert.equal(addPlayer(env, 101, 'Анна Кузнецова', 7).error.code, 'EXISTS');
  assert.equal(player(env, 101).balance, 5, 'повтор ничего не менял');
});

test('добавить игрока по ссылке: имя и фото берутся из профиля ВК', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: `<meta property="og:title" content="Мария Сидорова"><meta property="og:image" content="${PHOTO.replace(/&/g, '&amp;')}">` });
  const r = env.admin('adminPlayerAdd', { vkUrl: 'https://vk.com/maria_s', balance: 3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.player.name, 'Мария Сидорова');
  assert.equal(r.player.photo, PHOTO);
});

test('корректировка баланса: плюс и минус, не ниже нуля, журнал; пропуски; заморозка', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Анна Кузнецова', 10, 1);
  assert.equal(env.admin('adminPlayerAdjust', { key: '101', delta: 5, reason: 'подарок' }).player.balance, 15);
  assert.equal(env.admin('adminPlayerAdjust', { key: '101', delta: -3 }).player.balance, 12);
  assert.equal(env.admin('adminPlayerAdjust', { key: '101', delta: -50 }).error.code, 'NEGATIVE');
  assert.equal(env.admin('adminPlayerAdjust', { key: '101', delta: 0 }).error.code, 'BAD_DELTA');
  assert.equal(env.admin('adminPlayerAdjust', { key: '101', delta: 1.5 }).error.code, 'BAD_DELTA');
  assert.equal(env.admin('adminPlayerAdjust', { key: '404', delta: 1 }).error.code, 'NOT_FOUND');
  assert.equal(player(env, 101).balance, 12);
  const adj = ledger(env).filter((r) => r[3] === 'РУЧНОЕ');
  assert.deepEqual(adj.map((r) => [r[4], r[5], r[9]]), [[5, 15, 'подарок'], [-3, 12, 'ручная корректировка']]);

  assert.equal(env.admin('adminPlayerSetMisses', { key: '101', misses: 2 }).player.misses, 2);
  assert.equal(env.admin('adminPlayerSetMisses', { key: '101', misses: 3 }).error.code, 'BAD_MISSES');
  assert.equal(env.admin('adminPlayerSetMisses', { key: '101', misses: 0 }).player.misses, 0);

  assert.equal(env.admin('adminPlayerFreeze', { key: '101', frozen: true }).player.frozen, true);
  assert.equal(env.get({ action: 'balances' }).players[0].frozen, true);
  assert.equal(env.admin('adminPlayerFreeze', { key: '101', frozen: false }).player.frozen, false);
});

test('публичный список обновляется сразу после правки (кэш сбрасывается)', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Анна Кузнецова', 4);
  assert.equal(env.get({ action: 'balances' }).players[0].bal, 4);
  env.admin('adminPlayerAdjust', { key: '101', delta: 6 });
  assert.equal(env.get({ action: 'balances' }).players[0].bal, 10);
});

test('обмен на скидку: списание по курсу, журнал, проверки', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Анна Кузнецова', 35);
  const r = env.admin('adminExchange', { key: '101', tickets: 30, note: 'код ABC-123' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.discountRub, 6000, '30 × 200 ₽');
  assert.equal(r.player.balance, 5);
  const row = ledger(env).find((x) => x[3] === 'ОБМЕН');
  assert.equal(row[4], -30);
  assert.match(row[9], /скидка 6000 ₽/);
  assert.match(row[9], /ABC-123/);

  env.admin('adminSettings', { updates: { exchangeRate: 250 } });
  addPlayer(env, 102, 'Борис Иванов', 40);
  assert.equal(env.admin('adminExchange', { key: '102', tickets: 10 }).discountRub, 2500, 'курс из настроек');
  assert.equal(env.admin('adminExchange', { key: '102', tickets: 999 }).error.code, 'NEGATIVE');
  assert.equal(env.admin('adminExchange', { key: '102', tickets: 0 }).error.code, 'BAD_TICKETS');
  assert.equal(env.admin('adminExchange', { key: '102', tickets: 'x' }).error.code, 'BAD_TICKETS');
  assert.equal(player(env, 102).balance, 30);
});

test('публичный список участников: баланс, пропуски и ⭐ рядом с именем', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Анна Кузнецова', 31, 0);
  addPlayer(env, 102, 'Борис Иванов', 7, 2);
  bookConfirmed(env, 101, 'Анна Кузнецова', [1, 2]);
  bookConfirmed(env, 102, 'Борис Иванов', [5]);
  env.run('invalidate_()');
  const pl = env.get().players;
  const a = pl.find((p) => p.name === 'Анна К.'), b = pl.find((p) => p.name === 'Борис И.');
  assert.deepEqual([a.bal, a.miss, a.ex, a.frozen], [31, 0, true, false]);
  assert.deepEqual([b.bal, b.miss, b.ex], [7, 2, false]);
  assert.ok(!JSON.stringify(env.get()).includes('"key"'), 'ключи игроков не уходят в публичное состояние');
});

test('режимы показа баланса: ступени и скрыт (пропуски видны всегда)', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Анна Кузнецова', 31, 1);
  addPlayer(env, 102, 'Борис Иванов', 12, 0);
  addPlayer(env, 103, 'Вера Петрова', 3, 2);
  env.admin('adminSettings', { updates: { balanceMode: 'ступени' } });
  const t = env.get({ action: 'balances' }).players;
  assert.deepEqual(t.map((p) => p.bal), ['30+', '10+', '1+']);
  assert.equal(t[0].worth, null, 'в режиме ступеней сумма скидки не показывается');
  env.admin('adminSettings', { updates: { balanceMode: 'скрыт' } });
  const h = env.get({ action: 'balances' }).players;
  assert.ok(h.every((p) => p.bal === null && p.ex === false));
  assert.deepEqual(h.map((p) => p.miss), [1, 0, 2], 'пропуски видны');
  env.admin('adminSettings', { updates: { balanceMode: 'точный' } });
  const x = env.get({ action: 'balances' }).players;
  assert.equal(x[0].worth, 6200, '31 × 200 ₽');
});

test('в публичный список балансов не попадают игроки без баланса и пропусков; порядок по алфавиту', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Вера Петрова', 3);
  addPlayer(env, 102, 'Анна Кузнецова', 0, 0);
  addPlayer(env, 103, 'Борис Иванов', 0, 1);
  const names = env.get({ action: 'balances' }).players.map((p) => p.name);
  assert.deepEqual(names, ['Борис И.', 'Вера П.']);
});

// ───── Закрытие эфира ─────

function scenario(env) {
  addPlayer(env, 201, 'Алла Первая', 10, 0);            // участвует, проиграет → 13
  addPlayer(env, 202, 'Борис Второй', 5, 2);            // не участвует, 3-й пропуск → баланс сгорает
  addPlayer(env, 203, 'Вера Третья', 8, 1, {});         // заморожена → без изменений
  env.admin('adminPlayerFreeze', { key: '203', frozen: true });
  addPlayer(env, 204, 'Глеб Четвёртый', 0, 0);          // нет баланса → без изменений
  addPlayer(env, 205, 'Дарья Пятая', 6, 1);             // не участвует → пропуск 2
  bookConfirmed(env, 201, 'Алла Первая', [1, 2, 3]);
  bookConfirmed(env, 206, 'Егор Победитель', [10, 11]); // новый игрок, выиграет
  bookConfirmed(env, 207, 'Жанна Новая', [20, 21, 22, 23]); // новый игрок, проиграет → 4
}

test('закрытие эфира: предпросмотр совпадает с применением; победитель, проигравшие, пропуски, сгорание, заморозка', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187' } });
  scenario(env);

  const pre = close(env, ['206'], { dryRun: true });
  assert.equal(pre.ok, true, JSON.stringify(pre));
  assert.equal(pre.dryRun, true);
  assert.deepEqual(JSON.parse(JSON.stringify(pre.summary)), { participants: 3, credited: 7, winners: 1, missed: 1, burned: 1, skipped: 0, unconfirmedClosed: 0 });
  assert.equal(player(env, 201).balance, 10, 'предпросмотр ничего не записал');
  assert.equal(env.sheets['Архив №187'], undefined);

  const r = close(env, ['206']);
  assert.equal(r.ok, true, JSON.stringify(r));
  const by = (id) => player(env, id);
  assert.deepEqual([by(201).balance, by(201).misses], [13, 0], 'проигравший: номерки эфира на баланс');
  assert.deepEqual([by(202).balance, by(202).misses], [0, 0], 'третий пропуск обнулил баланс');
  assert.deepEqual([by(203).balance, by(203).misses], [8, 1], 'заморожен — пропуск не считается');
  assert.deepEqual([by(204).balance, by(204).misses], [0, 0], 'без баланса пропуск не считается');
  assert.deepEqual([by(205).balance, by(205).misses], [6, 2], 'первый пропуск → второй');
  assert.deepEqual([by(206).balance, by(206).wins], [0, 1], 'победитель: баланс 0, победа записана');
  assert.deepEqual([by(207).balance, by(207).misses], [4, 0], 'новый игрок получил номерки эфира');
  assert.equal(by(201).bought, 3);
  assert.equal(by(206).bought, 2);
  assert.equal(by(201).last, '187');
  assert.equal(r.event.number, '188');
  assert.equal(r.archive.sheet, 'Архив №187');

  const rows = ledger(env).filter((x) => String(x[8]).startsWith('закрытие эфира'));
  const types = rows.map((x) => x[3]).sort();
  assert.deepEqual(types, ['ВЫИГРЫШ', 'ЭФИР', 'ЭФИР', 'ОБНУЛЕНИЕ ЗА ПРОПУСКИ', 'ПРОПУСК'].sort());
  const burn = rows.find((x) => x[3] === 'ОБНУЛЕНИЕ ЗА ПРОПУСКИ');
  assert.equal(burn[4], -5);
  assert.match(burn[9], /пропуск № 3 подряд/);
  assert.equal(env.get({ action: 'balances' }).players.some((p) => p.name === 'Борис В.'), false);
});

test('закрытие эфира: победителя нужно указать явно; победитель — только участник с подтверждёнными номерками', () => {
  const env = createEnv();
  scenario(env);
  const noArg = env.admin('adminArchive', {});
  assert.equal(noArg.error.code, 'NO_WINNERS');
  assert.equal(close(env, ['201x']).error.code, 'BAD_WINNER');
  assert.equal(close(env, ['202']).error.code, 'BAD_WINNER', 'игрок есть, но в этом эфире не участвовал');
  assert.equal(player(env, 201).balance, 10, 'ничего не изменилось');
  assert.equal(close(env, []).ok, true, 'без победителя — допустимо');
  assert.deepEqual([player(env, 201).balance, player(env, 206).balance, player(env, 206).wins], [13, 2, 0]);
});

test('закрытие эфира: несколько победителей', () => {
  const env = createEnv();
  scenario(env);
  const r = close(env, ['201', '206']);
  assert.equal(r.ok, true);
  assert.deepEqual([player(env, 201).balance, player(env, 201).wins], [0, 1]);
  assert.deepEqual([player(env, 206).balance, player(env, 206).wins], [0, 1]);
  assert.equal(player(env, 207).balance, 4);
});

test('пропуски по цепочке эфиров: счётчик растёт, участие сбрасывает, на 3-м баланс сгорает', () => {
  const env = createEnv();
  addPlayer(env, 301, 'Игрок Тестовый', 6, 0);
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [6, 1]);
  bookConfirmed(env, 301, 'Игрок Тестовый', [1]);
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [7, 0], 'участие сбросило счётчик');
  close(env); close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [7, 2]);
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [0, 0], 'третий подряд — баланс обнулён');
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [0, 0], 'без баланса счётчик не растёт');
});

test('порог пропусков настраивается', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { missLimit: 2 } });
  addPlayer(env, 301, 'Игрок Тестовый', 6, 0);
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [6, 1]);
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [0, 0]);
  assert.equal(addPlayer(env, 302, 'Другой Игрок', 1, 2).error.code, 'BAD_MISSES');
});

test('замороженный игрок не теряет баланс; после разморозки пропуски снова считаются', () => {
  const env = createEnv();
  addPlayer(env, 301, 'Игрок Тестовый', 6, 0);
  env.admin('adminPlayerFreeze', { key: '301', frozen: true });
  close(env); close(env); close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [6, 0]);
  env.admin('adminPlayerFreeze', { key: '301', frozen: false });
  close(env);
  assert.deepEqual([player(env, 301).balance, player(env, 301).misses], [6, 1]);
});

test('закрытие эфира: брони без профиля ВК (ручные) в балансы не попадают, но сообщаются в предпросмотре', () => {
  const env = createEnv();
  env.admin('adminBook', { name: 'Гость Без Профиля', numbers: [40, 41], mode: 'confirmed' });
  bookConfirmed(env, 401, 'Игрок С Профилем', [1]);
  const pre = close(env, [], { dryRun: true });
  assert.equal(pre.summary.skipped, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(pre.skipped)), [{ name: 'Гость Без Профиля', numbers: [40, 41] }]);
  close(env);
  assert.deepEqual(env.admin('adminPlayers').players.map((p) => p.key), ['401']);
});

test('закрытие эфира: неподтверждённые брони — только с force и не дают номерки в баланс', () => {
  const env = createEnv();
  addPlayer(env, 501, 'Игрок Ожидающий', 4, 1);
  env.post({ action: 'book', clientId: 'client00000501', vkUrl: 'vk.com/id501', name: 'Игрок Ожидающий', numbers: [1, 2] });
  assert.equal(close(env, [], { dryRun: true }).error.code, 'PENDING');
  const pre = close(env, [], { dryRun: true, force: true });
  assert.equal(pre.summary.unconfirmedClosed, 1);
  assert.equal(pre.summary.missed, 1, 'без подтверждённых номерков игрок считается пропустившим');
  close(env, [], { force: true });
  assert.deepEqual([player(env, 501).balance, player(env, 501).misses], [4, 2]);
});

test('эфир с блокировками и без броней закрывается, архив не создаётся', () => {
  const env = createEnv();
  env.admin('adminBlock', { numbers: [1, 2] });
  const r = close(env);
  assert.equal(r.ok, true);
  assert.equal(r.archive.sheet, '');
  assert.equal(r.counts.blocked, 0);
});

// ───── Откат ─────

test('откат закрытия: игроки, брони, номер эфира, журнал и архив возвращаются как были', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187', eventDate: 'в 15:00 28.10.2026' } });
  scenario(env);
  env.admin('adminBlock', { numbers: [60] });
  const playersBefore = JSON.stringify(env.admin('adminPlayers').players);
  const bookingsBefore = JSON.stringify(env.admin('adminState').bookings.map((b) => [b.code, b.status, b.numbers]));
  const ledgerBefore = ledger(env).length;
  assert.equal(env.admin('adminState').undo, null);

  const r = close(env, ['206']);
  assert.equal(r.undo.possible, true);
  assert.equal(r.undo.event, '187');
  assert.equal(r.undo.archive, 'Архив №187');
  assert.notEqual(JSON.stringify(env.admin('adminPlayers').players), playersBefore);

  const u = env.admin('adminUndoClose');
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(JSON.stringify(env.admin('adminPlayers').players.map((p) => ({ ...p, updated: 0 }))), JSON.stringify(JSON.parse(playersBefore).map((p) => ({ ...p, updated: 0 }))));
  assert.equal(JSON.stringify(u.bookings.map((b) => [b.code, b.status, b.numbers])), bookingsBefore);
  assert.equal(u.event.number, '187');
  assert.equal(env.get().event.date, 'в 15:00 28.10.2026');
  assert.equal(env.sheets['Архив №187'], undefined, 'архив удалён');
  assert.equal(ledger(env).length, ledgerBefore, 'записи закрытия убраны из журнала');
  assert.equal(u.undo, null);
  assert.equal(env.get().tickets[59], 'b', 'блокировка вернулась');
  assert.equal(env.admin('adminUndoClose').error.code, 'NO_UNDO', 'повторный откат невозможен');
  // и эфир можно закрыть заново
  assert.equal(close(env, ['206']).ok, true);
});

test('откат закрытия блокируется, если после закрытия что-то менялось', () => {
  const env = createEnv();
  scenario(env);
  close(env, ['206']);
  env.post({ action: 'book', clientId: 'client00000999', vkUrl: 'vk.com/id999', name: 'Новый Участник', numbers: [1] });
  const a = env.admin('adminUndoClose');
  assert.equal(a.error.code, 'UNDO_BLOCKED');
  assert.match(a.error.message, /новые брони/);
  assert.equal(env.admin('adminState').undo.possible, false);

  const env2 = createEnv();
  scenario(env2);
  close(env2, ['206']);
  env2.admin('adminPlayerAdjust', { key: '201', delta: 1 });
  const b = env2.admin('adminUndoClose');
  assert.equal(b.error.code, 'UNDO_BLOCKED');
  assert.match(b.error.message, /меняли игроков/);
});

test('откат: данные с датами и текстовыми номерами не искажаются', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187' } });
  const a = env.post({ action: 'book', clientId: 'client00000001', vkUrl: 'vk.com/id1', name: 'Анна Кузнецова', numbers: [1, 5, 12] });
  env.admin('adminConfirm', { code: a.booking.code });
  const rowBefore = JSON.stringify(env.sheets['Брони'].rows[1]);
  close(env);
  env.admin('adminUndoClose');
  assert.equal(JSON.stringify(env.sheets['Брони'].rows[1]), rowBefore);
});

// ───── Импорт ─────

const fillImport = (env, rows) => { rows.forEach((r, i) => { env.sheets['Импорт'].rows[i + 1] = r; }); };

test('импорт: проверка без записи, затем создание и обновление, результат в таблице', () => {
  const env = createEnv();
  addPlayer(env, 601, 'Старый Игрок', 5, 1);
  fillImport(env, [
    ['vk.com/id601', '', '12', '2', 'обновили', ''],
    ['vk.com/id602', 'Новый Игрок', '8', '1', '', ''],
    ['vk.com/id603', 'Без Чисел', '', '', '', ''],
    ['', 'Без Ссылки', '3', '', '', ''],
    ['vk.com/id604', 'Плохой Баланс', 'много', '', '', ''],
    ['vk.com/id605', 'Много Пропусков', '3', '3', '', '']
  ]);
  const dry = env.admin('adminImport', { dryRun: true });
  assert.equal(dry.ok, true, JSON.stringify(dry));
  assert.equal(dry.created, 3);
  assert.equal(dry.errors, 3);
  assert.equal(player(env, 602), undefined, 'проверка не записывает');
  assert.equal(env.sheets['Импорт'].rows[1][5], '');

  const r = env.admin('adminImport', {});
  assert.deepEqual([r.created, r.updated, r.errors], [2, 1, 3]);
  assert.deepEqual([player(env, 601).balance, player(env, 601).misses, player(env, 601).note], [12, 2, 'обновили']);
  assert.deepEqual([player(env, 602).balance, player(env, 602).misses, player(env, 602).name], [8, 1, 'Новый Игрок']);
  assert.deepEqual([player(env, 603).balance, player(env, 603).misses], [0, 0]);
  assert.equal(env.sheets['Импорт'].rows[1][5], 'ок: обновлён');
  assert.equal(env.sheets['Импорт'].rows[2][5], 'ок: создан');
  assert.match(env.sheets['Импорт'].rows[4][5], /нет ссылки/);
  assert.match(env.sheets['Импорт'].rows[5][5], /баланс/);
  assert.match(env.sheets['Импорт'].rows[6][5], /пропусков/);
  assert.ok(r.problems.length === 3);
  const imp = ledger(env).filter((x) => x[3] === 'ИМПОРТ');
  assert.equal(imp.length, 3);
  assert.equal(imp.find((x) => x[2] === '601')[4], 7, 'изменение 5 → 12');

  const again = env.admin('adminImport', {});
  assert.equal(again.skipped, 3, 'уже обработанные строки пропускаются');
  assert.equal(again.created + again.updated, 0);
  const forced = env.admin('adminImport', { force: true });
  assert.equal(forced.updated, 3);
});

test('импорт: режим «добавить» прибавляет к балансу', () => {
  const env = createEnv();
  addPlayer(env, 601, 'Старый Игрок', 5);
  fillImport(env, [['vk.com/id601', '', '10', '', '', '']]);
  env.admin('adminImport', { mode: 'add' });
  assert.equal(player(env, 601).balance, 15);
});

test('импорт: имя и фото из профиля ВК, пустой лист', () => {
  const env = createEnv();
  assert.equal(env.admin('adminImport', {}).error.code, 'EMPTY');
  env.htmlHandler = () => ({ status: 200, body: `<meta property="og:title" content="Мария Сидорова"><meta property="og:image" content="${PHOTO.replace(/&/g, '&amp;')}">` });
  fillImport(env, [['https://vk.com/maria_s', '', '4', '', '', '']]);
  env.admin('adminImport', {});
  const p = env.admin('adminPlayers').players[0];
  assert.equal(p.name, 'Мария Сидорова');
  assert.equal(p.photo, PHOTO);
});

// ───── Совместимость и защита ─────

test('таблица без листов игроков (сервер обновили, init не запускали): всё работает, листы создаются по требованию', () => {
  const env = createEnv();
  for (const n of ['Игроки', 'Операции', 'Импорт', 'Откат']) delete env.sheets[n];
  assert.equal(env.get().ok, true);
  assert.deepEqual(env.get({ action: 'balances' }).players, []);
  assert.equal(env.admin('adminState').ok, true);
  assert.equal(addPlayer(env, 101, 'Анна Кузнецова', 5).ok, true);
  assert.ok(env.sheets['Игроки'] && env.sheets['Операции']);
  assert.equal(env.get({ action: 'balances' }).players.length, 1);
});

test('действия с игроками требуют пароль админа', () => {
  const env = createEnv();
  for (const a of ['adminPlayers', 'adminPlayerAdd', 'adminPlayerAdjust', 'adminPlayerSetMisses', 'adminPlayerFreeze', 'adminPlayerHistory', 'adminExchange', 'adminImport', 'adminUndoClose', 'adminResolveVk']) {
    assert.equal(env.post({ action: a, password: 'nope' }).error.code, 'AUTH', a);
  }
});

test('история игрока из журнала', () => {
  const env = createEnv();
  addPlayer(env, 101, 'Анна Кузнецова', 10);
  env.admin('adminPlayerAdjust', { key: '101', delta: 5, reason: 'подарок' });
  env.admin('adminExchange', { key: '101', tickets: 15 });
  addPlayer(env, 102, 'Борис Иванов', 3);
  const h = env.admin('adminPlayerHistory', { key: '101' }).history;
  assert.deepEqual(h.map((x) => x.type), ['ОБМЕН', 'РУЧНОЕ', 'СТАРТОВЫЙ БАЛАНС']);
  assert.deepEqual(h.map((x) => x.balance), [0, 15, 10]);
});

test('настройки обмена: курс, порог, кнопка, ссылка, режим; предупреждение о нераспознанном', () => {
  const env = createEnv();
  const r = env.admin('adminSettings', { updates: { exchangeRate: 150, exchangeMin: 20, exchangeButton: 'Обменять', exchangeUrl: 'https://vk.com/im?sel=-1', missLimit: 4, balanceMode: 'ступени' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(JSON.parse(JSON.stringify(env.get().rules)), { missLimit: 4, exchangeMin: 20, rate: 150, mode: 'ступени', url: 'https://vk.com/im?sel=-1', button: 'Обменять' });
  assert.equal(env.admin('adminSettings', { updates: { exchangeUrl: 'javascript:1' } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { missLimit: 0 } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { balanceMode: 'как-то' } }).error.code, 'BAD_SETTING');
});

test('ручная бронь админа: определение профиля по ссылке отдельным запросом (для формы)', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: `<meta property="og:title" content="Мария Сидорова"><meta property="og:image" content="${PHOTO.replace(/&/g, '&amp;')}">` });
  const r = env.admin('adminResolveVk', { vkUrl: 'https://vk.com/maria_s' });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true, name: 'Мария Сидорова', display: 'Мария С.', photo: PHOTO, key: 'maria_s' });
  const env2 = createEnv();
  assert.equal(env2.admin('adminResolveVk', { vkUrl: 'vk.com/maria_s' }).error.needName, true);
  assert.equal(env2.admin('adminResolveVk', { vkUrl: 'bad link' }).error.code, 'BAD_VK');
});
