const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const CLIENT = 'clientAAAA1111';
const PHOTO = 'https://sun9-12.userapi.com/s/v1/ig2/abc_def.jpg?size=200x200&quality=95&crop=0,0,400,400&ava=1';
const page = (title, img, extra = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} | ВКонтакте</title>
<meta property="og:title" content="${title}"><meta property="og:image" content="${(img || '').replace(/&/g, '&amp;')}">${extra}</head><body></body></html>`;
const book = (env, over = {}) => env.post({ action: 'book', clientId: CLIENT, vkUrl: 'https://vk.com/anna_k', name: 'Анна Кузнецова', numbers: [1], ...over });

test('parseVkHtml_: og-теги, любой порядок атрибутов, сущности, запасной <title>', () => {
  const env = createEnv();
  const parse = (h) => JSON.parse(JSON.stringify(env.ctx.parseVkHtml_(h)));
  assert.deepEqual(parse(page('Анна Кузнецова', PHOTO)), { ok: true, name: 'Анна Кузнецова', photo: PHOTO });
  // content раньше property, одинарные кавычки, числовые сущности
  const r = parse(`<meta content='Иван &#1055;етров' property='og:title'><meta content="${PHOTO.replace(/&/g, '&amp;')}" property="og:image">`);
  assert.equal(r.name, 'Иван Петров');
  assert.equal(r.photo, PHOTO);
  // только <title>
  assert.equal(parse('<title>Мария Орлова | ВКонтакте</title>').name, 'Мария Орлова');
  assert.equal(parse('<title>Мария Орлова — VK</title>').name, 'Мария Орлова');
  // двойное имя с дефисом не режется
  assert.equal(parse('<meta property="og:title" content="Анна-Мария Ли">').name, 'Анна-Мария Ли');
});

test('parseVkHtml_: страницы входа и ошибок не считаются именем', () => {
  const env = createEnv();
  const ok = (h) => env.ctx.parseVkHtml_(h).ok;
  assert.equal(ok('<title>ВКонтакте | Вход</title>'), false);
  assert.equal(ok('<title>Вход | ВКонтакте</title>'), false);
  assert.equal(ok('<title>VK</title>'), false);
  assert.equal(ok('<title>Страница удалена или ещё не создана</title>'), false);
  assert.equal(ok('<html></html>'), false);
  assert.equal(ok('<meta property="og:title" content="Vkusnyashka Ivanova">'), true, 'имя, начинающееся на «vk», допустимо');
});

test('фото: только https-картинки с серверов ВК, без заглушек', () => {
  const env = createEnv();
  const c = (u) => env.ctx.cleanPhoto_(u);
  assert.equal(c(PHOTO), PHOTO);
  assert.equal(c('https://pp.userapi.com/c1/a.jpg'), 'https://pp.userapi.com/c1/a.jpg');
  assert.equal(c('http://sun9-1.userapi.com/a.jpg'), '');
  assert.equal(c('javascript:alert(1)'), '');
  assert.equal(c('https://evil.example.com/a.jpg'), '');
  assert.equal(c('https://userapi.com.evil.com/a.jpg'), '');
  assert.equal(c('https://vk.com/images/camera_200.png'), '');
  assert.equal(c('https://sun9-1.userapi.com/a.jpg" onerror="x'), '');
});

test('без токена: имя и фото берутся со страницы профиля', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Анна Кузнецова', PHOTO) });
  const r = book(env, { name: 'Подмена', numbers: [1, 2] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.booking.name, 'Анна К.', 'имя со страницы, а не из формы');
  const st = env.get();
  assert.equal(st.players[0].name, 'Анна К.');
  assert.equal(st.players[0].photo, PHOTO);
  const adm = env.admin('adminState');
  assert.equal(adm.bookings[0].photo, PHOTO);
  assert.equal(adm.bookings[0].source, 'сайт (ВК)');
});

test('кириллица в windows-1251 декодируется правильно', () => {
  const env = createEnv();
  const good = page('Елена Ёлкина', PHOTO);
  env.htmlHandler = () => ({
    status: 200, headers: { 'content-type': 'text/html; charset=windows-1251' },
    byCharset: { 'windows-1251': good, 'UTF-8': '\uFFFD\uFFFD\uFFFD' }
  });
  const r = book(env);
  assert.equal(r.booking.name, 'Елена Ё.');
});

test('кодировка из <meta charset>, если в заголовке её нет', () => {
  const env = createEnv();
  const good = page('Олег Смирнов', PHOTO).replace('charset="utf-8"', 'charset="windows-1251"');
  env.htmlHandler = () => ({ status: 200, byCharset: { 'UTF-8': good, 'windows-1251': good } });
  assert.equal(book(env).booking.name, 'Олег С.');
  assert.ok(env.fetches.length >= 1);
});

test('vk.com не отдал страницу → пробуем m.vk.com', () => {
  const env = createEnv();
  env.htmlHandler = (url) => (url.startsWith('https://m.vk.com/') ? { status: 200, body: page('Вера Петрова', PHOTO) } : { status: 403 });
  const r = book(env);
  assert.equal(r.booking.name, 'Вера П.');
  assert.deepEqual(env.fetches, ['https://vk.com/anna_k', 'https://m.vk.com/anna_k']);
});

test('страница входа / недоступна / 404 → просим имя вручную (не «профиль не найден»)', () => {
  for (const handler of [
    () => ({ status: 200, body: '<title>ВКонтакте | Вход</title>' }),
    () => ({ status: 404 }),
    () => ({ status: 429 }),
    () => { throw new Error('timeout'); }
  ]) {
    const env = createEnv();
    env.htmlHandler = handler;
    const r = book(env, { name: '' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'NEED_NAME');
    assert.equal(r.error.needName, true);
    const manual = book(env, { name: 'Анна Кузнецова' });
    assert.equal(manual.ok, true);
    assert.equal(manual.booking.name, 'Анна К.');
    assert.equal(env.get().players[0].photo, '', 'без фото — буква в кружке');
  }
});

test('результат кэшируется: повторный запрос не ходит в ВК', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Анна Кузнецова', PHOTO) });
  env.post({ action: 'resolveVk', clientId: CLIENT, vkUrl: 'vk.com/anna_k' });
  const n = env.fetches.length;
  assert.ok(n >= 1);
  const r = env.post({ action: 'resolveVk', clientId: CLIENT, vkUrl: 'https://vk.com/Anna_K' });
  assert.equal(r.display, 'Анна К.');
  assert.equal(r.photo, PHOTO);
  assert.equal(book(env).ok, true);
  assert.equal(env.fetches.length, n, 'новых запросов нет');
});

test('неудача тоже кэшируется на 5 минут, потом пробуем снова', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 403 });
  env.post({ action: 'resolveVk', clientId: CLIENT, vkUrl: 'vk.com/anna_k' });
  const n = env.fetches.length;
  env.post({ action: 'resolveVk', clientId: CLIENT, vkUrl: 'vk.com/anna_k' });
  assert.equal(env.fetches.length, n);
  env.advance(6 * 60000);
  env.htmlHandler = () => ({ status: 200, body: page('Анна Кузнецова', PHOTO) });
  assert.equal(env.post({ action: 'resolveVk', clientId: CLIENT, vkUrl: 'vk.com/anna_k' }).display, 'Анна К.');
});

test('числовые ссылки и profile.php тоже разбираются', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Анна Кузнецова', PHOTO) });
  for (const link of ['https://vk.com/id12345', 'vk.com/profile.php?id=12345', 'https://m.vk.com/id12345?from=search']) {
    const r = env.post({ action: 'resolveVk', clientId: CLIENT, vkUrl: link });
    assert.equal(r.ok, true, link);
    assert.equal(r.display, 'Анна К.');
  }
  assert.ok(env.fetches.every((u) => /vk\.com\/id12345$/.test(u)));
});

test('с токеном: API возвращает имя и фото; «не найден» — окончательный ответ', () => {
  const env = createEnv({ props: { VK_TOKEN: 'tok' } });
  env.vkHandler = (url) => {
    assert.ok(url.includes('photo_200'));
    return { response: [{ id: 777, first_name: 'Анна', last_name: 'Кузнецова', photo_200: PHOTO }] };
  };
  const r = book(env);
  assert.equal(r.ok, true);
  assert.equal(env.get().players[0].photo, PHOTO);
  const env2 = createEnv({ props: { VK_TOKEN: 'tok' } });
  env2.vkHandler = () => ({ response: [] });
  env2.htmlHandler = () => ({ status: 200, body: page('Кто-то Другой', PHOTO) });
  assert.equal(book(env2).error.code, 'VK_NOT_FOUND');
  assert.equal(env2.fetches.filter((u) => !u.includes('api.vk.com')).length, 0, 'страницу после «не найден» не читаем');
});

test('с токеном, но VK API сбоит → запасной путь через страницу', () => {
  const env = createEnv({ props: { VK_TOKEN: 'tok' } });
  env.vkHandler = () => ({ error: { error_code: 6 } });
  env.htmlHandler = () => ({ status: 200, body: page('Анна Кузнецова', PHOTO) });
  assert.equal(book(env).booking.name, 'Анна К.');
});

test('диагностика vkDiagnose_ показывает, что ответил ВК', () => {
  const env = createEnv();
  env.htmlHandler = () => ({ status: 200, body: page('Павел Дуров', PHOTO) });
  const d = JSON.parse(JSON.stringify(env.ctx.vkDiagnose_('https://vk.com/durov')));
  assert.equal(d.parsed.slug, 'durov');
  assert.equal(d.attempts.length, 2);
  assert.equal(d.attempts[0].status, 200);
  assert.equal(d.attempts[0].ogTitle, 'Павел Дуров');
  assert.equal(d.attempts[0].parsed.ok, true);
  assert.equal(JSON.parse(JSON.stringify(env.ctx.testVk())).attempts.length, 2);
});

// ───── Оплата и пост ─────

test('настройки оплаты: ссылка по умолчанию, пост, валидация', () => {
  const env = createEnv();
  const st = env.get();
  assert.equal(st.info.payUrl, 'https://spasibomir.ru/pay/33434');
  assert.equal(st.info.postUrl, '');
  assert.equal(st.info.contact, undefined);

  const r = env.admin('adminSettings', { updates: { postUrl: 'https://vk.com/wall-1_2', payUrl: 'https://spasibomir.ru/pay/999' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const st2 = env.get();
  assert.equal(st2.info.postUrl, 'https://vk.com/wall-1_2');
  assert.equal(st2.info.payUrl, 'https://spasibomir.ru/pay/999');

  assert.equal(env.admin('adminSettings', { updates: { postUrl: 'javascript:alert(1)' } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { payUrl: 'не ссылка' } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { payUrl: '' } }).ok, true, 'можно очистить');
  assert.equal(env.get().info.payUrl, '');
});

test('старый текст-заглушка реквизитов не показывается участникам', () => {
  const env = createEnv();
  env.editSettingInSheet('Реквизиты и инструкция по оплате', 'Укажите здесь реквизиты для доната.');
  env.run('invalidate_()');
  assert.equal(env.get().info.payment, '');
  env.editSettingInSheet('Реквизиты и инструкция по оплате', 'СБП: +7 900 000-00-00');
  env.run('invalidate_()');
  assert.equal(env.get().info.payment, 'СБП: +7 900 000-00-00');
});

test('ответ на бронь содержит ссылки оплаты и поста', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { postUrl: 'https://vk.com/wall-1_2' } });
  const r = env.post({ action: 'book', clientId: CLIENT, vkUrl: 'vk.com/id1', name: 'Анна Кузнецова', numbers: [4, 2, 9] });
  assert.equal(r.info.payUrl, 'https://spasibomir.ru/pay/33434');
  assert.equal(r.info.postUrl, 'https://vk.com/wall-1_2');
  assert.deepEqual(r.booking.numbers, [2, 4, 9]);
});

test('миграция: у существующей таблицы колонки «Фото» и «Эфир» добавляются без потери данных', () => {
  const env = createEnv();
  book(env, { name: 'Анна Кузнецова', numbers: [3] });
  const rows = env.sheets['Брони'].rows;
  env.sheets['Брони'].maxColumns = 15;               // в старой таблице всего 15 колонок
  rows[0] = rows[0].slice(0, 15);                  // как в таблице до обновления
  rows[1] = rows[1].slice(0, 15);
  env.ctx.init();
  assert.equal(env.sheets['Брони'].rows[0].length, 17);
  assert.equal(env.sheets['Брони'].rows[0][15], 'Фото');
  assert.equal(env.sheets['Брони'].rows[0][16], 'Эфир');
  assert.equal(env.get({ action: 'ping' }).ok, true);
  env.run('invalidate_()');
  assert.equal(env.get().tickets[2], 'p');
});

// ───── Оплата без комиссии (от N номерков) ─────

test('оплата без комиссии: значения по умолчанию', () => {
  const env = createEnv();
  const b = env.get().info.bulk;
  assert.equal(b.min, 4);
  assert.equal(b.text, 'Для брони от 4х и более билетов становится доступна оплата без комиссии');
  assert.equal(b.button, 'ЗАПРОСИТЬ РЕКВИЗИТЫ');
  assert.equal(b.url, 'https://vk.ru/im/convo/-227093583?entrypoint=community_page&tab=all');
  // QR и ссылка на оплату остаются
  assert.equal(env.get().info.payUrl, 'https://spasibomir.ru/pay/33434');
});

test('оплата без комиссии: порог, текст кнопки, ссылка настраиваются; {n} подставляется', () => {
  const env = createEnv();
  const r = env.admin('adminSettings', { updates: {
    bulkMin: 6, bulkButton: 'Запросить реквизиты', bulkUrl: 'https://vk.com/im?sel=-1', bulkText: 'Бронь от {n} номерков — без комиссии'
  } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = env.get().info.bulk;
  assert.deepEqual(JSON.parse(JSON.stringify(b)), { min: 6, text: 'Бронь от 6 номерков — без комиссии', button: 'Запросить реквизиты', url: 'https://vk.com/im?sel=-1' });
  const booked = env.post({ action: 'book', clientId: CLIENT, vkUrl: 'vk.com/id1', name: 'Анна Кузнецова', numbers: [1, 2, 3, 4] });
  assert.equal(booked.info.bulk.min, 6, 'в ответе на бронь тоже');
});

test('оплата без комиссии: 0 или пустая ссылка отключают блок, мусорная ссылка отвергается', () => {
  const env = createEnv();
  assert.equal(env.admin('adminSettings', { updates: { bulkMin: 0 } }).ok, true);
  assert.equal(env.get().info.bulk, null);
  env.admin('adminSettings', { updates: { bulkMin: 4, bulkUrl: '' } });
  assert.equal(env.get().info.bulk, null);
  assert.equal(env.admin('adminSettings', { updates: { bulkUrl: 'javascript:alert(1)' } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { bulkMin: -1 } }).error.code, 'BAD_SETTING');
  assert.equal(env.admin('adminSettings', { updates: { bulkMin: 'много' } }).error.code, 'BAD_SETTING');
});

test('оплата без комиссии: настройки появляются в админке и сохраняются в листе', () => {
  const env = createEnv();
  const form = env.admin('adminState').form;
  const keys = form.map((f) => f.key);
  for (const k of ['bulkMin', 'bulkText', 'bulkButton', 'bulkUrl']) assert.ok(keys.includes(k), k);
  env.admin('adminSettings', { updates: { bulkMin: 5 } });
  const row = env.sheets['Настройки'].rows.find((r) => r && r[0] === 'Оплата без комиссии: от скольки номерков');
  assert.equal(row[1], '5');
});

// ───── Надпись «все места забронированы» ─────

const confirmAll = (env, nums) => env.admin('adminBook', { name: 'Гость Тестовый', numbers: nums, mode: 'confirmed' });

test('надпись «все места»: показывается, когда свободных нет и всё подтверждено', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { ticketCount: 5, eventDate: 'в 15:00 28.10.2026' } });
  assert.equal(env.get().overlay, null, 'пока есть свободные');
  confirmAll(env, [1, 2, 3, 4]);
  assert.equal(env.get().overlay, null, 'остался один свободный');
  confirmAll(env, [5]);
  const o = env.get().overlay;
  assert.equal(o.kind, 'soldout');
  assert.equal(o.text, 'Все места забронированы. Прямой эфир проведем в 15:00 28.10.2026');
});

test('надпись «все места»: не показывается, пока есть неподтверждённые брони; исчезает при отмене', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { ticketCount: 3, eventDate: 'в 15:00' } });
  confirmAll(env, [1, 2]);
  const pending = env.admin('adminBook', { name: 'Ожидает Оплату', numbers: [3], mode: 'timer' });
  assert.equal(env.get().overlay, null, 'есть бронь с таймером');
  env.admin('adminConfirm', { code: pending.bookings.find((b) => b.name === 'Ожидает Оплату').code });
  assert.equal(env.get().overlay.kind, 'soldout');
  const code = env.admin('adminState').bookings.find((b) => b.name === 'Ожидает Оплату').code;
  env.admin('adminCancel', { code });
  assert.equal(env.get().overlay, null, 'номерок освободился — надписи нет');
});

test('надпись «все места»: блокировки считаются занятыми; только блокировки — не повод', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { ticketCount: 4 } });
  env.admin('adminBlock', { numbers: [1, 2, 3, 4] });
  assert.equal(env.get().overlay, null, 'все заблокированы, подтверждённых нет');
  env.admin('adminUnblock', { numbers: [3, 4] });
  confirmAll(env, [3, 4]);
  assert.equal(env.get().overlay.kind, 'soldout', '2 заблокированы + 2 подтверждены');
});

test('надпись «все места»: выключатель, свой текст, {date} и {number}, пустая дата', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { ticketCount: 1, eventNumber: '190' } });
  confirmAll(env, [1]);
  env.admin('adminSettings', { updates: { soldOutText: 'Эфир №{number} разобран!\nПрямой эфир {date}' } });
  assert.equal(env.get().overlay.text, 'Эфир №190 разобран!\nПрямой эфир', 'пустая дата не оставляет хвостов');
  env.admin('adminSettings', { updates: { eventDate: '1 ноября в 20:00' } });
  assert.equal(env.get().overlay.text, 'Эфир №190 разобран!\nПрямой эфир 1 ноября в 20:00');
  env.admin('adminSettings', { updates: { soldOutEnabled: 'НЕТ' } });
  assert.equal(env.get().overlay, null);
  env.admin('adminSettings', { updates: { soldOutEnabled: 'ДА', soldOutText: '' } });
  assert.equal(env.get().overlay, null, 'пустой текст — нечего показывать');
});

test('надпись «идёт подтверждение»: только если задан текст', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { ticketCount: 2 } });
  confirmAll(env, [1]);
  env.admin('adminBook', { name: 'Ждёт Оплаты', numbers: [2], mode: 'timer' });
  assert.equal(env.get().overlay, null, 'по умолчанию не показывается');
  env.admin('adminSettings', { updates: { waitText: 'Места разобраны, идёт подтверждение оплаты' } });
  assert.deepEqual(JSON.parse(JSON.stringify(env.get().overlay)), { kind: 'waiting', text: 'Места разобраны, идёт подтверждение оплаты' });
});

test('брони получают колонку «Эфир» с номером текущего эфира', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187' } });
  book(env, { numbers: [1] });
  env.admin('adminBook', { name: 'Ручной Гость', numbers: [2], mode: 'confirmed' });
  env.admin('adminBlock', { numbers: [3] });
  const rows = env.sheets['Брони'].rows.slice(1).filter(Boolean);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r[16] === '187'), JSON.stringify(rows.map((r) => r[16])));
  assert.equal(env.sheets['Брони'].rows[0][16], 'Эфир');
});

// ───── Завершение эфира и архив ─────

test('«Завершить эфир»: брони уходят во вкладку-архив, лист очищается, эфир переключается', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187', eventDate: 'в 15:00 28.10.2026' } });
  const a = book(env, { numbers: [1, 2] });
  env.admin('adminConfirm', { code: a.booking.code });
  env.admin('adminBook', { name: 'Ручной Гость', numbers: [10], mode: 'confirmed' });
  env.admin('adminBlock', { numbers: [30] });

  const r = env.admin('adminArchive', {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.archive.sheet, 'Архив №187');
  assert.equal(r.archive.rows, 2, 'блокировка в архив не попадает');
  assert.equal(r.event.number, '188', 'номер увеличен на 1');

  const arch = env.sheets['Архив №187'];
  assert.ok(arch, 'вкладка создана');
  assert.equal(arch.rows[0][0], 'Код');
  const data = arch.rows.slice(1).filter(Boolean);
  assert.equal(data.length, 2);
  assert.ok(data.every((row) => row[16] === '187'));
  assert.deepEqual(data.map((row) => row[6]).sort(), ['ПОДТВЕРЖДЕНА', 'ПОДТВЕРЖДЕНА']);

  // рабочий лист пуст, сетка свободна, дата сброшена, блокировки сняты вместе с эфиром
  const st = env.get();
  assert.equal(st.event.number, '188');
  assert.equal(st.event.date, '');
  assert.equal(st.counts.free, st.ticketCount);
  assert.equal(st.players.length, 0);
  assert.equal(st.overlay, null);
  assert.ok(!env.sheets['Брони'].rows.slice(1).some((row) => row && row[0]), 'лист «Брони» очищен');
  // новый эфир бронируется как обычно
  assert.equal(book(env, { numbers: [1] }).ok, true);
  assert.equal(env.admin('adminState').bookings[0].status, 'ОЖИДАЕТ');
});

test('«Завершить эфир»: свой номер и дата нового эфира; нечисловой номер не увеличивается', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187' } });
  env.admin('adminBook', { name: 'Гость Ручной', numbers: [1], mode: 'confirmed' });
  const r = env.admin('adminArchive', { newNumber: '200 (юбилейный)', newDate: 'в 20:00 1 декабря' });
  assert.equal(r.event.number, '200 (юбилейный)');
  assert.equal(env.get().event.date, 'в 20:00 1 декабря');
  env.admin('adminBook', { name: 'Гость Ручной', numbers: [1], mode: 'confirmed' });
  const r2 = env.admin('adminArchive', {});
  assert.equal(r2.archive.sheet, 'Архив №200 (юбилейный)');
  assert.equal(r2.event.number, '', 'номер, который нельзя увеличить, остаётся пустым для ввода вручную');
});

test('«Завершить эфир»: неподтверждённые брони — только с подтверждением, попадают в архив как ИСТЕКЛА', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187' } });
  const a = book(env, { numbers: [1] });
  const refused = env.admin('adminArchive', {});
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'PENDING');
  assert.equal(refused.error.pending, 1);
  assert.equal(env.get().tickets[0], 'p', 'ничего не изменилось');
  assert.equal(env.sheets['Архив №187'], undefined);

  const forced = env.admin('adminArchive', { force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.archive.closed, 1);
  const row = env.sheets['Архив №187'].rows[1];
  assert.equal(row[6], 'ИСТЕКЛА');
  assert.match(row[10], /закрыта при завершении эфира/);
  assert.equal(env.get().tickets[0], 'f');
});

test('«Завершить эфир»: повторное имя архива получает суффикс; пустой эфир не создаёт вкладку', () => {
  const env = createEnv();
  env.admin('adminSettings', { updates: { eventNumber: '187' } });
  env.admin('adminBook', { name: 'Гость Один', numbers: [1], mode: 'confirmed' });
  env.admin('adminArchive', { newNumber: '187' });          // номер вернули вручную
  env.admin('adminBook', { name: 'Гость Два', numbers: [1], mode: 'confirmed' });
  const r = env.admin('adminArchive', {});
  assert.equal(r.archive.sheet, 'Архив №187 (2)');
  assert.ok(env.sheets['Архив №187'] && env.sheets['Архив №187 (2)']);
  const empty = env.admin('adminArchive', {});
  assert.equal(empty.ok, true);
  assert.equal(empty.archive.sheet, '');
  assert.equal(empty.archive.rows, 0);
});

test('«Завершить эфир»: нужен пароль админа', () => {
  const env = createEnv();
  assert.equal(env.post({ action: 'adminArchive', password: 'nope' }).error.code, 'AUTH');
});
