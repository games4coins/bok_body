/* Номерок — публичная страница бронирования. */
(function () {
  'use strict';
  const { h, fill, api, nowMs, tzName, fmtDT, fmtLeft, fmtMin, clientId, store, copyText, toast, avatar, qrSvg, safeUrl, DEMO } = Nomerok;

  const CLIENT = clientId();
  const POLL_MS = 8000;
  const S = { st: null, mine: [], sel: new Set(), search: '', loaded: false };
  const UNCONF = ['ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА'];

  // ───── Скелет страницы (строится один раз) ─────
  const heroEl = h('header', { class: 'hero' });
  const bannerEl = h('div');
  const stepsEl = h('details', { class: 'card', style: { marginTop: '20px' } });
  const mineEl = h('div');
  const gridEl = h('div', { class: 'grid', role: 'group', 'aria-label': 'Номерки' });
  const legendEl = h('div', { class: 'legend' });
  const actionEl = h('div', { class: 'actionbar hidden' });
  const gridCard = h('section', { class: 'card' },
    h('h2', null, 'Выберите свои номерки'),
    h('p', { class: 'lead' }, 'Нажмите на свободные номерки — они подсветятся. Затем нажмите «Забронировать».'),
    gridEl, legendEl, actionEl);
  const countChip = h('span', { class: 'count-chip' }, '0');
  const searchEl = h('input', {
    class: 'input', type: 'search', placeholder: 'Найти имя или номерок', autocomplete: 'off',
    oninput: (e) => { S.search = e.target.value; renderPlayers(); }
  });
  const plistEl = h('div', { class: 'plist' });
  const playersCard = h('aside', { class: 'card players', 'aria-label': 'Список участников' },
    h('div', { class: 'players-head' }, h('h2', null, 'Участники'), countChip), searchEl, plistEl,
    h('div', { class: 'note-foot' }, h('span', { class: 'chip' }, '№'), ' подтверждено  ', h('span', { class: 'chip pend' }, '№'), ' ждёт подтверждения'));

  const layout = h('div', { class: 'layout' }, h('div', null, mineEl, gridCard), playersCard);
  const app = document.getElementById('app');
  fill(app, heroEl, bannerEl, stepsEl, layout,
    h('div', { class: 'footer' }, 'Время указано по часовому поясу организатора.'));
  if (DEMO) document.getElementById('demo').appendChild(h('div', { class: 'demo-flag' },
    'Демо-режим: данные не сохраняются. Админка: admin.html, пароль demo. Укажите API_URL в config.js, чтобы подключить таблицу.'));
  if (window.matchMedia('(min-width: 700px)').matches) stepsEl.open = true;

  // ───── Вспомогательное ─────
  const off = () => (S.st ? S.st.tzOffsetMin : 180);
  const tz = () => tzName(off());
  const myActive = () => S.mine.filter((b) => ['ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА', 'ПОДТВЕРЖДЕНА'].indexOf(b.status) >= 0);
  const myPendingCount = () => S.mine.filter((b) => UNCONF.indexOf(b.status) >= 0).reduce((s, b) => s + b.count, 0);
  const canBook = () => S.st && S.st.open && !S.st.paused;
  const list = (nums) => '№' + nums.join(', №');
  function fmtHours(x) { return Number.isInteger(x) ? x + ' ч' : Math.round(x * 60) + ' мин'; }

  // ───── Модальное окно ─────
  let modal = null;
  function closeModal() { if (modal) { modal.remove(); modal = null; document.removeEventListener('keydown', onEsc); } }
  function onEsc(e) { if (e.key === 'Escape') closeModal(); }
  function openModal(children) {
    closeModal();
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      h('button', { class: 'x', 'aria-label': 'Закрыть', onclick: closeModal }, '✕'), children);
    modal = h('div', { class: 'overlay', onclick: (e) => { if (e.target === modal) closeModal(); } }, sheet);
    document.body.appendChild(modal);
    document.addEventListener('keydown', onEsc);
    return sheet;
  }

  // ───── Отрисовка ─────
  function renderHero() {
    const st = S.st;
    const total = st.counts.total, free = st.counts.free, used = total - free;
    const pct = total ? Math.round((used / total) * 100) : 0;
    document.title = 'Эфир №' + st.event.number + ' — бронирование номерков';
    const status = st.paused ? '⏸ Технический перерыв' : st.open ? '● Бронь открыта' : 'Бронь закрыта';
    fill(heroEl, 
      h('div', { class: 'hero-top' }, h('span', { class: 'pill solid' }, 'Эфир №' + st.event.number), h('span', { class: 'pill' }, status),
        h('a', { class: 'pill admin-link', href: 'admin.html', title: 'Вход для организатора' }, store('nomerok_admin_pw') ? '⚙ Админка' : '🔐 Админ')),
      h('h1', null, st.event.title || 'Прямой эфир'),
      st.event.date ? h('p', { class: 'sub' }, '📅 ' + st.event.date) : null,
      h('div', { class: 'hero-stats' },
        h('div', { class: 'hero-stat' }, h('b', { class: 'num' }, free), h('span', null, 'свободно')),
        h('div', { class: 'hero-stat' }, h('b', { class: 'num' }, used), h('span', null, 'занято')),
        h('div', { class: 'hero-stat' }, h('b', null, st.price), h('span', null, 'номерок'))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'progress-cap' }, 'Занято ' + used + ' из ' + total + ' · ' + pct + '%'));
  }

  function renderBanner() {
    const st = S.st;
    if (st.paused) fill(bannerEl, h('div', { class: 'banner warn' }, h('span', null, '⏸'),
      h('span', null, (st.pauseMessage || 'Технический перерыв.') + ' Уже оформленные брони не сгорят: их таймеры остановлены.')));
    else if (!st.open) fill(bannerEl, h('div', { class: 'banner info' }, h('span', null, 'ℹ️'), h('span', null, 'Приём броней закрыт. Список участников доступен ниже.')));
    else fill(bannerEl);
  }

  function renderSteps() {
    const st = S.st;
    const quiet = st.quiet.on ? ' С ' + st.quiet.from + ' до ' + st.quiet.to + ' (' + tz() + ') время не идёт — ночью можно спать спокойно.' : '';
    fill(stepsEl, 
      h('summary', { style: { cursor: 'pointer', fontWeight: '800', fontSize: '17px' } }, 'Как это работает'),
      h('div', { class: 'steps' },
        step(1, 'Выберите номерки', 'Нажмите на свободные номерки в сетке.'),
        step(2, 'Оставьте ссылку на ВК', 'Имя и фото для списка участников подтянутся из вашего профиля.'),
        step(3, 'Оплатите и подтвердите комментарием', 'Оставьте номерки и скриншот оплаты в комментарии к посту. У вас ' + fmtHours(st.confirmHours) + ' на подтверждение.' + quiet)),
      h('p', { class: 'lead', style: { margin: '14px 0 0' } },
        'Пока бронь не подтверждена, можно держать не более ' + st.limits.pending + ' номерков. После подтверждения лимит обновляется.' +
        (st.limits.total ? ' Всего на одного участника — не больше ' + st.limits.total + '.' : '')));
  }
  function step(n, title, text) {
    return h('div', { class: 'step' }, h('b', { class: 'n' }, n), h('p', null, h('b', null, title), h('small', null, text)));
  }

  const STATUS = {
    'ОЖИДАЕТ': ['s-wait', 'Ждёт подтверждения'],
    'ОПЛАТА ЗАЯВЛЕНА': ['s-paid', 'Оплата заявлена — проверяем'],
    'ПОДТВЕРЖДЕНА': ['s-ok', 'Подтверждена ✓'],
    'ИСТЕКЛА': ['s-off', 'Время вышло']
  };

  function renderMine() {
    if (!S.mine.length) { fill(mineEl); return; }
    fill(mineEl, h('section', { class: 'card mine', style: { marginBottom: '20px' } },
      h('h2', null, 'Ваши брони'), S.mine.map(mineItem)));
    tickTimers();
  }

  function mineItem(b) {
    const [cls, label] = STATUS[b.status] || ['s-off', b.status];
    const timer = (b.status === 'ОЖИДАЕТ' || b.status === 'ОПЛАТА ЗАЯВЛЕНА')
      ? (b.deadline
        ? h('p', { class: 'meta', style: { margin: '8px 0 0' } }, 'Подтвердить до ', h('b', null, fmtDT(b.deadline, off()) + ' ' + tz()),
          ' · осталось ', h('span', { class: 'timer', 'data-deadline': b.deadline }, ''))
        : h('p', { class: 'meta', style: { margin: '8px 0 0' } }, '⏸ Таймер на паузе, осталось ' + fmtMin(b.leftMin || 0)))
      : null;
    const actions = [];
    if (b.status === 'ОЖИДАЕТ') {
      actions.push(h('button', { class: 'btn btn-primary btn-sm', onclick: () => openHowToPay(b) }, 'Как оплатить и подтвердить'));
      actions.push(h('button', { class: 'btn btn-soft btn-sm', onclick: () => markPaid(b) }, 'Я оставил(а) комментарий'));
      actions.push(h('button', { class: 'btn btn-danger btn-sm', onclick: () => cancelBooking(b) }, 'Отменить'));
    } else if (b.status === 'ОПЛАТА ЗАЯВЛЕНА') {
      actions.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openHowToPay(b) }, 'Показать инструкцию'));
    }
    const note = b.status === 'ИСТЕКЛА'
      ? h('p', { class: 'meta', style: { margin: '8px 0 0' } }, 'Если вы уже оплатили — напишите организатору и назовите номерки, бронь можно восстановить.')
      : b.status === 'ПОДТВЕРЖДЕНА' ? h('p', { class: 'meta', style: { margin: '8px 0 0' } }, 'Номерки закреплены за вами. До встречи в эфире!')
      : b.status === 'ОПЛАТА ЗАЯВЛЕНА' ? h('p', { class: 'meta', style: { margin: '8px 0 0' } }, 'Спасибо! Организатор проверит комментарий и оплату.') : null;
    return h('div', { class: 'mine-item' },
      h('div', { class: 'mine-top' }, h('span', { class: 'status ' + cls }, label), h('span', { class: 'meta' }, b.count + ' ' + (b.count === 1 ? 'номерок' : 'номерков'))),
      h('div', { class: 'chips', style: { marginTop: '8px' } }, b.numbers.map((n) => h('span', { class: 'chip' }, '№' + n))),
      timer, note, actions.length ? h('div', { class: 'row-actions' }, actions) : null);
  }

  function renderGrid() {
    const st = S.st;
    // выбранные, но уже занятые другими — убираем
    const lost = [];
    S.sel.forEach((n) => { if (st.tickets[n - 1] !== 'f') { S.sel.delete(n); lost.push(n); } });
    if (lost.length) toast('Номерок ' + list(lost) + ' только что заняли', 'bad');

    const mine = new Set();
    myActive().forEach((b) => b.numbers.forEach((n) => mine.add(n)));
    const tiles = st.tickets.map((t, i) => {
      const n = i + 1, ring = mine.has(n) ? ' t-mine' : '';
      if (t === 'f') {
        const on = S.sel.has(n);
        return h('button', {
          class: 'tile ' + (on ? 't-sel' : 't-free'), 'aria-pressed': on ? 'true' : 'false',
          'aria-label': 'Номерок ' + n + (on ? ', выбран' : ', свободен'), onclick: () => toggle(n)
        }, n);
      }
      const map = { p: ['t-pend', 'ждёт подтверждения'], t: ['t-taken', 'занят'], b: ['t-block', 'недоступен'] }[t] || ['t-taken', 'занят'];
      return h('button', { class: 'tile ' + map[0] + ring, disabled: true, 'aria-label': 'Номерок ' + n + ', ' + map[1], title: map[1] }, n);
    });
    fill(gridEl, ...tiles);
    fill(legendEl, 
      legend('var(--free-bg)', 'var(--free-line)', 'свободен'),
      legend('linear-gradient(135deg,#e0722f,#bf4a16)', 'transparent', 'ваш выбор'),
      legend('var(--pend-bg)', 'var(--pend-line)', 'ждёт подтверждения'),
      legend('var(--taken-bg)', 'transparent', 'занят'));
  }
  function legend(bg, border, text) {
    return h('span', null, h('i', { style: { background: bg, borderColor: border } }), text);
  }

  function renderAction() {
    const n = S.sel.size;
    actionEl.classList.toggle('hidden', n === 0);
    if (!n) { fill(actionEl); return; }
    const nums = Array.from(S.sel).sort((a, b) => a - b);
    fill(actionEl, 
      h('div', { class: 'sel' }, h('b', null, 'Выбрано: ' + n), h('span', null, list(nums))),
      h('div', { style: { display: 'flex', gap: '8px', flex: 'none' } },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { S.sel.clear(); renderGrid(); renderAction(); } }, 'Сбросить'),
        h('button', { class: 'btn btn-primary', disabled: !canBook(), onclick: openBooking }, 'Забронировать')));
  }

  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  function renderPlayers() {
    const st = S.st;
    countChip.textContent = String(st.players.length);
    const q = norm(S.search.trim());
    const players = st.players.slice().sort((a, b) => norm(a.name) < norm(b.name) ? -1 : norm(a.name) > norm(b.name) ? 1 : 0)
      .filter((p) => !q || norm(p.name).indexOf(q) >= 0 || p.items.some((it) => String(it[0]) === q));
    if (!players.length) {
      fill(plistEl, h('div', { class: 'empty' }, st.players.length ? 'Никого не нашли' : 'Пока никто не забронировал. Станьте первым! ✨'));
      return;
    }
    const out = [];
    let letter = '';
    players.forEach((p) => {
      const l = norm(p.name).charAt(0).toUpperCase();
      if (l !== letter) { letter = l; out.push(h('div', { class: 'letter' }, l)); }
      out.push(h('div', { class: 'prow' },
        avatar(p.name, p.photo),
        h('div', { class: 'pname' }, h('b', null, p.name),
          h('div', { class: 'chips' }, p.items.map((it) => h('span', { class: 'chip' + (it[1] ? '' : ' pend') }, '№' + it[0]))))));
    });
    fill(plistEl, ...out);
  }

  function renderAll() {
    renderHero(); renderBanner(); renderSteps(); renderMine(); renderGrid(); renderAction(); renderPlayers();
  }

  function tickTimers() {
    document.querySelectorAll('[data-deadline]').forEach((el) => {
      el.textContent = fmtLeft(Number(el.getAttribute('data-deadline')) - nowMs());
    });
  }

  // ───── Действия ─────
  function toggle(n) {
    if (S.sel.has(n)) { S.sel.delete(n); }
    else {
      if (!canBook()) { toast(S.st.paused ? (S.st.pauseMessage || 'Технический перерыв') : 'Приём броней закрыт', 'bad'); return; }
      const allowed = S.st.limits.pending - myPendingCount();
      if (allowed <= 0) { toast('У вас уже есть неподтверждённые номерки — дождитесь подтверждения, тогда можно будет взять ещё.', 'bad', 6500); return; }
      if (S.sel.size >= allowed) { toast('Сейчас можно выбрать не больше ' + allowed + ' ' + (allowed === 1 ? 'номерка' : 'номерков') + '.', 'bad'); return; }
      S.sel.add(n);
    }
    renderGrid(); renderAction();
  }

  async function refresh(showErr) {
    const [st, mine] = await Promise.all([api.state(), api.mine(CLIENT)]);
    if (st && st.ok) {
      S.st = st;
      if (mine && mine.ok) S.mine = mine.bookings;
      S.loaded = true;
      renderAll();
    } else if (!S.loaded) {
      fill(app, h('div', { class: 'card', style: { marginTop: '40px', textAlign: 'center' } },
        h('h2', null, 'Не удалось загрузить'), h('p', { class: 'lead' }, (st && st.error && st.error.message) || 'Попробуйте обновить страницу.'),
        h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Обновить')));
    } else if (showErr) {
      toast('Нет связи с сервером, повторим автоматически', 'bad');
    }
  }

  async function markPaid(b) {
    const r = await api.post('markPaid', { clientId: CLIENT, code: b.code });
    if (r.ok) toast('Спасибо! Организатор проверит оплату и подтвердит бронь.'); else toast(r.error.message, 'bad', 7000);
    closeModal(); refresh();
  }

  async function cancelBooking(b) {
    if (!window.confirm('Отменить бронь ' + b.code + '? Номерки освободятся.')) return;
    const r = await api.post('cancelMine', { clientId: CLIENT, code: b.code });
    if (!r.ok) toast(r.error.message, 'bad'); else toast('Бронь отменена');
    refresh();
  }

  function totalText(count) {
    const m = String(S.st.price || '').match(/(\d[\d\s]*)/);
    const unit = m ? parseInt(m[1].replace(/\s/g, ''), 10) : 0;
    if (!unit) return '';
    const cur = /₽|руб/i.test(S.st.price) ? ' ₽' : '';
    return 'К оплате: ' + (unit * count).toLocaleString('ru-RU') + cur + ' (' + count + ' × ' + unit + cur + ')';
  }

  function copyBtn(text, label) {
    return h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: async (e) => {
      const ok = await copyText(text);
      e.target.textContent = ok ? 'Скопировано ✓' : 'Не удалось';
      setTimeout(() => { e.target.textContent = label || 'Копировать'; }, 2500);
    } }, label || 'Копировать');
  }

  /** Блок оплаты: ссылка-кнопка и QR-код. */
  function payBlock(nums) {
    const info = S.st.info, url = safeUrl(info.payUrl);
    const out = [];
    if (url) {
      const qr = qrSvg(url, 168);
      const total = totalText(nums.length);
      out.push(h('div', { class: 'paybox' },
        h('div', { class: 'paybox-main' },
          h('b', null, '1. Оплатите'),
          total ? h('div', { class: 'meta' }, total) : null,
          h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Оплатить по ссылке'),
          qr ? h('div', { class: 'meta' }, 'или наведите камеру телефона на QR-код') : null),
        qr ? h('div', { class: 'qr' }, qr) : null));
    }
    // Оплата без комиссии: от N номерков. QR и ссылка выше остаются.
    const bulk = info.bulk, bulkUrl = bulk ? safeUrl(bulk.url) : '';
    if (bulk && bulkUrl && nums.length >= bulk.min) {
      out.push(h('div', { class: 'bulkbox' },
        bulk.text ? h('p', { class: 'bulk-text' }, '💸 ' + bulk.text) : null,
        h('a', { class: 'btn btn-soft bulk-btn', href: bulkUrl, target: '_blank', rel: 'noopener noreferrer' }, bulk.button || 'Запросить реквизиты')));
    }
    if (info.payment) out.push(h('div', { class: 'pre' }, info.payment));
    return out;
  }

  /** Блок комментария: номерки через запятую с копированием и ссылка на пост. */
  function commentBlock(nums) {
    const text = nums.join(', '), post = safeUrl(S.st.info.postUrl);
    return h('div', { class: 'cbox' },
      h('b', null, '2. Оставьте комментарий под постом'),
      h('p', { class: 'meta', style: { margin: '4px 0 10px' } }, 'Напишите номерки через запятую и прикрепите скриншот оплаты.'),
      h('div', { class: 'copyline' }, h('span', { class: 'copynums num' }, text), copyBtn(text, 'Копировать номерки')),
      post ? h('a', { class: 'btn btn-ghost btn-block', style: { marginTop: '10px' }, href: post, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть пост для комментария')
        : h('p', { class: 'meta', style: { margin: '10px 0 0' } }, 'Пост для комментария укажет организатор.'));
  }

  function openHowToPay(b) {
    openModal([
      h('h3', null, 'Как подтвердить бронь'),
      h('p', { class: 'lead' }, 'Ваши номерки: ' + b.numbers.join(', ')),
      payBlock(b.numbers), commentBlock(b.numbers),
      h('div', { class: 'cbox' }, h('b', null, '3. Нажмите кнопку'), h('p', { class: 'meta', style: { margin: '4px 0 0' } }, 'Организатор получит сигнал и проверит комментарий.')),
      b.status === 'ОЖИДАЕТ' ? h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '12px' }, onclick: () => markPaid(b) }, 'Я оставил(а) комментарий со скриншотом') : null
    ]);
  }

  function openBooking() {
    const nums = Array.from(S.sel).sort((a, b) => a - b);
    if (!nums.length) return;
    const vkInput = h('input', {
      class: 'input', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: 'vk.com/id12345 или vk.com/ваш_ник', value: store('nomerok_vk') || ''
    });
    const nameInput = h('input', { class: 'input', type: 'text', autocomplete: 'name', maxlength: '40', placeholder: 'Как вас называть', value: store('nomerok_name') || '' });
    const nameField = h('div', { class: 'field hidden' }, h('label', null, 'Ваше имя'), nameInput,
      h('div', { class: 'hint' }, 'Определить имя по ссылке автоматически не получилось — введите его вручную. В списке будет только имя, без фото.'));
    const preview = h('div', { class: 'msg' });
    const errBox = h('div', { class: 'msg err', role: 'alert' });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Забронировать ' + list(nums));
    let seq = 0;

    async function resolve() {
      const v = vkInput.value.trim(), my = ++seq;
      errBox.textContent = '';
      fill(preview);
      if (!v) return;
      preview.className = 'msg'; preview.textContent = 'Проверяем профиль…';
      const r = await api.post('resolveVk', { clientId: CLIENT, vkUrl: v });
      if (my !== seq) return;           // ссылку уже изменили
      fill(preview);
      if (r.ok) {
        preview.className = 'msg';
        nameField.classList.add('hidden');
        fill(preview, h('div', { class: 'profile-card' }, avatar(r.display, r.photo, 44),
          h('div', null, h('b', null, r.display), h('div', { class: 'meta' }, 'Так вы будете в списке участников. Это не вы? Проверьте ссылку.'))));
      } else if (r.error.needName) {
        nameField.classList.remove('hidden');
      } else {
        preview.className = 'msg err'; preview.textContent = r.error.message;
      }
    }
    vkInput.addEventListener('change', resolve);

    submit.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!vkInput.value.trim()) { errBox.textContent = 'Вставьте ссылку на ваш профиль ВКонтакте'; vkInput.focus(); return; }
      submit.disabled = true; submit.textContent = 'Бронируем…';
      const r = await api.post('book', { clientId: CLIENT, vkUrl: vkInput.value.trim(), name: nameInput.value.trim(), numbers: nums });
      submit.disabled = false; submit.textContent = 'Забронировать ' + list(nums);
      if (r.ok) {
        store('nomerok_vk', vkInput.value.trim());
        if (nameInput.value.trim()) store('nomerok_name', nameInput.value.trim());
        S.sel.clear();
        showSuccess(r);
        refresh();
        return;
      }
      const e = r.error;
      if (e.needName) { nameField.classList.remove('hidden'); nameInput.focus(); }
      errBox.textContent = e.message;
      if (e.code === 'TAKEN' || e.code === 'PAUSED' || e.code === 'CLOSED') refresh();
    });

    openModal([
      h('h3', null, 'Бронь номерков'),
      h('p', { class: 'lead' }, list(nums) + ' · ' + nums.length + ' шт. · ' + S.st.price + ' за номерок'),
      h('div', { class: 'field' },
        h('label', null, 'Ссылка на ваш профиль ВКонтакте'), vkInput,
        h('div', { class: 'hint' }, 'Нужна, чтобы мы вас узнали. В списке участников будут видны имя и фото из вашего профиля.'), preview),
      nameField, errBox, submit
    ]);
    if (vkInput.value) resolve(); else vkInput.focus();
  }

  function showSuccess(r) {
    const b = r.booking;
    const deadline = b.deadline
      ? h('p', { style: { textAlign: 'center', margin: '0 0 12px' } }, 'Подтвердите бронь до ', h('b', null, fmtDT(b.deadline, off()) + ' ' + tz()),
        ' (осталось ', h('span', { class: 'timer', 'data-deadline': b.deadline }, ''), ')')
      : null;
    openModal([
      h('div', { style: { textAlign: 'center' } }, h('div', { class: 'big-ok' }, '✓'),
        h('h3', null, 'Подтвердите бронирование номерков скриншотом доната'),
        h('p', { class: 'lead' }, 'Номерки закреплены за вами на время подтверждения.')),
      h('div', { class: 'codebox' }, h('div', null, h('div', { class: 'meta' }, 'Ваши номерки'), h('div', { class: 'code num' }, b.numbers.join(', '))),
        copyBtn(b.numbers.join(', '), 'Копировать')),
      deadline,
      payBlock(b.numbers), commentBlock(b.numbers),
      h('div', { class: 'cbox' }, h('b', null, '3. Нажмите кнопку'), h('p', { class: 'meta', style: { margin: '4px 0 0' } }, 'Организатор получит сигнал и проверит комментарий.')),
      h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '12px' }, onclick: () => markPaid(b) }, 'Я оставил(а) комментарий со скриншотом'),
      h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onclick: closeModal }, 'Закрыть, сделаю позже')
    ]);
    tickTimers();
  }

  // ───── Запуск ─────
  refresh().then(() => {
    setInterval(() => { if (!document.hidden) refresh(false); }, POLL_MS);
    setInterval(tickTimers, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  });
})();
