/* Номерок — админка. Работает с телефона. */
(function () {
  'use strict';
  const { h, fill, api, avatar, nowMs, tzName, fmtDT, fmtLeft, fmtMin, timerNodes, tickTimer, clientId, store, copyText, toast, beep, unlockAudio, DEMO } = Nomerok;

  const POLL_MS = 10000;
  const root = document.getElementById('app');
  const A = {
    pw: '', st: null, tab: 'queue', filter: 'attention', q: '', sel: new Set(),
    players: null, rules: null, pq: '', known: null, draft: {}, sound: store('nomerok_sound') !== '0', poll: null
  };
  const EXPECTED_VERSION = 6;
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
    if (A.tab !== 'settings' && A.tab !== 'players' && A.tab !== 'winner' && A.tab !== 'gifts') renderTab();
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
  let topEl, pauseEl, warnEl, contentEl;
  function buildShell() {
    topEl = h('div', { class: 'adm-top' });
    pauseEl = h('div');
    warnEl = h('div', { class: 'adm-warn' });
    contentEl = h('main', { class: 'adm-wrap' });
    fill(root, topEl, pauseEl, warnEl, contentEl);
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
      h('div', { class: 'tabs' }, tab('queue', 'Брони', attention || ''), tab('grid', 'Сетка'), tab('players', 'Игроки'), tab('gifts', '🎁 Подарки'), tab('winner', '🎉 Победитель'), tab('settings', 'Настройки')),
      h('span', { class: 'grow' }),
      h('button', { class: 'tab', title: 'Заморозить / возобновить бронирование', onclick: () => setPause(!st.paused) }, st.paused ? '▶ Возобновить' : '⏸ Перерыв'),
      h('button', { class: 'tab', title: 'Звуковой сигнал', onclick: toggleSound }, A.sound ? '🔔 Звук' : '🔕 Звук'),
      h('button', { class: 'tab', onclick: logout }, 'Выйти'));
    const warns = (st.warnings || []).slice();
    if (st.version !== EXPECTED_VERSION) warns.unshift('Версия сервера (Apps Script) ' + (st.version || 'старая') + ', а сайт рассчитан на ' + EXPECTED_VERSION + '. Вставьте свежие Code.gs, TimeLogic.gs и Players.gs, запустите init и создайте НОВУЮ версию развёртывания — иначе часть функций работает неверно.');
    fill(warnEl, warns.length
      ? h('div', { class: 'banner warn', style: { margin: '12px 14px 0', flexDirection: 'column', gap: '6px' }, role: 'alert' },
        h('b', null, '⚠ Проверьте настройки'), warns.map((w) => h('div', null, w)))
      : null);
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
    else if (A.tab === 'players') fill(contentEl, playersView());
    else if (A.tab === 'winner') fill(contentEl, winnerView());
    else if (A.tab === 'gifts') fill(contentEl, giftsView());
    else fill(contentEl, settingsView());
    tickTimers();
  }

  function tickTimers() {
    document.querySelectorAll('[data-act]').forEach(tickTimer);
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
    if (b.deadline == null && b.leftMin == null) return null;
    return h('div', { class: 'meta' }, timerNodes(b, A.st.quiet, off()));
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
    const name = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Имя (если пусто — возьмём из профиля ВК)', value: '' });
    const vk = h('input', { class: 'input', type: 'text', placeholder: 'vk.com/id… или vk.com/ник', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
    const preview = h('div', { class: 'msg' });
    const note = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Заметка (необязательно)' });
    const mode = h('select', { class: 'select' },
      h('option', { value: 'confirmed' }, 'Сразу подтверждена (оплатил вам напрямую)'),
      h('option', { value: 'timer' }, 'С таймером — как обычная бронь'));
    const err = h('div', { class: 'msg err' });
    let seq = 0, chosen = null;

    // Выбор из базы игроков (как список участников справа от сетки): поиск по имени
    const pickEl = h('div', null);
    const pickBtn = h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: togglePicker }, '👥 Выбрать из базы игроков');
    async function togglePicker() {
      if (pickEl.children.length) { fill(pickEl); return; }
      if (!A.players) {
        fill(pickEl, h('div', { class: 'hint' }, 'Загружаем игроков…'));
        const r = await act('adminPlayers');
        if (!r) { fill(pickEl); return; }
        A.players = r.players; A.rules = r.rules;
      }
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по имени', autocomplete: 'off' });
      const box = h('div', { class: 'blist', style: { maxHeight: '32vh' } });
      const draw = () => {
        const t = norm(q.value.trim());
        const rows = A.players.filter((x) => !t || norm(x.name).indexOf(t) >= 0).slice(0, 80);
        fill(box, rows.length ? rows.map((x) => h('div', { class: 'prow', style: { cursor: 'pointer' }, onclick: () => choose(x) },
          avatar(x.name, x.photo, 32),
          h('div', { class: 'pname' }, h('b', null, x.name),
            h('div', { class: 'chips' }, x.balance ? h('span', { class: 'bal' }, '🎟 ' + x.balance) : null, crosses(x.misses), x.frozen ? h('span', { class: 'frz' }, '❄') : null))))
          : h('div', { class: 'empty' }, A.players.length ? 'Никого не нашли' : 'В базе пока нет игроков'));
      };
      q.addEventListener('input', draw);
      draw();
      fill(pickEl, q, box);
      q.focus();
    }
    function choose(x) {
      chosen = x;
      seq++; resolved = { ok: true };
      vk.value = x.url || '';
      name.value = x.name;
      fill(pickEl);
      err.textContent = '';
      preview.className = 'msg';
      fill(preview, h('div', { class: 'profile-card' }, avatar(x.name, x.photo, 40),
        h('div', null, h('b', null, x.name), h('div', { class: 'meta' }, 'Игрок из базы' + (x.balance ? ' · 🎟 ' + x.balance : '') + (x.misses ? ' · пропусков: ' + x.misses : '')))));
    }

    // Как у участников: по ссылке определяем имя и фото профиля
    let resolved = null, pending = null, timer = null;
    async function resolve() {
      const v = vk.value.trim(), my = ++seq;
      err.textContent = ''; resolved = null;
      fill(preview);
      if (!v) return;
      preview.className = 'msg'; preview.textContent = 'Проверяем профиль…';
      const job = api.post('adminResolveVk', { password: A.pw, vkUrl: v });
      pending = job;
      const r = await job;
      if (my !== seq) return;
      pending = null;
      fill(preview);
      if (r.ok) {
        resolved = r;
        preview.className = 'msg';
        fill(preview, h('div', { class: 'profile-card' }, avatar(r.display, r.photo, 40),
          h('div', null, h('b', null, r.display), h('div', { class: 'meta' }, 'Имя и фото возьмём из профиля'))));
        if (!name.value.trim()) name.placeholder = 'Имя из профиля: ' + r.name;
      } else if (r.error && r.error.code === 'BAD_ACTION') {
        preview.className = 'msg err'; preview.textContent = 'Сервер (Apps Script) устарел: обновите Code.gs и создайте новую версию развёртывания.';
      } else if (r.error && r.error.needName) {
        preview.className = 'msg'; preview.textContent = 'Имя по ссылке определить не удалось — введите его вручную (или повторите проверку позже).';
      } else {
        preview.className = 'msg err'; preview.textContent = (r.error && r.error.message) || 'Ошибка проверки';
      }
    }
    const schedule = () => { chosen = null; clearTimeout(timer); timer = setTimeout(resolve, 600); };
    vk.addEventListener('change', () => { if (!chosen) resolve(); });
    const live=h('div',{class:'live-suggestions'});
    vk.addEventListener('input',async()=>{if(!A.players){const r=await act('adminPlayers');if(r){A.players=r.players;A.rules=r.rules;}}const t=norm(vk.value.trim());fill(live,t.length<2?null:(A.players||[]).filter(p=>norm(p.name).includes(t)||norm(p.url).includes(t)).slice(0,8).map(p=>h('button',{class:'btn btn-soft btn-block',onclick:()=>{choose(p);fill(live);}},p.name)));});
    vk.addEventListener('input', schedule);
    vk.addEventListener('paste', schedule);

    const btn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      err.textContent = ''; btn.disabled = true;
      clearTimeout(timer);
      if (pending) await pending;   // дожидаемся определения имени по ссылке
      const r = await api.post('adminBook', { password: A.pw, name: name.value, vkUrl: vk.value, playerKey: chosen ? chosen.key : '', numbers: nums, mode: mode.value, note: note.value });
      btn.disabled = false;
      if (!r.ok) { err.textContent = r.error.message; return; }
      setState(r); A.sel.clear(); closeModal(); renderTab(); toast('Забронировано: ' + list(nums));
    } }, 'Забронировать ' + list(nums));
    openModal([h('h3', null, 'Ручная бронь'),
      h('div', { class: 'field' }, h('label', null, 'Ссылка на профиль ВК'), vk, live, h('div', { style: { margin: '8px 0' } }, pickBtn), pickEl, preview,
        h('div', { class: 'hint' }, 'С ссылкой имя вводить не обязательно: имя и фото подтянутся из ВК.')),
      h('div', { class: 'field' }, h('label', null, 'Имя'), name),
      h('div', { class: 'field' }, h('label', null, 'Режим'), mode),
      h('div', { class: 'field' }, h('label', null, 'Заметка'), note), err, btn]);
    vk.focus();
  }

  // ───── Поздравление победителя (не изменяет итоги эфира) ─────
  // Открытка: предпросмотр и экспорт используют один и тот же canvas.
  function winnerView() {
    const number=h('input',{class:'input',type:'number',min:'1',max:String(A.st.ticketCount),placeholder:'Номерок победителя'});
    const preset=(A.st.form.find(x=>x.key==='winnerText')||{}).value||'Поздравляем с победой!';
    const message=h('textarea',{class:'input',rows:'2'});message.value=preset;
    const prize=h('input',{class:'input',type:'number',min:'0',step:'100',value:'12000'});
    const canvas=h('canvas',{class:'winner-premium-canvas',width:'1122',height:'1402'});
    const copyPreview=h('div',{class:'winner-copy-preview'});let current=null,revision=0;
    const bg=new Image();bg.src='assets/winner-premium-bg.png';bg.onload=()=>draw();
    const postText=()=>{if(!current)return '';
      const link=String(current.vkUrl||'').trim(),name=current.name||'Победитель';
      const tagged=/^https:\/\/(?:www\.)?(?:vk\.com|vk\.ru)\/[a-zA-Z0-9_.-]+\/?$/.test(link)?'['+link+'|'+name+']':name;
      return '💥Сегодня в '+A.st.event.number+'-м эфире '+tagged+' с номерком №'+current.n+' забирает шарнирное тело стоимостью до '+Number(prize.value||0).toLocaleString('ru-RU')+' руб. включительно, либо может доплатить разницу до более дорогого тела или комплектации.';
    };
    const loadPhoto=url=>new Promise(resolve=>{if(!/^https:\/\//.test(url||''))return resolve(null);const img=new Image();img.crossOrigin='anonymous';
      const timeout=setTimeout(()=>resolve(null),4500);img.onload=()=>{clearTimeout(timeout);resolve(img);};img.onerror=()=>{clearTimeout(timeout);resolve(null);};img.src=url;});
    const draw=async()=>{
      const rev=++revision,n=Number(number.value),matches=A.st.bookings.filter(b=>b.status==='ПОДТВЕРЖДЕНА'&&b.numbers.map(Number).includes(n));
      current=Number.isInteger(n)&&matches.length===1?{...matches[0],n}:null;
      const ctx=canvas.getContext('2d'),W=1122,H=1402;ctx.clearRect(0,0,W,H);
      if(bg.complete&&bg.naturalWidth)ctx.drawImage(bg,0,0,W,H);else{ctx.fillStyle='#390c23';ctx.fillRect(0,0,W,H);}
      const label=(t,x,y,font,color,max=950)=>{ctx.font=font;ctx.fillStyle=color;ctx.textAlign='center';ctx.shadowColor='rgba(35,5,18,.55)';ctx.shadowBlur=8;ctx.fillText(String(t),x,y,max);ctx.shadowBlur=0;};
      label('В О К',561,125,'66px Georgia, serif','#ffdda4');label('МАСТЕРСКАЯ ШАРНИРНЫХ ТЕЛ',561,171,'22px sans-serif','#f9ddb4');
      label('ПОЗДРАВЛЯЕМ',561,248,'82px Georgia, serif','#ffe6b4');label('победителя!',561,313,'italic 66px Georgia, serif','#ffe0a5');
      if(!current){label('Введите номерок подтверждённой брони',561,1065,'30px sans-serif','#fff0d6');fill(copyPreview);return;}
      const photo=await loadPhoto(current.photo);if(rev!==revision)return;
      ctx.save();ctx.beginPath();ctx.arc(306,628,232,0,Math.PI*2);ctx.clip();
      if(photo){const z=Math.max(464/photo.width,464/photo.height),w=photo.width*z,h=photo.height*z;ctx.drawImage(photo,306-w/2,628-h/2,w,h);}else{ctx.fillStyle='#6d2d48';ctx.fillRect(74,396,464,464);label((current.name||'?').slice(0,1),306,700,'bold 230px Georgia, serif','#f9d9a4');}ctx.restore();
      label('ЭФИР № '+A.st.event.number,822,490,'bold 34px sans-serif','#ffdb9c',405);
      const parts=String(current.name||'Победитель').trim().split(/\s+/);
      if(parts.length>1){label(parts[0],823,570,'italic 66px Georgia, serif','#fff1d5',425);label(parts.slice(1).join(' '),823,650,'italic 64px Georgia, serif','#fff1d5',425);}else label(parts[0],823,610,'italic 69px Georgia, serif','#fff1d5',425);
      label('№ '+current.n,818,825,'bold 124px Georgia, serif','#55132d',450);
      label('ШАРНИРНОЕ ТЕЛО',561,1035,'bold 39px Georgia, serif','#ffe5af');
      label('СТОИМОСТЬЮ ДО '+Number(prize.value||0).toLocaleString('ru-RU')+' ₽',561,1090,'bold 31px sans-serif','#fff2d5');
      const msg=message.value.replace(/\{name\}/g,current.name).replace(/\{number\}/g,String(n)).replace(/\{event\}/g,String(A.st.event.number));
      ctx.font='27px sans-serif';let lines=[],line='';for(const word of msg.split(/\s+/)){const t=line?line+' '+word:word;if(ctx.measureText(t).width>890&&line){lines.push(line);line=word;}else line=t;}if(line)lines.push(line);
      lines.slice(0,4).forEach((t,i)=>label(t,561,1215+i*38,'27px sans-serif','#fff1dc',930));
      fill(copyPreview,h('p',{class:'hint'},postText()));
    };
    number.addEventListener('input',draw);message.addEventListener('input',draw);prize.addEventListener('input',draw);draw();
    return h('section',{class:'card'},h('h2',null,'🎉 Премиальное поздравление победителя'),h('p',{class:'hint'},'Изображение — художественный фон, имя и номерок накладываются автоматически. Предпросмотр и PNG совпадают.'),
      h('div',{class:'field'},h('label',null,'Номерок победителя'),number),h('div',{class:'field'},h('label',null,'Стоимость подарка, ₽'),prize),h('div',{class:'field'},h('label',null,'Текст на открытке'),message),canvas,
      h('button',{class:'btn btn-primary btn-block',onclick:()=>{if(!current)return toast('Выберите подтверждённый номерок','bad');try{const a=document.createElement('a');a.download='BOK_победитель_'+A.st.event.number+'_'+current.n+'.png';a.href=canvas.toDataURL('image/png');a.click();}catch(e){toast('Не удалось сохранить фото: ограничение загрузки изображения ВК','bad');}}},'Сохранить открытку PNG 1122×1402'),
      h('h3',null,'Текст для поста ВК'),copyPreview,h('button',{class:'btn btn-soft btn-block',onclick:()=>{if(!current)return toast('Выберите номерок','bad');copyText(postText());toast('Текст скопирован');}},'📋 Скопировать поздравление'));
  }

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
      h('div', { class: 'set-group' }, h('h3', null, 'Параметры эфира и бронирования'), A.st.form.map((f) => control(f))),
      saveBtn,
      h('p', { class: 'note-foot' }, 'Время тихих часов и дедлайны считаются в часовом поясе организатора. Изменения часов на подтверждение действуют на новые брони.')),
      h('section', { class: 'card', style: { marginTop: '20px' } },
        h('h2', null, 'Завершение эфира'),
        h('p', { class: 'lead' }, 'Когда эфир прошёл: все брони уйдут во вкладку-архив в таблице, сетка очистится и начнётся следующий эфир.'),
        h('button', { class: 'btn btn-danger btn-block', onclick: openArchive }, '🏁 Завершить эфир и начать новый'),
        A.st.undo ? h('div', { style: { marginTop: '14px' } },
          h('p', { class: 'lead' }, 'Последнее закрытие: эфир №' + A.st.undo.event + (A.st.undo.archive ? ' (архив «' + A.st.undo.archive + '»)' : '') + '.'),
          A.st.undo.possible ? h('button', { class: 'btn btn-soft btn-block', onclick: undoClose }, '↩ Откатить закрытие эфира')
            : h('div', { class: 'msg' }, 'Откат недоступен: ' + A.st.undo.reason)) : null));
  }

  async function undoClose() {
    if (!window.confirm('Откатить закрытие эфира №' + A.st.undo.event + '? Брони и балансы вернутся к состоянию до закрытия.')) return;
    const r = await act('adminUndoClose', {}, 'Закрытие эфира отменено');
    if (r) { A.players = null; renderTab(); }
  }

  /** Участники эфира с подтверждёнными номерками (кандидаты в победители). */
  function participants() {
    const m = {}, order = [];
    A.st.bookings.forEach((b) => {
      if (b.status !== 'ПОДТВЕРЖДЕНА' || !b.key || b.key.indexOf('adm:') === 0 || b.key === 'block') return;
      if (!m[b.key]) { m[b.key] = { key: b.key, name: b.name, photo: b.photo, tickets: 0 }; order.push(b.key); }
      m[b.key].tickets += b.numbers.length;
    });
    return order.map((k) => m[k]).sort((x, y) => norm(x.name) < norm(y.name) ? -1 : 1);
  }

  function openArchive() {
    const st = A.st, cur = st.event.number;
    const nextNum = /^\d+$/.test(cur) ? String(Number(cur) + 1) : '';
    const open = st.bookings.filter((b) => NEEDS_CHECK.indexOf(b.status) >= 0).length;
    const people = participants();
    const win = new Set();
    let noWinner = false;
    const numInput = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Номер следующего эфира', value: nextNum });
    const dateInput = h('input', { class: 'input', type: 'text', maxlength: '100', placeholder: 'Например: в 20:00 1 декабря (можно задать позже)' });
    const force = h('input', { type: 'checkbox' });
    const err = h('div', { class: 'msg err' });
    const previewEl = h('div', null);
    const btn = h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '6px' } }, 'Проверить итоги');
    let checked = false;

    const body = () => ({ password: A.pw, winners: noWinner ? [] : Array.from(win), newNumber: numInput.value, newDate: dateInput.value, force: force.checked });
    const reset = () => { checked = false; btn.textContent = 'Проверить итоги'; btn.className = 'btn btn-primary btn-block'; fill(previewEl); err.textContent = ''; };
    const ready = () => (noWinner || win.size > 0) && (open === 0 || force.checked);
    const refreshBtn = () => { btn.disabled = !ready(); };
    force.addEventListener('change', () => { reset(); refreshBtn(); });
    [numInput, dateInput].forEach((i) => i.addEventListener('input', reset));

    const noBox = h('input', { type: 'checkbox', onchange: (e) => { noWinner = e.target.checked; if (noWinner) { win.clear(); boxes.forEach((x) => { x.checked = false; }); } reset(); refreshBtn(); } });
    const boxes = [];
    const rows = people.map((pp) => {
      const cb = h('input', { type: 'checkbox', onchange: (e) => {
        if (e.target.checked) { win.add(pp.key); noWinner = false; noBox.checked = false; } else win.delete(pp.key);
        reset(); refreshBtn();
      } });
      boxes.push(cb);
      return h('label', { class: 'prow', style: { cursor: 'pointer' } }, cb, avatar(pp.name, pp.photo, 32),
        h('div', { class: 'pname' }, h('b', null, pp.name), h('div', { class: 'meta' }, pp.tickets + ' номерк.')));
    });

    function drawPreview(r) {
      const sm = r.summary;
      fill(previewEl,
        h('div', { class: 'banner', style: { margin: '10px 0' } }, h('span', null, '📋'), h('span', null,
          'Участников: ' + sm.participants + ' · начислено номерков: ' + sm.credited + ' · победителей: ' + sm.winners +
          ' · пропусков: ' + sm.missed + ' · обнулено: ' + sm.burned + (sm.skipped ? ' · без ВК (не в зачёт): ' + sm.skipped : '') +
          (sm.unconfirmedClosed ? ' · закроются неподтверждённых: ' + sm.unconfirmedClosed : ''))),
        h('div', { class: 'blist', style: { maxHeight: '30vh' } }, r.changes.map((c) => h('div', { class: 'prow' },
          h('div', { class: 'pname' }, h('b', null, c.name + (c.isNew ? ' (новый)' : '')),
            h('div', { class: 'meta' }, c.type + ': ' + c.before.balance + ' → ' + c.after.balance + ' · пропусков ' + c.before.misses + ' → ' + c.after.misses + (c.comment ? ' · ' + c.comment : '')))))));
    }

    btn.addEventListener('click', async () => {
      err.textContent = ''; btn.disabled = true;
      if (!checked) {
        const r = await api.post('adminArchive', Object.assign(body(), { dryRun: true }));
        if (!r.ok) { err.textContent = r.error.message; refreshBtn(); return; }
        drawPreview(r);
        checked = true; btn.textContent = '🏁 Подтвердить: завершить эфир №' + cur; btn.className = 'btn btn-danger btn-block';
        btn.disabled = false;
        return;
      }
      const r = await api.post('adminArchive', body());
      if (!r.ok) { err.textContent = r.error.message; btn.disabled = false; return; }
      A.players = null;
      setState(r); closeModal(); renderTab();
      const a = r.archive;
      toast(a.rows ? 'Эфир №' + a.oldNumber + ' в архиве: «' + a.sheet + '», броней: ' + a.rows + '. Начат эфир ' + (a.newNumber ? '№' + a.newNumber : '(укажите номер в настройках)') + '.'
        : 'Начат эфир ' + (a.newNumber ? '№' + a.newNumber : '(укажите номер в настройках)') + '.', null, 12000);
    });
    refreshBtn();

    openModal([
      h('h3', null, 'Завершить эфир №' + cur + '?'),
      h('p', { class: 'lead' }, 'Брони уйдут во вкладку «Архив №' + cur + '», сетка очистится. Участникам, не выигравшим, номерки этого эфира накопятся на балансе; победитель теряет накопленное.'),
      open > 0 ? h('div', { class: 'banner warn', style: { margin: '0 0 12px' } }, h('span', null, '⚠️'), h('span', null,
        'Неподтверждённых броней: ' + open + '. ', h('label', { class: 'sw', style: { marginTop: '8px' } }, force, 'Закрыть их вместе с эфиром (в архиве — со статусом «ИСТЕКЛА»)'))) : null,
      h('div', { class: 'field' }, h('label', null, 'Кто победил? (отметьте одного или нескольких)'),
        people.length ? h('div', { class: 'blist', style: { maxHeight: '28vh' } }, rows) : h('div', { class: 'hint' }, 'Нет подтверждённых участников со ссылкой ВК.'),
        h('label', { class: 'sw', style: { marginTop: '8px' } }, noBox, 'Без победителя')),
      h('div', { class: 'field' }, h('label', null, 'Номер следующего эфира'), numInput),
      h('div', { class: 'field' }, h('label', null, 'Дата и время следующего эфира'), dateInput),
      previewEl, err, btn]);
  }

  // ───── Игроки ─────
  async function loadPlayers() {
    const r = await act('adminPlayers');
    A.pl = false;
    if (r) { A.players = r.players; A.rules = r.rules; }
    if (A.tab === 'players') renderTab();
  }
  const adoptPlayers = (r) => { A.players = r.players; A.rules = r.rules; };
  const crosses = (n) => (n > 0 ? h('span', { class: 'xs', title: 'Пропусков подряд: ' + n }, '✖'.repeat(n)) : null);

  function giftsView() {
    const body=h('div'),catalogBox=h('div'),suggestions=h('div');
    const player=h('input',{class:'input',placeholder:'Имя или ссылка ВК'});
    const catalogSelect=h('select',{class:'input'}),event=h('input',{class:'input',value:String(A.st.event.number),placeholder:'Номер эфира'});
    let chosen=null,expanded=new Set(),last=[];
    const renderCatalog=items=>{
      fill(catalogSelect,h('option',{value:''},'— Выберите подарок из каталога —'),...items.filter(x=>x.active).map(x=>h('option',{value:x.id},x.title)));
      const newTitle=h('input',{class:'input',placeholder:'Название нового подарка'});
      fill(catalogBox,h('h3',null,'📚 Каталог подарков'),h('p',{class:'hint'},'Каталог общий для всех эфиров. Неактивные позиции не предлагаются для новых назначений.'),
        h('div',{class:'gift-catalog-list'},...items.map(x=>h('div',{class:'gift-catalog-row'},h('span',null,x.title),h('button',{class:'btn btn-soft btn-sm',onclick:async()=>{const r=await act('adminGiftCatalogSet',{id:x.id,active:!x.active});if(r)renderCatalog(r.catalog);}},x.active?'Отключить':'Включить')))),
        h('div',{class:'gift-add-row'},newTitle,h('button',{class:'btn btn-soft',onclick:async()=>{if(!newTitle.value.trim())return toast('Введите название','bad');const r=await act('adminGiftCatalogAdd',{title:newTitle.value});if(r)renderCatalog(r.catalog);}},'Добавить в каталог')));
    };
    const renderList=()=>{
      const groups=new Map();for(const g of last){const id=g.key||g.name;if(!groups.has(id))groups.set(id,{name:g.name,gifts:[]});groups.get(id).gifts.push(g);}
      const arr=Array.from(groups.entries()).sort((a,b)=>a[1].name.localeCompare(b[1].name,'ru'));
      fill(body,arr.length?arr.map(([key,group])=>{
        const pending=group.gifts.filter(g=>!g.received).length,done=group.gifts.length-pending;
        return h('div',{class:'gift-player-group'},h('button',{class:'gift-player-head',onclick:()=>{expanded.has(key)?expanded.delete(key):expanded.add(key);renderList();}},
          h('span',null,(expanded.has(key)?'▾ ':'▸ ')+group.name),h('span',{class:'gift-counts'},'📦 Ожидают: '+pending+'   ·   ✅ Получено: '+done)),
          expanded.has(key)?h('div',{class:'gift-player-items'},...group.gifts.slice().reverse().map(g=>h('div',{class:'gift-item-row'},
            h('div',null,h('b',null,g.title),h('div',{class:'meta'},'Эфир №'+(g.event||'—')+' · '+(g.received?'Получен '+(g.receivedAt||''):'Ожидает выдачи'))),
            h('button',{class:'btn btn-soft btn-sm',onclick:async()=>{const r=await act('adminGiftReceived',{id:g.id,received:!g.received});if(r){last=r.gifts;renderList();}}},g.received?'Отменить получение':'Отметить полученным')))):null);
      }):h('p',{class:'hint'},'Подарков пока нет'));
    };
    const refresh=async()=>{const r=await act('adminGifts');if(!r)return;last=r.gifts||[];renderList();renderCatalog(r.catalog||[]);};
    const lookup=async()=>{if(!A.players){const r=await act('adminPlayers');if(!r)return;A.players=r.players;A.rules=r.rules;}
      const q=norm(player.value.trim());fill(suggestions,q.length<2?null:A.players.filter(p=>norm(p.name).includes(q)||norm(p.url).includes(q)).slice(0,8).map(p=>h('button',{class:'btn btn-soft btn-block',onclick:()=>{chosen=p;player.value=p.name;fill(suggestions);}},p.name)));
    };
    player.addEventListener('input',()=>{chosen=null;lookup();});
    const add=h('button',{class:'btn btn-primary btn-block',onclick:async()=>{if(!chosen)return toast('Выберите участника из подсказок','bad');if(!catalogSelect.value)return toast('Выберите подарок','bad');const r=await act('adminGiftAdd',{key:chosen.key,catalogId:catalogSelect.value,event:event.value});if(r){last=r.gifts;expanded.add(chosen.key);renderList();toast('Подарок назначен');}}},'Назначить подарок');
    refresh();return h('section',{class:'card'},h('h2',null,'🎁 Подарки участников'),h('p',{class:'hint'},'Нажмите на имя, чтобы увидеть все подарки участника. Получение подтверждается вручную.'),
      h('div',{class:'gift-assignment'},h('h3',null,'Назначить подарок'),player,suggestions,catalogSelect,event,add),h('h3',null,'Участники с подарками'),body,
      h('details',{class:'gift-catalog-panel'},h('summary',null,'⚙ Управление каталогом подарков'),catalogBox));
  }

  function playersView() {
    if (!A.players) {
      if (!A.pl) { A.pl = true; loadPlayers(); }
      return h('section', { class: 'card' }, h('p', { class: 'lead' }, 'Загружаем игроков…'));
    }
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по имени или ссылке', value: A.pq, autocomplete: 'off' });
    const listEl = h('div', { class: 'blist', style: { maxHeight: 'none' } });
    const filters={miss:new Set([2]),frozen:false,zero:false,ex:false,win:false,sort:'name'};
    const filtersEl=h('div',{class:'filters'},h('span',null,'Пропуски:'),...[0,1,2,3,4].map(n=>h('label',{class:'sw fl'},h('input',{type:'checkbox',checked:n===2,onchange:e=>{e.target.checked?filters.miss.add(n):filters.miss.delete(n);draw();}}),'❌'+n)),...[[ 'frozen','❄ Показывать замороженных'],['zero','Нулевой баланс'],['ex','Можно обменять'],['win','Победители']].map(([key,label])=>h('label',{class:'sw fl'},h('input',{type:'checkbox',onchange:e=>{filters[key]=e.target.checked;draw();}}),label)),h('select',{class:'input',onchange:e=>{filters.sort=e.target.value;draw();}},...[['name','По имени'],['balance','По балансу ↓'],['misses','По пропускам ↓'],['wins','По победам ↓'],['freezeTo','По сроку заморозки']].map(([v,label])=>h('option',{value:v},label))));
    const rules = A.rules || {};
    const draw = () => {
      const t = norm(A.pq.trim());
      const rows = A.players.filter(p=>(!t||norm(p.name).includes(t)||norm(p.url).includes(t))&&(filters.frozen||!p.frozen)&&(filters.zero||p.balance>0)&&(!filters.miss.size||filters.miss.has(Math.min(4,p.misses||0)))&&(!filters.ex||p.balance>=Number(rules.exchangeMin||30))&&(!filters.win||p.wins>0)).sort((a,b)=>filters.sort==='name'?norm(a.name).localeCompare(norm(b.name)):(Number(b[filters.sort]||0)-Number(a[filters.sort]||0)));
      fill(listEl, rows.length ? rows.map((p) => h('div', { class: 'prow', style: { cursor: 'pointer' }, onclick: () => openPlayer(p.key) },
        avatar(p.name, p.photo, 38),
        h('div', { class: 'pname' }, h('b', {class:p.frozen?'frozen-name':''}, p.name),
          h('div', { class: 'chips' }, h('span', { class: 'bal' }, '🎟 ' + p.balance), crosses(p.misses), p.frozen ? h('span', { class: 'frz snow-big',title:p.freezeTo?'До бесплатной разморозки '+Math.max(0,Math.ceil((p.freezeTo-Date.now())/86400000))+' дн.':'Старая бессрочная заморозка' }, '❄ '+(p.freezeTo?Math.max(0,Math.ceil((p.freezeTo-Date.now())/86400000))+' дн.':'∞')) : null,
            rules.exchangeMin && p.balance >= rules.exchangeMin ? h('span', { class: 'chip ex' }, '⭐ можно обменять') : null,
            p.wins ? h('span', { class: 'meta' }, '🏆 ' + p.wins) : null)))) : h('div', { class: 'empty' }, A.players.length ? 'Никого не нашли' : 'Игроков пока нет. Они появятся после первого завершённого эфира или добавьте вручную.'));
    };
    q.addEventListener('input', () => { A.pq = q.value; draw(); });
    draw();
    return h('div', null,
      h('section', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
          h('button', { class: 'btn btn-primary btn-sm', onclick: openAddPlayer }, '＋ Добавить игрока'),
          h('button', { class: 'btn btn-soft btn-sm', onclick: () => runImport(true) }, 'Импорт из таблицы: проверить'),
          h('button', { class: 'btn btn-soft btn-sm', onclick: () => runImport(false) }, 'Импорт из таблицы: загрузить')),
        h('p', { class: 'hint' }, 'Игроков: ' + A.players.length + '. Курс: 1 номерок = ' + (rules.rate || '—') + ' ₽, обмен от ' + (rules.exchangeMin || '—') + '. Импорт читает лист «Импорт» в таблице (ссылка ВК, имя, баланс, пропуски, заметка).'),
        q, filtersEl, listEl));
  }

  async function runImport(dry) {
    if (!dry && !window.confirm('Загрузить игроков из листа «Импорт»? Уже обработанные строки пропускаются.')) return;
    const r = await act('adminImport', { dryRun: dry });
    if (!r) return;
    openModal([h('h3', null, dry ? 'Проверка импорта' : 'Импорт выполнен'),
      h('p', { class: 'lead' }, (dry ? 'Будет создано/обновлено: ' + r.created : 'Создано: ' + r.created + ', обновлено: ' + r.updated) + ' · ошибок: ' + r.errors + (r.skipped ? ' · уже обработано: ' + r.skipped : '') + (r.remaining ? ' · осталось (запустите ещё раз): ' + r.remaining : '')),
      r.problems && r.problems.length ? h('div', { class: 'blist' }, r.problems.map((x) => h('div', { class: 'msg err' }, 'Строка ' + x.row + ': ' + x.text))) : null]);
    if (!dry) { A.players = null; renderTab(); }
  }

  function openAddPlayer() {
    const vk = h('input', { class: 'input', type: 'text', placeholder: 'vk.com/id… или vk.com/ник', autocapitalize: 'off', spellcheck: 'false' });
    const name = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Имя (если пусто — из профиля ВК)' });
    const bal = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'Стартовый баланс, номерков', value: '0' });
    const miss = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'Пропусков подряд', value: '0' });
    const note = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Заметка (необязательно)' });
    const err = h('div', { class: 'msg err' });
    const btn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      err.textContent = ''; btn.disabled = true;
      const r = await api.post('adminPlayerAdd', { password: A.pw, vkUrl: vk.value, name: name.value, balance: bal.value, misses: miss.value, note: note.value });
      btn.disabled = false;
      if (!r.ok) { err.textContent = r.error.message; return; }
      adoptPlayers(r); closeModal(); renderTab(); toast('Игрок добавлен');
    } }, 'Добавить');
    openModal([h('h3', null, 'Новый игрок'),
      h('div', { class: 'field' }, h('label', null, 'Ссылка на профиль ВК'), vk),
      h('div', { class: 'field' }, h('label', null, 'Имя'), name),
      h('div', { class: 'field' }, h('label', null, 'Накопленные номерки'), bal),
      h('div', { class: 'field' }, h('label', null, 'Текущее число пропусков (✖)'), miss),
      h('div', { class: 'field' }, h('label', null, 'Заметка'), note), err, btn]);
    vk.focus();
  }

  function openPlayer(key) {
    const p = A.players.find((x) => x.key === key);
    if (!p) return;
    const rules = A.rules || {};
    const err = h('div', { class: 'msg err' });
    const doAct = async (action, extra, okText) => {
      err.textContent = '';
      const r = await api.post(action, Object.assign({ password: A.pw, key }, extra));
      if (!r.ok) { err.textContent = r.error.message; return null; }
      adoptPlayers(r); toast(okText || 'Готово'); renderTab(); openPlayer(key);
      return r;
    };
    const delta = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: '+5 или -3' });
    const reason = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Причина (необязательно)' });
    const miss = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: String(p.misses) });
    const exN = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: String(p.balance) });
    const exNote = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Промокод / комментарий (необязательно)' });
    const hist = h('div', { class: 'blist' });
    const group = (title, ...kids) => h('div', { class: 'set-group' }, h('h3', null, title), kids);
    openModal([
      h('div', { class: 'profile-card' }, avatar(p.name, p.photo, 48),
        h('div', null, h('b', null, p.name), h('div', { class: 'meta' }, p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.url) : ''))),
      h('p', { class: 'lead' }, '🎟 баланс: ', h('b', null, p.balance), ' · пропусков: ', crosses(p.misses) || '0', ' · побед: ' + p.wins + ' · куплено за всё время: ' + p.bought + (p.frozen ? ' · ❄ заморожен' : '')),
      group('Начислить или списать', h('div', { class: 'field' }, delta), h('div', { class: 'field' }, reason),
        h('button', { class: 'btn btn-primary btn-block', onclick: () => doAct('adminPlayerAdjust', { delta: delta.value, reason: reason.value }, 'Баланс изменён') }, 'Применить')),
      group('Пропуски', h('div', { class: 'field' }, miss, h('div', { class: 'hint' }, 'От 0 до ' + Math.max(0, (rules.missLimit || 3) - 1) + '; на ' + (rules.missLimit || 3) + '-м баланс обнуляется')),
        h('button', { class: 'btn btn-soft btn-block', onclick: () => doAct('adminPlayerSetMisses', { misses: miss.value }, 'Пропуски обновлены') }, 'Сохранить пропуски')),
      group('Заморозка',
        h('p', { class: 'hint' }, p.frozen
          ? (p.freezeTo ? 'Заморожен до ' + fmtDT(p.freezeTo, off()) + '. Бронировать за этого участника нельзя.' : 'Старая бессрочная заморозка. Разморозка без штрафа.')
          : 'От 10 накопленных номерков. Срок задаётся в настройках. При досрочной разморозке штраф 1 номерок.'),
        ...(p.frozen ? [h('button', { class: 'btn btn-soft btn-block', onclick: () => {
          const early = !!p.freezeTo && p.freezeTo > Date.now();
          if (!window.confirm(early ? 'Досрочно разморозить и списать 1 номерок?' : 'Снять старую бессрочную заморозку без штрафа?')) return;
          doAct('adminPlayerFreeze', { frozen: false, confirmPenalty: early }, 'Разморожено');
        } }, 'Разморозить')] : [
          h('div', { class: 'field' }, h('label', null, 'Срок заморозки, дней (по настройкам)'),
            (() => { const inp = h('input', { class: 'input', type: 'number', min: '1', max: '90', step: '1', value: '30' });
              return h('div', null, inp, h('button', { class: 'btn btn-soft btn-block', onclick: () => {
                const days = Number(inp.value);
                if (!Number.isInteger(days) || days < 1 || days > 90) { toast('Укажите целое число от 1 до 90; сервер проверит действующие лимиты', 'bad'); return; }
                if (!window.confirm('Заморозить баланс на ' + days + ' дней? Бронирование будет недоступно.')) return;
                doAct('adminPlayerFreeze', { frozen: true, days }, 'Баланс заморожен');
              } }, '❄ Заморозить')); })())
        ])),
      group('Обмен на скидку (от имени игрока)',
        h('p', { class: 'hint' }, 'Курс: 1 номерок = ' + (rules.rate || 0) + ' ₽. Минимум для обмена игроком — ' + (rules.exchangeMin || 0) + '. Промокод выдайте игроку в ВК вручную.'),
        h('div', { class: 'field' }, h('label', null, 'Сколько номерков списать'), exN), h('div', { class: 'field' }, exNote),
        h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
          const n = Number(exN.value) || 0;
          if (!window.confirm('Списать ' + n + ' номерк. = скидка ' + Math.round(n * (rules.rate || 0)) + ' ₽ для ' + p.name + '?')) return;
          const r = await doAct('adminExchange', { tickets: exN.value, note: exNote.value }, 'Обмен выполнен');
          if (r && r.discountRub !== undefined) toast('Скидка для игрока: ' + r.discountRub + ' ₽', null, 10000);
        } }, 'Обменять')),
      group('История', h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        const r = await api.post('adminPlayerHistory', { password: A.pw, key });
        if (!r.ok) { err.textContent = r.error.message; return; }
        fill(hist, r.history.length ? r.history.map((x) => h('div', { class: 'prow' }, h('div', { class: 'pname' },
          h('b', null, x.type + (x.delta ? ' ' + (x.delta > 0 ? '+' : '') + x.delta : '')),
          h('div', { class: 'meta' }, fmtDT(x.time, off()) + ' · баланс ' + x.balance + ' · пропусков ' + x.misses + (x.event ? ' · эфир ' + x.event : '') + (x.comment ? ' · ' + x.comment : ''))))) : h('div', { class: 'empty' }, 'Записей нет'));
      } }, 'Показать историю'), hist),
      err]);
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
