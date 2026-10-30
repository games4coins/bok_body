/* Номерок — админка. Работает с телефона. */
(function () {
  'use strict';
  const { h, fill, api, avatar, nowMs, tzName, fmtDT, fmtLeft, fmtMin, store, copyText, toast, beep, unlockAudio, DEMO } = Nomerok;

  const POLL_MS = 10000;
  const root = document.getElementById('app');
  const A = {
    pw: '', st: null, tab: 'queue', filter: 'attention', q: '', sel: new Set(),
    known: null, draft: {}, sound: store('nomerok_sound') !== '0', poll: null
  };
  const NEEDS_CHECK = ['ОПЛАТА ЗАЯВЛЕНА', 'ОЖИДАЕТ'];
  const STATUS = {
    'ОЖИДАЕТ': ['s-wait', 'Ожидает'],
    'ОПЛАТА ЗАЯВЛЕНА': ['s-paid', 'Оплата заявлена'],
    'ПОДТВЕРЖДЕНА': ['s-ok', 'Подтверждена'],
    'ИСТЕКЛА': ['s-off', 'Истекла'],
    'ОТМЕНЕНА': ['s-off', 'Отменена']
  };

  const off = () => (A.st ? A.st.tzOffsetMin : 180);
  const tz = () => tzName(off());
  const list = (nums) => '№' + nums.join(', №');
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

  // ───── Запросы ─────
  async function act(action, extra, okText) {
    const r = await api.post(action, Object.assign({ password: A.pw }, extra));
    if (!r.ok) {
      if (r.error.code === 'AUTH') { logout(); }
      toast(r.error.message, 'bad', 7000);
      return null;
    }
    if (r.tickets) { setState(r); }
    if (okText) toast(okText);
    return r;
  }

  function setState(st) {
    detectNew(st);
    A.st = st;
    renderTop();
    if (A.tab !== 'settings') renderTab();
    const n = st.bookings.filter((b) => NEEDS_CHECK.indexOf(b.status) >= 0).length;
    document.title = (n ? '(' + n + ') ' : '') + 'Номерок — админка';
  }

  /** Сравнивает с прошлым состоянием: новые брони и заявленная оплата → всплывашка и звук. */
  function detectNew(st) {
    const cur = {};
    st.bookings.forEach((b) => { cur[b.code] = b.status; });
    if (A.known) {
      st.bookings.forEach((b) => {
        const prev = A.known[b.code];
        if (prev === undefined && b.source !== 'админ') alertNew('🆕 Новая бронь ' + b.code + ': ' + b.name + ' — ' + list(b.numbers));
        else if (prev !== undefined && prev !== 'ОПЛАТА ЗАЯВЛЕНА' && b.status === 'ОПЛАТА ЗАЯВЛЕНА') alertNew('💰 Оплата заявлена ' + b.code + ': ' + b.name + ' — ' + list(b.numbers));
      });
    }
    A.known = cur;
  }
  function alertNew(text) {
    toast(text, null, 12000);
    if (A.sound) beep();
    if (navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch (e) { /* ignore */ } }
  }

  // ───── Вход ─────
  function savedPw() { return store('nomerok_admin_pw') || ''; }
  function logout() {
    A.pw = ''; A.known = null; A.st = null;
    store('nomerok_admin_pw', null);
    try { sessionStorage.removeItem('nomerok_admin_pw'); } catch (e) { /* ignore */ }
    clearInterval(A.poll);
    renderLogin();
  }

  function renderLogin(msg) {
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Пароль админа' });
    const remember = h('input', { type: 'checkbox', checked: true });
    const err = h('div', { class: 'msg err' }, msg || '');
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Войти');
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      unlockAudio();
      btn.disabled = true; btn.textContent = 'Проверяем…'; err.textContent = '';
      const ok = await tryLogin(pw.value, remember.checked);
      btn.disabled = false; btn.textContent = 'Войти';
      if (!ok) { err.textContent = 'Неверный пароль или нет связи с сервером'; pw.select(); }
    } },
      h('h2', null, '🎙 Номерок · Админка'), h('p', { class: 'lead' }, 'Введите пароль, заданный в свойствах скрипта.'),
      h('div', { class: 'field' }, pw), h('label', { class: 'sw', style: { marginBottom: '14px' } }, remember, 'Запомнить на этом устройстве'), btn, err);
    fill(root, h('div', { class: 'login' }, form,
      h('p', { style: { textAlign: 'center', marginTop: '16px' } }, h('a', { href: 'index.html', style: { color: 'var(--accent-2)', fontWeight: '700' } }, '← К бронированию'))));
    pw.focus();
  }

  async function tryLogin(password, remember) {
    const r = await api.post('adminState', { password });
    if (!r.ok) return false;
    A.pw = password;
    if (remember) store('nomerok_admin_pw', password);
    else { try { sessionStorage.setItem('nomerok_admin_pw', password); } catch (e) { /* ignore */ } }
    A.known = null;
    buildShell();
    setState(r);
    renderTab();
    clearInterval(A.poll);
    A.poll = setInterval(pollOnce, POLL_MS);
    return true;
  }

  async function pollOnce() {
    const r = await api.post('adminState', { password: A.pw });
    if (r.ok) setState(r);
    else if (r.error && r.error.code === 'AUTH') logout();
  }

  // ───── Каркас ─────
  let topEl, pauseEl, contentEl;
  function buildShell() {
    topEl = h('div', { class: 'adm-top' });
    pauseEl = h('div');
    contentEl = h('main', { class: 'adm-wrap' });
    fill(root, topEl, pauseEl, contentEl);
    if (DEMO) document.getElementById('demo').replaceChildren(h('div', { class: 'demo-flag' }, 'Демо-режим: данные не сохраняются. Пароль: demo.'));
  }

  function renderTop() {
    const st = A.st;
    const attention = st.bookings.filter((b) => NEEDS_CHECK.indexOf(b.status) >= 0).length;
    const tab = (id, label, badge) => h('button', { class: 'tab' + (A.tab === id ? ' on' : ''), onclick: () => { A.tab = id; renderTop(); renderTab(); } },
      label, badge ? h('span', { class: 'badge' }, badge) : null);
    fill(topEl,
      h('a', { class: 'tab', href: 'index.html', title: 'Страница бронирования для участников' }, '← К бронированию'),
      h('span', { class: 'brand' }, 'Эфир №' + st.event.number),
      h('div', { class: 'tabs' }, tab('queue', 'Брони', attention || ''), tab('grid', 'Сетка'), tab('settings', 'Настройки')),
      h('span', { class: 'grow' }),
      h('button', { class: 'tab', title: 'Заморозить / возобновить бронирование', onclick: () => setPause(!st.paused) }, st.paused ? '▶ Возобновить' : '⏸ Перерыв'),
      h('button', { class: 'tab', title: 'Звуковой сигнал', onclick: toggleSound }, A.sound ? '🔔 Звук' : '🔕 Звук'),
      h('button', { class: 'tab', onclick: logout }, 'Выйти'));
    fill(pauseEl, st.paused
      ? h('div', { class: 'pause-on' }, '⏸ Бронирование заморожено, таймеры стоят. ',
        h('button', { class: 'btn btn-sm btn-primary', style: { marginLeft: '8px' }, onclick: () => setPause(false) }, 'Возобновить'))
      : null);
  }

  function toggleSound() {
    A.sound = !A.sound;
    store('nomerok_sound', A.sound ? '1' : '0');
    unlockAudio();
    if (A.sound) beep();
    renderTop();
  }

  async function setPause(on) {
    if (on && !window.confirm('Заморозить бронирование? Новые брони закроются, таймеры остановятся.')) return;
    await act('adminSettings', { updates: { paused: on ? 'ДА' : 'НЕТ' } }, on ? 'Бронирование заморожено' : 'Бронирование возобновлено');
  }

  function renderTab() {
    if (!A.st) return;
    if (A.tab === 'queue') fill(contentEl, queueView());
    else if (A.tab === 'grid') fill(contentEl, gridView());
    else fill(contentEl, settingsView());
    tickTimers();
  }

  function tickTimers() {
    document.querySelectorAll('[data-deadline]').forEach((el) => {
      el.textContent = fmtLeft(Number(el.getAttribute('data-deadline')) - nowMs());
    });
  }

  // ───── Очередь броней ─────
  const FILTERS = [
    ['attention', 'Проверить', (b) => NEEDS_CHECK.indexOf(b.status) >= 0],
    ['ok', 'Подтверждённые', (b) => b.status === 'ПОДТВЕРЖДЕНА'],
    ['closed', 'Закрытые', (b) => b.status === 'ИСТЕКЛА' || b.status === 'ОТМЕНЕНА'],
    ['all', 'Все', () => true]
  ];

  function queueView() {
    const st = A.st;
    const q = norm(A.q.trim());
    const match = (b) => !q || norm(b.name).indexOf(q) >= 0 || norm(b.code).indexOf(q) >= 0 || b.numbers.some((n) => String(n) === q);
    const f = FILTERS.find((x) => x[0] === A.filter) || FILTERS[0];
    let items = st.bookings.filter(f[2]).filter(match);
    if (A.filter === 'attention') {
      items = items.slice().sort((a, b) => {
        const pa = a.status === 'ОПЛАТА ЗАЯВЛЕНА' ? 0 : 1, pb = b.status === 'ОПЛАТА ЗАЯВЛЕНА' ? 0 : 1;
        return pa - pb || (a.deadline || 9e15) - (b.deadline || 9e15);
      });
    }
    const chips = h('div', { class: 'chips-row' }, FILTERS.map((x) => {
      const n = st.bookings.filter(x[2]).length;
      return h('button', { class: 'fchip' + (A.filter === x[0] ? ' on' : ''), onclick: () => { A.filter = x[0]; renderTab(); } }, x[1] + ' · ' + n);
    }));
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск: имя, код, номерок', value: A.q, style: { marginBottom: '12px' },
      oninput: (e) => { A.q = e.target.value; const pos = e.target.selectionStart; renderTab(); const s = contentEl.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
    return h('div', null,
      h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('b', null, 'Свободно ' + st.counts.free + ' · ждут ' + st.counts.pending + ' · оплата заявлена ' + st.counts.paid + ' · подтверждено ' + st.counts.taken + (st.counts.blocked ? ' · блок ' + st.counts.blocked : ''))),
      chips, search,
      items.length ? items.map(bookingCard) : h('div', { class: 'card empty' }, A.filter === 'attention' ? 'Всё проверено 👌 Новых броней нет.' : 'Ничего не найдено'));
  }

  function timerLine(b) {
    if (b.status !== 'ОЖИДАЕТ' && b.status !== 'ОПЛАТА ЗАЯВЛЕНА') return null;
    if (b.deadline) return h('div', { class: 'meta' }, 'до ' + fmtDT(b.deadline, off()) + ' ' + tz() + ' · осталось ', h('span', { class: 'timer', 'data-deadline': b.deadline }, ''));
    if (b.leftMin != null) return h('div', { class: 'meta' }, '⏸ на паузе, осталось ' + fmtMin(b.leftMin));
    return null;
  }

  function bookingCard(b) {
    const [cls, label] = STATUS[b.status] || ['s-off', b.status];
    const buttons = [];
    if (b.status === 'ОЖИДАЕТ' || b.status === 'ОПЛАТА ЗАЯВЛЕНА') {
      buttons.push(h('button', { class: 'btn btn-ok btn-sm', onclick: () => act('adminConfirm', { code: b.code }, 'Подтверждена: ' + b.code) }, '✅ Подтвердить'));
      buttons.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act('adminExtend', { code: b.code, hours: 1 }, '+1 час') }, '+1 ч'));
      buttons.push(h('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmThen('Отменить бронь ' + b.code + '?', () => act('adminCancel', { code: b.code }, 'Отменена')) }, 'Отменить'));
    } else if (b.status === 'ИСТЕКЛА' || b.status === 'ОТМЕНЕНА') {
      buttons.push(h('button', { class: 'btn btn-soft btn-sm', onclick: () => act('adminRestore', { code: b.code }, 'Восстановлена с новым таймером') }, '♻ Восстановить'));
      buttons.push(h('button', { class: 'btn btn-ok btn-sm', onclick: () => act('adminConfirm', { code: b.code }, 'Подтверждена: ' + b.code) }, '✅ Подтвердить сразу'));
    } else if (b.status === 'ПОДТВЕРЖДЕНА') {
      buttons.push(h('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmThen('Отменить подтверждённую бронь ' + b.code + '?', () => act('adminCancel', { code: b.code }, 'Отменена')) }, 'Отменить бронь'));
    }
    buttons.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: async (e) => { const ok = await copyText(b.code); e.target.textContent = ok ? 'Скопировано ✓' : 'Ошибка'; } }, '📋 Код'));
    const whoName = b.vkUrl ? h('a', { href: b.vkUrl, target: '_blank', rel: 'noopener noreferrer' }, b.name) : h('span', null, b.name);
    const who = h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } }, avatar(b.name, b.photo, 36), whoName);
    return h('section', { class: 'card bk' + (b.status === 'ОПЛАТА ЗАЯВЛЕНА' ? ' attn' : '') },
      h('div', { class: 'mine-top' }, h('span', { class: 'code' }, b.code), h('span', { class: 'status ' + cls }, label),
        h('span', { class: 'meta' }, fmtDT(b.created, off()) + ' · ' + (b.source || ''))),
      h('div', { class: 'who' }, who),
      h('div', { class: 'chips' }, b.numbers.map((n) => h('span', { class: 'chip' }, '№' + n))),
      timerLine(b), b.note ? h('div', { class: 'meta' }, '📝 ' + b.note) : null,
      h('div', { class: 'row-actions' }, buttons));
  }

  function confirmThen(text, fn) { if (window.confirm(text)) fn(); }

  // ───── Сетка и ручные операции ─────
  function gridView() {
    const st = A.st;
    const cls = { f: 't-free', p: 't-pend', a: 't-paid', t: 't-taken', b: 't-block' };
    const tiles = st.tickets.map((t) => {
      const on = A.sel.has(t.n);
      return h('button', {
        class: 'tile ' + (t.s === 'f' && on ? 't-sel' : cls[t.s]), 'aria-label': 'Номерок ' + t.n,
        onclick: () => { if (t.s === 'f') { if (on) A.sel.delete(t.n); else A.sel.add(t.n); renderTab(); } else openTicket(t); }
      }, t.n);
    });
    const nums = Array.from(A.sel).sort((a, b) => a - b);
    return h('div', null,
      h('section', { class: 'card' },
        h('h2', null, 'Сетка номерков'),
        h('p', { class: 'lead' }, 'Нажмите на свободные номерки, затем «Назначить вручную» или «Заблокировать». Нажмите на занятый — увидите, чей он.'),
        h('div', { class: 'grid' }, tiles),
        h('div', { class: 'legend' },
          legend('var(--free-bg)', 'свободен'), legend('var(--pend-bg)', 'ждёт подтверждения'), legend('var(--paid-bg)', 'оплата заявлена'),
          legend('var(--taken-bg)', 'подтверждён'), legend('#e3dbd2', 'заблокирован')),
        nums.length ? h('div', { class: 'actionbar' },
          h('div', { class: 'sel' }, h('b', null, 'Выбрано: ' + nums.length), h('span', null, list(nums))),
          h('div', { style: { display: 'flex', gap: '8px', flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } },
            h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { A.sel.clear(); renderTab(); } }, 'Сбросить'),
            h('button', { class: 'btn btn-soft btn-sm', onclick: blockSelected }, 'Заблокировать'),
            h('button', { class: 'btn btn-primary btn-sm', onclick: openManual }, 'Назначить вручную'))) : null));
  }
  function legend(bg, text) { return h('span', null, h('i', { style: { background: bg } }), text); }

  async function blockSelected() {
    const nums = Array.from(A.sel);
    const r = await act('adminBlock', { numbers: nums }, 'Заблокировано: ' + list(nums.sort((a, b) => a - b)));
    if (r) { A.sel.clear(); renderTab(); }
  }

  // ───── Модалка ─────
  let modal = null;
  function closeModal() { if (modal) { modal.remove(); modal = null; } }
  function openModal(children) {
    closeModal();
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('button', { class: 'x', 'aria-label': 'Закрыть', onclick: closeModal }, '✕'), children);
    modal = h('div', { class: 'overlay', onclick: (e) => { if (e.target === modal) closeModal(); } }, sheet);
    document.body.appendChild(modal);
  }

  function openTicket(t) {
    const b = A.st.bookings.find((x) => x.code === t.code);
    if (t.s === 'b') {
      openModal([h('h3', null, 'Номерок №' + t.n), h('p', { class: 'lead' }, 'Заблокирован: участники не могут его занять.'),
        h('button', { class: 'btn btn-primary btn-block', onclick: async () => { const r = await act('adminUnblock', { numbers: [t.n] }, 'Разблокирован'); if (r) closeModal(); } }, 'Разблокировать')]);
      return;
    }
    if (!b) { openModal([h('h3', null, 'Номерок №' + t.n), h('p', { class: 'lead' }, 'Бронь не найдена (обновите страницу).')]); return; }
    openModal([h('h3', null, 'Номерок №' + t.n), bookingCard(b)]);
  }

  function openManual() {
    const nums = Array.from(A.sel).sort((a, b) => a - b);
    const name = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Имя участника', value: '' });
    const vk = h('input', { class: 'input', type: 'text', placeholder: 'vk.com/… (необязательно)', autocapitalize: 'off' });
    const note = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Заметка (необязательно)' });
    const mode = h('select', { class: 'select' },
      h('option', { value: 'confirmed' }, 'Сразу подтверждена (оплатил вам напрямую)'),
      h('option', { value: 'timer' }, 'С таймером — как обычная бронь'));
    const err = h('div', { class: 'msg err' });
    const btn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      err.textContent = ''; btn.disabled = true;
      const r = await api.post('adminBook', { password: A.pw, name: name.value, vkUrl: vk.value, numbers: nums, mode: mode.value, note: note.value });
      btn.disabled = false;
      if (!r.ok) { err.textContent = r.error.message; return; }
      setState(r); A.sel.clear(); closeModal(); renderTab(); toast('Забронировано: ' + list(nums));
    } }, 'Забронировать ' + list(nums));
    openModal([h('h3', null, 'Ручная бронь'),
      h('div', { class: 'field' }, h('label', null, 'Имя'), name),
      h('div', { class: 'field' }, h('label', null, 'Ссылка ВК'), vk),
      h('div', { class: 'field' }, h('label', null, 'Режим'), mode),
      h('div', { class: 'field' }, h('label', null, 'Заметка'), note), err, btn]);
    name.focus();
  }

  // ───── Настройки ─────
  const GROUPS = [
    ['Эфир', ['eventNumber', 'eventTitle', 'eventDate', 'ticketCount', 'priceText']],
    ['Бронирование', ['confirmHours', 'maxPending', 'maxConfirmed', 'quietEnabled', 'quietFrom', 'quietTo', 'utcOffset', 'bookingOpen']],
    ['Технический перерыв', ['paused', 'pauseMessage']],
    ['Оплата и комментарий', ['payUrl', 'postUrl', 'paymentInfo']],
    ['Оплата без комиссии', ['bulkMin', 'bulkText', 'bulkButton', 'bulkUrl']],
    ['Надписи на странице бронирования', ['soldOutEnabled', 'soldOutText', 'waitText']],
    ['Список участников', ['nameFormat', 'showPending']],
    ['Уведомления', ['notifyEmail', 'adminUrl']]
  ];

  function settingsView() {
    const byKey = {};
    A.st.form.forEach((f) => { byKey[f.key] = f; });
    A.draft = {};
    const saveBtn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      if (!Object.keys(A.draft).length) { toast('Нет изменений'); return; }
      saveBtn.disabled = true;
      const r = await act('adminSettings', { updates: A.draft }, 'Настройки сохранены');
      saveBtn.disabled = false;
      if (r) renderTab();
    } }, 'Сохранить настройки');
    return h('div', null, h('section', { class: 'card' },
      GROUPS.map(([title, keys]) => h('div', { class: 'set-group' }, h('h3', null, title), keys.filter((k) => byKey[k]).map((k) => control(byKey[k])))),
      saveBtn,
      h('p', { class: 'note-foot' }, 'Время тихих часов и дедлайны считаются в часовом поясе организатора. Изменения часов на подтверждение действуют на новые брони.')),
      h('section', { class: 'card', style: { marginTop: '20px' } },
        h('h2', null, 'Завершение эфира'),
        h('p', { class: 'lead' }, 'Когда эфир прошёл: все брони уйдут во вкладку-архив в таблице, сетка очистится и начнётся следующий эфир.'),
        h('button', { class: 'btn btn-danger btn-block', onclick: openArchive }, '🏁 Завершить эфир и начать новый')));
  }

  function openArchive() {
    const st = A.st, cur = st.event.number;
    const nextNum = /^\d+$/.test(cur) ? String(Number(cur) + 1) : '';
    const open = st.bookings.filter((b) => NEEDS_CHECK.indexOf(b.status) >= 0).length;
    const numInput = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Номер следующего эфира' });
    numInput.value = nextNum;
    const dateInput = h('input', { class: 'input', type: 'text', maxlength: '100', placeholder: 'Например: в 20:00 1 декабря (можно задать позже)' });
    const force = h('input', { type: 'checkbox' });
    const err = h('div', { class: 'msg err' });
    const btn = h('button', { class: 'btn btn-danger btn-block', style: { marginTop: '6px' } }, 'Завершить эфир №' + cur);
    if (open > 0) btn.disabled = true;
    force.addEventListener('change', () => { btn.disabled = !force.checked; });
    btn.addEventListener('click', async () => {
      err.textContent = ''; btn.disabled = true;
      const r = await api.post('adminArchive', { password: A.pw, newNumber: numInput.value, newDate: dateInput.value, force: force.checked });
      if (!r.ok) { err.textContent = r.error.message; btn.disabled = open > 0 && !force.checked; return; }
      setState(r); closeModal(); renderTab();
      const a = r.archive;
      toast(a.rows ? 'Эфир №' + a.oldNumber + ' в архиве: «' + a.sheet + '», броней: ' + a.rows + '. Начат эфир ' + (a.newNumber ? '№' + a.newNumber : '(укажите номер в настройках)') + '.'
        : 'Начат эфир ' + (a.newNumber ? '№' + a.newNumber : '(укажите номер в настройках)') + '.', null, 12000);
    });
    openModal([
      h('h3', null, 'Завершить эфир №' + cur + '?'),
      h('p', { class: 'lead' }, 'Брони уйдут во вкладку «Архив №' + cur + '» в таблице. Сетка очистится, номерки освободятся, блокировки снимутся, дата эфира сбросится.'),
      open > 0 ? h('div', { class: 'banner warn', style: { margin: '0 0 12px' } }, h('span', null, '⚠️'), h('span', null,
        'Неподтверждённых броней: ' + open + '. ', h('label', { class: 'sw', style: { marginTop: '8px' } }, force, 'Закрыть их вместе с эфиром (в архиве — со статусом «ИСТЕКЛА»)'))) : null,
      h('div', { class: 'field' }, h('label', null, 'Номер следующего эфира'), numInput),
      h('div', { class: 'field' }, h('label', null, 'Дата и время следующего эфира'), dateInput),
      err, btn]);
  }

  function control(f) {
    const set = (v) => { A.draft[f.key] = v; };
    let input;
    if (f.type === 'yesno') {
      input = h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: f.value.trim().toUpperCase() === 'ДА', onchange: (e) => set(e.target.checked ? 'ДА' : 'НЕТ') }), 'Включено');
    } else if (f.type === 'select') {
      input = h('select', { class: 'select', onchange: (e) => set(e.target.value) }, f.options.map((o) => h('option', { value: o, selected: o === f.value.trim().toLowerCase() }, o)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { class: 'textarea', oninput: (e) => set(e.target.value) }); input.value = f.value;
    } else {
      input = h('input', { class: 'input', type: f.type === 'time' ? 'time' : 'text', inputmode: f.type === 'number' ? 'decimal' : null, oninput: (e) => set(e.target.value) });
      input.value = f.value;
    }
    return h('div', { class: 'field' }, h('label', null, f.label), input, f.hint ? h('div', { class: 'hint' }, f.hint) : null);
  }

  // ───── Запуск ─────
  setInterval(tickTimers, 1000);
  document.addEventListener('click', unlockAudio, { once: true });
  let saved = savedPw();
  try { saved = saved || sessionStorage.getItem('nomerok_admin_pw') || ''; } catch (e) { /* ignore */ }
  if (DEMO && !saved) document.getElementById('demo').replaceChildren(h('div', { class: 'demo-flag' }, 'Демо-режим: данные не сохраняются. Пароль: demo.'));
  if (saved) {
    tryLogin(saved, !!savedPw()).then((ok) => { if (!ok) renderLogin('Сессия истекла, войдите заново'); });
  } else {
    renderLogin();
  }
})();
