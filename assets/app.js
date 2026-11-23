/* Номерок — публичная страница бронирования. */
(function () {
  'use strict';
  const { h, fill, api, nowMs, tzName, fmtDT, fmtLeft, fmtMin, timerNodes, tickTimer, clientId, store, copyText, toast, avatar, qrSvg, safeUrl, DEMO } = Nomerok;

  const CLIENT = clientId();
  const POLL_MS = 8000;
  const S = { st: null, mine: [], quiet: null, sel: new Set(), search: '', loaded: false };
  const UNCONF = ['ОЖИДАЕТ', 'ОПЛАТА ЗАЯВЛЕНА'];

  // ───── Скелет страницы (строится один раз) ─────
  const heroEl = h('header', { class: 'hero' });
  const bannerEl = h('div');
  const stepsEl = h('details', { class: 'card', style: { marginTop: '20px' } });
  const mineEl = h('div');
  const gridEl = h('div', { class: 'grid', role: 'group', 'aria-label': 'Номерки' });
  const coverEl = h('div', { class: 'soldout hidden' });          // «Все места забронированы…» поверх сетки
  const waitEl = h('div');                                         // «Идёт подтверждение…» над сеткой
  const gridWrap = h('div', { class: 'gridwrap' }, gridEl, coverEl);
  const legendEl = h('div', { class: 'legend' });
  const actionEl = h('div', { class: 'actionbar hidden' });
  const gridCard = h('section', { class: 'card' },
    h('h2', null, 'Выберите свои номерки'),
    h('p', { class: 'lead' }, 'Нажмите на свободные номерки — они подсветятся. Затем нажмите «Забронировать».'),
    waitEl, gridWrap, legendEl, actionEl);
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
      h('div', { class: 'hero-top' }, h('div', { class: 'hero-status' }, h('span', { class: 'pill solid' }, 'Эфир №' + st.event.number), h('span', { class: 'pill' }, status)), h('nav', { class: 'hero-actions', 'aria-label': 'Разделы сервиса' },
        h('button', { class: 'pill admin-link', type: 'button', onclick: openBalances, title: 'Накопленные номерки и пропуски участников' }, '🎟 Балансы'),
        h('button', { class: 'pill admin-link', type: 'button', onclick: () => openCabinet() }, '👤 Мой кабинет'),
        h('a', { class: 'pill admin-link', href: 'admin.html', title: 'Вход для организатора' }, store('nomerok_admin_pw') ? '⚙ Админка' : '🔐 Админ'))),
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
      ? h('p', { class: 'meta', style: { margin: '8px 0 0' } }, timerNodes(b, S.quiet || S.st.quiet, off()))
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

  /** Первое предложение (или первая строка) выводится крупно, остальное — подписью. */
  function soldOutParts(text) {
    const lines = String(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
    let first = lines[0] || '', rest = lines.slice(1);
    if (lines.length === 1) {
      const m = first.match(/^(.*?[.!?…])\s+(.+)$/);
      if (m) { first = m[1]; rest = [m[2]]; }
    }
    return [h('div', { class: 'soldout-big' }, first)].concat(rest.map((r) => h('div', { class: 'soldout-sub' }, r)));
  }

  function renderOverlay() {
    const o = S.st.overlay;
    const sold = !!(o && o.kind === 'soldout');
    gridWrap.classList.toggle('is-covered', sold);
    coverEl.classList.toggle('hidden', !sold);
    fill(coverEl, sold ? h('div', { class: 'soldout-card', role: 'status' },
      h('div', { class: 'soldout-emoji', 'aria-hidden': 'true' }, '🎟️'), soldOutParts(o.text)) : null);
    fill(waitEl, o && o.kind === 'waiting'
      ? h('div', { class: 'banner info', style: { marginBottom: '14px' }, role: 'status' }, h('span', null, '⏳'), h('span', null, o.text)) : null);
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
  /** Баланс номерков и пропуски: «🎟 12 ✖✖». bal может быть числом, «10+» или null (скрыт). */
  function marks(p) {
    const nodes = [];
    if (p.bal !== null && p.bal !== undefined && p.bal !== 0 && p.bal !== '0') nodes.push(h('span', { class: 'bal', title: 'Накопленные номерки' }, '🎟 ' + p.bal));
    if (p.frozen) nodes.push(h('span', { class: 'frz snow-big', title: 'Баланс заморожен: пропуски не считаются' }, '❄'));
    if (p.miss > 0) nodes.push(h('span', { class: 'xs', title: 'Пропусков подряд: ' + p.miss, 'aria-label': 'Пропусков подряд: ' + p.miss }, '✖'.repeat(p.miss)));
    return nodes.length ? h('span', { class: 'marks' }, nodes) : null;
  }

  async function openBalances() {
    const box = h('div', null, h('p', { class: 'lead' }, 'Загружаем…'));
    openModal([h('h3', null, '🎟 Накопленные номерки'), box]);
    const r = await api.balances();
    if (!r.ok) { fill(box, h('div', { class: 'msg err' }, (r.error && r.error.message) || 'Не удалось загрузить')); return; }
    const rules = r.rules || {};
    const all = r.players || [];
    const F = { zero: false, ex: false, win: false, frozen: false, misses: new Set([2,3]) };
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по имени, никнейму или ссылке VK', autocomplete: 'off' });
    const list = h('div', { class: 'btable' });
    const count = h('div', { class: 'hint' });
    const check = (key, label) => h('label', { class: 'sw fl' }, h('input', { type: 'checkbox', onchange: (e) => { F[key] = e.target.checked; draw(); } }), label);
    const num = (v, cls) => h('span', { class: 'n' + (cls ? ' ' + cls : '') }, v === null || v === undefined ? '—' : String(v));

    function draw() {
      const t = norm(q.value.trim());
      const rows = all.filter((p) => {
        if (!F.zero && p.zero) return false;                     // нулевой баланс скрыт, пока не включён фильтр
        if (!F.frozen && p.frozen) return false;
        if (F.misses.size && !F.misses.has(Number(p.miss||0))) return false;
        if (F.ex && !p.ex) return false;
        if (F.win && !(p.wins > 0)) return false;
        return !t || window.BokPlayerSearch.filter([p],q.value,1).length > 0;
      });
      count.textContent = 'Показано ' + rows.length + ' из ' + all.length;
      fill(list,
        h('div', { class: 'brow bhead' }, h('span', null, 'Участник'), h('span', { class: 'n', title: 'Накопленные номерки' }, '🎟'),
          h('span', { class: 'n', title: 'Победы' }, '🏆'), h('span', { class: 'n', title: 'Обменено номерков за всё время' }, '🔄'),
          h('span', { class: 'n', title: 'Пропуски эфиров подряд' }, '✖'),h('span',{class:'n'},'❄')),
        rows.length ? rows.map((p) => h('div', { class: 'brow' + (p.ex ? ' ready' : '') },
          h('button', { class: 'bn participant-link', type: 'button', title: 'Открыть кабинет участника', onclick: () => openCabinet(p.url || p.name) }, avatar(p.name, p.photo, 22), h('b', null, p.name), p.frozen ? h('span', { class: 'frz', title: 'Баланс заморожен' }, '❄') : null,
            p.ex ? h('span', { class: 'star', title: 'Можно обменять' + (p.worth ? ' на ' + p.worth + ' ₽' : '') }, '⭐') : null),
          num(p.bal, p.ex ? 'bal' : ''), num(p.wins || 0), num(p.exch || 0),
          h('span', { class: 'n' }, p.miss > 0 ? h('span', { class: 'xs' }, '✖'.repeat(p.miss)) : '·'), h('span',{class:'n freeze-days'},p.frozen?(p.freezeTo?Math.max(0,Math.ceil((p.freezeTo-Date.now())/86400000))+' дн.':'∞'):'—')))
          : h('div', { class: 'empty' }, all.length ? 'Никого не нашли — попробуйте изменить фильтры' : 'Пока нет данных'));
    }
    q.addEventListener('input', draw);
    draw();
    fill(box,
      rules.notice ? h('div', { class: 'banner warn', style: { margin: '0 0 12px' } }, h('span', null, '⚠️'), h('span', null, rules.notice)) : null,
      h('p', { class: 'lead' }, 'Номерки копятся, если вы участвовали в эфире и не выиграли. Победитель теряет накопленное. ',
        rules.exchangeMin ? 'От ' + rules.exchangeMin + ' номерков можно обменять на скидку' + (rules.rate ? ' (1 номерок = ' + rules.rate + ' ₽)' : '') + '. ' : '',
        h('span', { class: 'meta' }, '🎟 накоплено · 🏆 побед · 🔄 обменено · ✖ пропусков подряд')),
      q,
      h('div', { class: 'filters' }, check('zero', 'С нулевым балансом'), check('ex', 'Можно обменять ⭐'), check('win', 'Только победители')),
      h('div',{class:'filters'},h('span',null,'Пропуски:'),...[0,1,2,3].map(n=>h('label',{class:'sw fl'},h('input',{type:'checkbox',checked:n===2||n===3||n===3,onchange:e=>{if(e.target.checked)F.misses.add(n);else F.misses.delete(n);draw();}}),'❌'+n)),h('label',{class:'sw fl'},h('input',{type:'checkbox',onchange:e=>{F.frozen=e.target.checked;draw();}}),'❄ Показывать замороженных')),
      count, list,
      rules.url ? h('a', { class: 'btn btn-primary btn-block', href: safeUrl(rules.url), target: '_blank', rel: 'noopener', style: { marginTop: '12px' } }, rules.button || 'ОБМЕНЯТЬ НА СКИДКУ') : null);
  }

  // Публичный кабинет БЕЗ авторизации: только те сведения, которые уже видны всем в списке балансов.
  // Нельзя выдавать его за подтверждение владения аккаунтом или давать операции с балансом.
  async function openCabinet(target, publicMode=false) {
    const identity=window.BokVK&&window.BokVK.profile();
    if(!identity && !publicMode) {
      const content=h('div',null,
        h('p',{class:'lead'},'Войдите через ВКонтакте, чтобы открыть свой кабинет.'),
        h('div',{class:'cab-vk-login'}),
        h('p',{class:'hint'},'Вход сохраняется на этом устройстве до ручного выхода.'),
        h('p',{class:'hint'},'Тестовый депозит и действия с балансом доступны только после подтверждённого входа через VK ID.'),
        h('button',{class:'btn btn-soft btn-block',onclick:()=>{closeModal();openCabinet(target,true);}},'Найти участника без VK ID'));
      openModal([h('h3',null,'🔐 Кабинет ВОК — вход через VK ID'),content]);
      const error=h('p',{class:'msg err',role:'alert'});content.appendChild(error);
      if(!window.BokVK){error.textContent='Модуль VK ID недоступен';return;}
      window.BokVK.mount(content.querySelector('.cab-vk-login'),()=>{closeModal();openCabinet();},
        e=>{error.textContent='Ошибка входа VK ID: '+(e&&e.message||'повторите вход');});
      return;
    }
    const box=h('div',{class:'bok-cab-body'},h('p',{class:'lead'},'Загружаем публичные данные…'));
    const cabinetSheet=openModal([h('h3',null,identity?'👤 Личный кабинет · VK ID':'👤 Кабинет участника (без авторизации)'),box]);
    cabinetSheet.classList.add('bok-cabinet-sheet');
    const r=await api.balances();
    if(!r.ok){fill(box,h('p',{class:'msg err'},'Ошибка загрузки'));return;}
    const players=r.players||[],rules=r.rules||{};
    const q=h('input',{class:'input',type:'search',placeholder:'Имя или ссылка ВК',value:store('nomerok_cabinet')||store('nomerok_vk')||'',autocomplete:'off'});
    const matches=h('div');
    const verifiedSession=identity&&window.BokVK&&window.BokVK.token&&window.BokVK.token()?await api.post('vkCabinetState',{vkAccessToken:window.BokVK.token()}):null;
    const select=async p=>{
      store('nomerok_cabinet',p.url||p.name);
      const left=p.freezeTo?Math.max(0,Math.ceil((p.freezeTo-Date.now())/86400000)):null;
      const authenticated=!!(verifiedSession&&verifiedSession.ok&&verifiedSession.verified&&verifiedSession.player&&verifiedSession.player.url===p.url);
      const token=window.BokVK&&window.BokVK.token&&window.BokVK.token();
      const privateData=authenticated&&token?verifiedSession:null;
      const verified=!!(privateData&&privateData.ok&&privateData.verified);
      const privatePlayer=verified?privateData.player:null;
      const privateDeposit=verified?privateData.deposit:null;
      // Заморозка доступна только при накопительном балансе от 10 номерков.
      // У уже замороженного игрока управление разморозкой остаётся доступным.
      const freezeBalance=Number(privatePlayer&&privatePlayer.balance!=null?privatePlayer.balance:
        privatePlayer&&privatePlayer.bal!=null?privatePlayer.bal:p.bal);
      const showFreeze=authenticated&&verified&&(
        !!privatePlayer.frozen||(Number.isFinite(freezeBalance)&&freezeBalance>=10));
      const freezeUI=showFreeze?h('section',{class:'cab-freeze-panel bok-cab-panel'},
        h('h4',null,privatePlayer&&privatePlayer.frozen?'❄ Разморозка':'❄ Самостоятельная заморозка'),
        verified?(privatePlayer.frozen?
          h('button',{class:'btn btn-primary btn-block',onclick:async()=>{
            if(!window.confirm('Досрочно разморозить баланс со списанием 1 накопленного номерка?'))return;
            const r=await api.post('vkCabinetFreeze',{vkAccessToken:window.BokVK.token(),frozen:false,confirmPenalty:true});
            if(r.ok){toast('Баланс разморожен');closeModal();openCabinet();}
            else toast((r.error&&r.error.message)||'Ошибка разморозки','bad');
          }},'Разморозить (−1 номерок)'):
          h('div',null,h('p',{class:'hint'},'Срок заморозки: '+privateData.rules.freezeMinDays+'–'+privateData.rules.freezeMaxDays+' дней.'),
            h('input',{class:'input',type:'number',min:privateData.rules.freezeMinDays,max:privateData.rules.freezeMaxDays,value:'14',id:'bok-freeze-days'}),
            h('button',{class:'btn btn-primary btn-block',onclick:async()=>{
              const days=Number(document.getElementById('bok-freeze-days').value);
              if(!Number.isInteger(days)||days<privateData.rules.freezeMinDays||days>privateData.rules.freezeMaxDays)return toast('Недопустимый срок','bad');
              if(!window.confirm('Заморозить накопительный баланс на '+days+' дней?'))return;
              const r=await api.post('vkCabinetFreeze',{vkAccessToken:window.BokVK.token(),frozen:true,days:days});
              if(r.ok){toast('Баланс заморожен');closeModal();openCabinet();}
              else toast((r.error&&r.error.message)||'Ошибка заморозки','bad');
            }},'Заморозить баланс'))):
          h('div',null,h('p',{class:'msg err'},privateData&&privateData.error?privateData.error.message:'Требуется повторный вход через VK ID'),
            h('button',{class:'btn btn-soft btn-block',onclick:()=>{window.BokVK.logout();closeModal();openCabinet();}},'Повторить вход'))
      ):null;
      const exchangeMin=Number(rules.exchangeMin)||0;
      const exchangeBalance=Number(privatePlayer&&privatePlayer.balance!=null?privatePlayer.balance:
        privatePlayer&&privatePlayer.bal!=null?privatePlayer.bal:p.bal);
      const exchangeUrl=safeUrl(rules.url);
      const exchangeUI=authenticated&&exchangeMin>0&&Number.isFinite(exchangeBalance)&&exchangeBalance>=exchangeMin&&exchangeUrl?
        h('a',{class:'btn btn-primary btn-block bok-cab-exchange',href:exchangeUrl,target:'_blank',rel:'noopener noreferrer'},
          rules.button||'Обменять баланс на скидку'):null;
      // BOK 6.7.16: Xbox-style progress cards. Never guess missing historic
      // progress: old GAS returns award flags, not quantitative metrics.
      const achBox=h('section',{class:'cab-achievements bok-achievements'});
      const achDetails=h('details',{class:'bok-ach-details',open:true});
      const achCount=h('span',{class:'bok-ach-count'},'Загружаем…');
      const achHeading=h('span',{class:'bok-ach-heading'},
        h('span',{class:'bok-ach-trophy','aria-hidden':'true'},'🏆'),
        h('span',null,'Достижения · ',achCount));
      const achToggle=h('span',{class:'bok-ach-toggle','aria-hidden':'true'},'Свернуть ⌃');
      const achSummary=h('summary',{class:'bok-ach-summary'},achHeading,achToggle);
      const achBody=h('div',{class:'bok-ach-body'},
        h('p',{class:'hint'},'Загружаем достижения…'));
      achDetails.appendChild(achSummary);
      achDetails.appendChild(achBody);
      achBox.appendChild(achDetails);
      achDetails.addEventListener('toggle',()=>{
        achToggle.textContent=achDetails.open?'Свернуть ⌃':'Развернуть ⌄';
      });
      const achIconMap={
        streak5:'🧵',streak10:'🧶',streak15:'👑',
        visits10:'👧',visits20:'🎀',visits30:'🏰',
        tickets5:'🎟️',tickets10:'🧳',tickets15:'🚂',
        friend10:'💝',miss3:'😴',
        freeze1:'❄️',thaw1:'🧊',
        exchange30:'🏅',exchange60:'🎁',exchange90:'🗝️'
      };
      // 4×4 illustrated icon atlas, matching the approved BOK mock-up.
      const achArtIndex={
        streak5:0,streak10:1,streak15:2,visits10:3,visits20:4,visits30:5,
        tickets5:6,tickets10:7,tickets15:8,friend10:9,miss3:10,
        freeze1:11,thaw1:12,exchange30:13,exchange60:14,exchange90:15
      };
      const achCard=a=>{
        const earned=!!a.earned,target=Math.max(1,Number(a.target)||1);
        const hasProgress=a.progress!==null&&a.progress!==undefined&&
          a.progress!==''&&Number.isFinite(Number(a.progress));
        const progress=earned?target:hasProgress?Math.min(target,Math.max(0,Number(a.progress))):null;
        const pct=progress===null?0:Math.min(100,Math.round(progress/target*100));
        const progressLabel=progress===null?'Прогресс не рассчитан':
          (Math.round(progress*100)/100)+'/'+target+' · '+pct+'%';
        const tone=earned?' bok-ach-earned':' bok-ach-locked';
        const icon=achIconMap[String(a.id)]||String(a.emoji||'🏆');
        const artIndex=achArtIndex[String(a.id)];
        const artPosition=artIndex===undefined?null:{
          backgroundPositionX:((artIndex%4)*100/3)+'%',
          backgroundPositionY:(Math.floor(artIndex/4)*100/3)+'%'
        };
        return h('article',{class:'bok-ach-card'+tone,title:String(a.title||'Достижение')},
          h('div',{class:'bok-ach-illustration','aria-hidden':'true'},
            h('span',{class:'bok-ach-art'},icon),
            artPosition?h('span',{class:'bok-ach-sprite-art',style:artPosition}):null),
          h('div',{class:'bok-ach-copy'},
            h('div',{class:'bok-ach-title'},String(a.title||'Достижение')),
            h('div',{class:'bok-ach-description'},String(a.description||'')+
              (Number(a.target)>0?' · '+a.target:'')),
            h('div',{class:'bok-ach-progress-label'},progressLabel),
            h('div',{class:'bok-ach-track',role:'progressbar',
              'aria-label':'Прогресс: '+String(a.title||''),
              'aria-valuemin':'0','aria-valuemax':String(target),
              'aria-valuenow':String(progress===null?0:progress)},
              h('span',{class:'bok-ach-progress-fill',style:{width:pct+'%'}}))),
          h('span',{class:'bok-ach-status','aria-label':earned?'Получено':'Ещё не получено'},
            earned?'✓':'🔒'));
      };
      const showAchievementData=data=>{
        if(!data||!data.ok||!Array.isArray(data.achievements))
          throw Error('Некорректный ответ достижений');
        const achievements=data.achievements;
        const earned=achievements.filter(x=>x.earned).length;
        achCount.textContent=earned+' из '+achievements.length;
        const grid=h('div',{class:'bok-ach-grid'},...achievements.map(achCard));
        fill(achBody,grid);
      };
      // The rich endpoint is additive, and old achievements remain available
      // during installation of its backend routing.
      api.post('achRich',{url:p.url}).then(data=>{
        if(data&&data.ok&&Array.isArray(data.achievements))return data;
        return api.post('achPublic',{url:p.url});
      }).then(showAchievementData).catch(()=>{
        api.post('achPublic',{url:p.url}).then(showAchievementData).catch(()=>{
          fill(achBody,h('p',{class:'hint'},'Достижения временно недоступны.'));
          achCount.textContent='—';
        });
      });

      // Presentation only; actual result always comes from GAS achSpin.
      const bokPrizeIcon=p=>{
        const title=String(p&&p.title||'').trim();
        // Friendly visual name; the GAS prize retains its original ID/title
        // "Ничего" for durable accounting and the three-in-a-row rule.
        if(/^ничего[!.\\s]*$/i.test(title))return '🍀';
        const emoji=String(p&&p.emoji||p&&p.icon||'').trim();
        if(emoji)return emoji.slice(0,12);
        const t=String(p&&p.title||'').toLowerCase();
        if(/ничего|пусто|без приза/.test(t))return '🍀';
        if(/достав|отправ/.test(t))return '🚚';
        if(/кист|рук|ладон/.test(t))return '🖐️';
        if(/стоп|обув|туфл/.test(t))return '🦶';
        if(/скид|сертификат/.test(t))return '💝';
        if(/номер|билет|эфир/.test(t))return '🎟️';
        if(/кукл|тел|bjd/.test(t))return '🧸';
        return '🎁';
      };
      // BOK 6.7.21. Premium animated wheel: every sector still comes from
      // the actual GAS catalogue, so the stop angle always matches the prize.
      const bokWheelArt=data=>{
        const catalog=Array.isArray(data.prizes)?data.prizes:null;
        const sectors=catalog?catalog.filter(p=>p&&p.active!==false&&Number(p.weight)>0&&
          (p.stock==null||Number(p.stock)>0)):[];
        const stage=h('div',{class:'bok-wheel-stage bok-wheel-luxe',role:'group',
          'aria-label':'Барабан удачи BOK Body'});
        const halo=h('div',{class:'bok-wheel-halo','aria-hidden':'true'});
        const disc=h('div',{class:'bok-wheel-disc bok-wheel-luxe-disc',role:'img',
          'aria-label':'Призовые сектора: '+sectors.map(p=>String(p.title||'')).join(', ')});
        const ns='http://www.w3.org/2000/svg';
        const svg=(tag,attrs,txt)=>{
          const el=document.createElementNS(ns,tag);
          for(const [k,v] of Object.entries(attrs||{}))el.setAttribute(k,String(v));
          if(txt!==undefined)el.textContent=String(txt);
          return el;
        };
        const graphic=svg('svg',{viewBox:'0 0 300 300',width:'100%',height:'100%',
          preserveAspectRatio:'xMidYMid meet','aria-hidden':'true'});
        const defs=svg('defs');
        const gradient=(id,stops,radial)=>{
          const g=svg(radial?'radialGradient':'linearGradient',
            radial?{id,cx:'40%',cy:'28%',r:'80%'}:{id,x1:'0%',y1:'0%',x2:'70%',y2:'100%'});
          stops.forEach(([offset,color])=>g.appendChild(svg('stop',{offset,'stop-color':color})));
          defs.appendChild(g);
        };
        gradient('bok-metal',[['0%','#fff9d7'],['18%','#d99a51'],['42%','#ffe6a2'],
          ['65%','#a66634'],['86%','#f2bf72'],['100%','#8f4b2d']]);
        gradient('bok-rose',[['0%','#fff1ec'],['53%','#f5bfd0'],['100%','#d989aa']]);
        gradient('bok-peach',[['0%','#fff7de'],['53%','#ffd9c4'],['100%','#f2a4a9']]);
        gradient('bok-lilac',[['0%','#fdf0ff'],['55%','#e8c5ec'],['100%','#cc9dd8']]);
        gradient('bok-ivory',[['0%','#fffaf1'],['65%','#ffeada'],['100%','#f9b9bb']]);
        gradient('bok-center',[['0%','#fffefa'],['35%','#ffe1ca'],['100%','#e5a47b']],true);
        gradient('bok-bulb',[['0%','#ffffff'],['35%','#fff0b1'],['100%','#ffbd4a']],true);
        graphic.appendChild(defs);
        // Three golden metal rings, illustrated lights and real prize sectors.
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:148,fill:'url(#bok-metal)',
          stroke:'#fff4ce','stroke-width':2}));
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:141,fill:'#b77949',
          stroke:'#fff6d2','stroke-width':1.4}));
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:128,fill:'#f6d2c6'}));
        if(sectors.length){
          const n=sectors.length,R=127,iconR=n>13?103:n>9?100:101;
          const palette=['bok-rose','bok-peach','bok-lilac','bok-ivory'];
          sectors.forEach((p,i)=>{
            const t0=-Math.PI/2+i*2*Math.PI/n,t1=-Math.PI/2+(i+1)*2*Math.PI/n;
            const point=t=>[150+R*Math.cos(t),150+R*Math.sin(t)];
            const a=point(t0),b=point(t1);
            const shape=n===1
              ?'M150 23 A127 127 0 1 1 149.99 23 Z'
              :'M150 150 L'+a[0].toFixed(3)+' '+a[1].toFixed(3)+
                ' A127 127 0 '+(2*Math.PI/n>Math.PI?1:0)+' 1 '+
                b[0].toFixed(3)+' '+b[1].toFixed(3)+' Z';
            const group=svg('g');
            group.appendChild(svg('path',{d:shape,
              fill:'url(#'+palette[i%palette.length]+')',
              stroke:'#da9d6c','stroke-width':1.4,'stroke-linejoin':'round'}));
            group.appendChild(svg('title',{},String(p.title||'Приз')));
            const t=(t0+t1)/2,x=150+iconR*Math.cos(t),y=150+iconR*Math.sin(t);
            const secret=/секрет|сюрприз|тайн|\\?/.test(String(p.title||'').toLowerCase())||
              /^[?❔❓]$/.test(String(p.emoji||'').trim());
            if(secret){
              group.appendChild(svg('circle',{cx:x,cy:y,r:n>11?13:17,
                fill:'url(#bok-center)',stroke:'#bd804a','stroke-width':2}));
              group.appendChild(svg('text',{x,y:y+1,'font-size':n>11?17:25,
                'text-anchor':'middle','dominant-baseline':'central','font-weight':900,
                fill:'#a45247','font-family':'Georgia,serif'},'?'));
              // Two reserve illustrations; no extra prize sectors are invented.
              const imgSize=n>11?29:37;
              group.appendChild(svg('image',{href:'assets/bok-wheel-secret-'+
                (i%2?'gold':'rose')+'.svg',x:(x-imgSize/2).toFixed(2),
                y:(y-imgSize/2).toFixed(2),width:imgSize,height:imgSize}));
            }else{
              group.appendChild(svg('text',{x,y:y+2,'font-size':n>14?17:n>10?22:n>7?30:35,
                'text-anchor':'middle','dominant-baseline':'central',
                'font-family':'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif'},
                bokPrizeIcon(p)));
            }
            graphic.appendChild(group);
          });
        }else{
          graphic.appendChild(svg('circle',{cx:150,cy:150,r:124,fill:'url(#bok-ivory)'}));
          graphic.appendChild(svg('text',{x:150,y:120,'font-size':42,'text-anchor':'middle'},'🎁'));
          graphic.appendChild(svg('text',{x:150,y:148,'font-size':12,'text-anchor':'middle',fill:'#8e6649'},
            catalog?'Нет доступных призов':'Загружаем призы'));
        }
        // The same 300px SVG spins as the sectors: no stale decorative sectors
        // and no mismatch between a drawn prize and server-side selection.
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:128,fill:'none',
          stroke:'#fff9e0','stroke-width':2.4}));
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:135,fill:'none',
          stroke:'#9a5d33','stroke-width':3.8}));
        for(let i=0;i<32;i++){
          const angle=i*2*Math.PI/32-Math.PI/2;
          const x=150+139*Math.cos(angle),y=150+139*Math.sin(angle);
          graphic.appendChild(svg('circle',{cx:x.toFixed(2),cy:y.toFixed(2),
            r:i%4===0?4.4:2.3,fill:i%4===0?'url(#bok-bulb)':'#ffedbd',
            stroke:'#c78d4f','stroke-width':i%4===0?.7:.35,
            class:i%4===0?'bok-wheel-bulb':'bok-wheel-rivet',
            style:'--lamp-phase:'+((i%8)*.13)+'s'}));
        }
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:37,fill:'url(#bok-metal)',
          stroke:'#fff5d7','stroke-width':2.1}));
        graphic.appendChild(svg('circle',{cx:150,cy:150,r:31,fill:'url(#bok-center)',
          stroke:'#bb8450','stroke-width':1.6}));
        graphic.appendChild(svg('text',{x:150,y:145,'font-size':21,fill:'#a16b3d',
          'font-family':'Georgia,serif','text-anchor':'middle'},'BOK'));
        graphic.appendChild(svg('text',{x:150,y:161,'font-size':16,fill:'#a16b3d',
          'font-family':'Georgia,serif','text-anchor':'middle'},'Body'));
        graphic.appendChild(svg('text',{x:150,y:176,'font-size':11,
          'text-anchor':'middle'},'🎀'));
        disc.appendChild(graphic);
        stage.appendChild(halo);
        stage.appendChild(disc);
        const pointer=h('span',{class:'bok-wheel-jewel-pointer','aria-hidden':'true'},'◆');
        stage.appendChild(pointer);
        if(!catalog)return h('div',null,stage,
          h('p',{class:'hint',style:{textAlign:'center'}},
            'Каталог призов недоступен. Обновите сервер и кабинет.'));
        return stage;
      };
      // Smooth animation with an accurate final sector. GAS is always the sole
      // authority for selecting a prize. The client ONLY visualizes its response.
      function bokStartWheelAnimation(wheel,catalog){
        if(!wheel)return {choose:()=>{},done:Promise.resolve(),matched:()=>false};
        wheel.style.transition='none';
        wheel.classList.add('is-spinning');
        const eligible=Array.isArray(catalog)?catalog.filter(p=>p&&p.active!==false&&
          Number(p.weight)>0&&(p.stock==null||Number(p.stock)>0)):[];
        const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const accelerationMs=reduced?120:1850,minCruiseMs=reduced?400:3200,
          velocity=reduced?800:400,brakeMs=reduced?450:5300;
        let begin=0,decided=false,selected=null,settle=null,matched=false,resolveDone;
        const done=new Promise(resolve=>{resolveDone=resolve;});
        const positiveDegrees=n=>((n%360)+360)%360;
        function tick(now){
          if(!begin)begin=now;
          const elapsed=now-begin;
          // Integrated ease-in acceleration, followed by a constant-speed cruise.
          // Both phases have the same velocity at the join.
          const accel=Math.min(accelerationMs,elapsed);
          const accelAngle=velocity*(2*accelerationMs/Math.PI/1000)*
            (1-Math.cos(Math.PI*accel/(2*accelerationMs)));
          const cruiseAngle=velocity*Math.max(0,elapsed-accelerationMs)/1000;
          let angle=accelAngle+cruiseAngle;
          if(decided&&elapsed>=minCruiseMs&&!settle){
            // Identical slice geometry to bokWheelArt. Slice zero begins at 12 o'clock.
            // Pointer also sits at 12 o'clock, so center of slice i must rotate
            // by -(i+.5)*360/n degrees modulo 360.
            const index=eligible.findIndex(p=>String(p.id)===String(selected&&selected.id));
            matched=index>=0;
            const indexByTitle=index<0&&selected?
              eligible.findIndex(p=>String(p.title)===String(selected.title)):-1;
            const selectedIndex=index>=0?index:indexByTitle;
            matched=selectedIndex>=0;
            const desired=matched?-(selectedIndex+.5)*360/eligible.length:0;
            const correction=positiveDegrees(desired-positiveDegrees(angle));
            settle={time:now,from:angle,to:angle+(reduced?360:1800)+correction};
          }
          if(settle){
            const fraction=Math.min(1,(now-settle.time)/brakeMs);
            const t=fraction,t2=t*t,t3=t2*t;
            const distance=settle.to-settle.from;
            const tangential=velocity*brakeMs/1000;
            // Cubic Hermite with an initial velocity matching cruise and
            // a zero final velocity: no sudden jerk or last-second snap.
            angle=(2*t3-3*t2+1)*settle.from+
              (t3-2*t2+t)*tangential+
              (-2*t3+3*t2)*settle.to;
            wheel.style.transform='rotate('+angle.toFixed(3)+'deg)';
            if(fraction>=1){wheel.classList.remove('is-spinning');resolveDone();return;}
          }else{
            wheel.style.transform='rotate('+angle.toFixed(3)+'deg)';
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        return {choose:prize=>{selected=prize;decided=true;},done,matched:()=>matched};
      }

      function bokPrizeReveal(prize,onClose,outcome){
        const isNothing=/^ничего[!.\\s]*$/i.test(String(prize&&prize.title||'').trim());
        const isBonus=!!(isNothing&&outcome&&outcome.nothingMilestone);
        const progress=outcome&&Number.isFinite(Number(outcome.nothingProgress))?
          Number(outcome.nothingProgress):null;
        const extra=outcome&&Number(outcome.bonusSpinsApplied)>0?
          Number(outcome.bonusSpinsApplied):0;
        const prior=document.querySelector('.bok-prize-reveal');if(prior)prior.remove();
        const overlay=h('div',{class:'bok-prize-reveal',role:'dialog','aria-modal':'true','aria-label':'Ваш приз'});
        const closeButton=h('button',{type:'button',class:'btn btn-primary btn-block'},'🎉 Отлично!');
        const sparks=h('div',{class:'bok-prize-sparks','aria-hidden':'true'},...Array.from({length:12},(_,i)=>
          h('span',{style:{'--i':i}},i%3===0?'✧':'✦')));
        overlay.appendChild(h('div',{class:'bok-prize-card'},sparks,
          h('div',{class:'bok-prize-kicker'},'✨ БАРАБАН BOK BODY ✨'),
          h('div',{class:'bok-prize-icon','aria-hidden':'true'},bokPrizeIcon(prize)),
          h('h3',null,isBonus?'✨ Бонусное вращение!':isNothing?'Ещё один шаг к бонусу':'Вам выпал приз!'),
          h('div',{class:'bok-prize-name'},isBonus?
            '3 раза «Ничего» = +1 вращение':isNothing?
              '🍀 Шаг к удаче':String(prize&&prize.title||'Сюрприз')),
          h('p',{class:'bok-prize-note'},isBonus?
            'Все три «Ничего» отмечены выданными · вращение начислено автоматически':
            isNothing&&progress!==null?
              '«Ничего»: '+progress+'/3 · каждые 3 дают дополнительное вращение':
              'Выигрыш сохранён · ожидает выдачи'),
          extra>0&&!isBonus?h('p',{class:'bok-wheel-bonus-note'},
            '🎀 Дополнительно начислено вращений: '+extra):null,
          closeButton));
        const onKey=e=>{if(e.key==='Escape')close();};
        let closed=false;
        const close=()=>{
          if(closed)return;
          closed=true;document.removeEventListener('keydown',onKey);overlay.remove();
          if(typeof onClose==='function')onClose();
        };
        closeButton.addEventListener('click',close);
        overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
        document.body.appendChild(overlay);
        document.addEventListener('keydown',onKey);
        closeButton.focus();
      }
      const wheelBox=h('section',{class:'cab-wheel bok-cab-panel bok-cab-wheel'});
      if(authenticated){
        const loadWheel=()=>api.post('achPrivate',{vkAccessToken:window.BokVK.token()}).then(data=>{
          if(!data||!data.ok){fill(wheelBox,h('p',{class:'hint'},'Барабан станет доступен после обновления сервера.'));return;}
          const catalogReady=Array.isArray(data.prizes)&&data.prizes.some(p=>p&&p.active!==false&&Number(p.weight)>0&&(p.stock==null||Number(p.stock)>0));
          const button=h('button',{class:'btn btn-primary btn-block',disabled:Number(data.spins)<1||(Array.isArray(data.prizes)&&!catalogReady),onclick:async()=>{
            button.disabled=true;button.textContent='🎡 Барабан вращается…';
            const wheel=wheelBox.querySelector('.bok-wheel-disc');
            const animation=bokStartWheelAnimation(wheel,data.prizes);
            const pendingKey='bok-wheel-pending-v1';
            let requestId=localStorage.getItem(pendingKey);
            if(!requestId){requestId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2));localStorage.setItem(pendingKey,requestId);}
            let outcome;
            try{outcome=await api.post('achSpin',{vkAccessToken:window.BokVK.token(),requestId});}
            catch(e){outcome={ok:false,error:{message:'Связь прервалась. Повторите попытку: выигрыш не потеряется.'}};}
            if(outcome&&outcome.ok)localStorage.removeItem(pendingKey);
            animation.choose(outcome&&outcome.ok?outcome.prize:null);
            await animation.done;
            if(outcome&&outcome.ok){
              const real=(Array.isArray(data.prizes)?data.prizes:[]).find(p=>
                String(p.id)===String(outcome.prize&&outcome.prize.id));
              const shown=Object.assign({},real||{},outcome.prize||{});
              // Keep the final, correct sector visible behind the result popup.
              // Refresh the cabinet only when the participant dismisses it.
              bokPrizeReveal(shown,()=>loadWheel(),outcome);
              if(!animation.matched())toast('Приз получен. Каталог колеса изменился — обновите кабинет.',null,5000);
            }else{
              toast((outcome&&outcome.error&&outcome.error.message)||'Не удалось выполнить вращение','bad');
              loadWheel();
            }
          }},'🎡 Крутить барабан');
          const counter=h('div',{class:'bok-wheel-spins-counter'},
            h('span',{class:'bok-wheel-spins-icon','aria-hidden':'true'},'🎟️'),
            h('span',null,'Доступно вращений: '),
            h('b',null,String(data.spins)));
          const nothingProgress=Number(data.nothingProgress);
          const nothingHint=Number.isInteger(nothingProgress)&&nothingProgress>=0&&nothingProgress<3?
            h('p',{class:'bok-wheel-nothing-progress'},'🍀 Три «Ничего» = одно бонусное вращение · ',
              h('b',null,nothingProgress+'/3')):null;
          const catalogue=h('details',{class:'bok-wheel-catalog'},
            h('summary',null,'🎁 Посмотреть призы барабана'),
            h('div',{class:'bok-wheel-catalog-grid'},...(data.prizes||[]).map((p,i)=>
              h('div',{class:'bok-wheel-catalog-item'},
                h('span',{class:'bok-wheel-catalog-icon'},bokPrizeIcon(p)),
                h('span',null,/^ничего[!.\\s]*$/i.test(String(p.title||'').trim())?
                  'Шаг к удаче · 3 = вращение':String(p.title||'Секретный приз'))))));
          fill(wheelBox,
            h('h4',{class:'bok-wheel-title'},'👑 Барабан удачи BOK Body'),
            h('p',{class:'bok-wheel-subtitle'},'Розовое золото, счастливые сюрпризы и настоящие призы'),
            bokWheelArt(data),counter,nothingHint,button,catalogue,
            h('h4',{class:'bok-wheel-history-heading'},'📦 Мои выигрыши'),
            ...((data.wins||[]).length?(data.wins||[]).slice().reverse().map(w=>{
              const prize=(data.prizes||[]).find(p=>String(p.title)===String(w.title));
              return h('div',{class:'gift-item'},
                h('span',{class:'bok-wheel-history-icon'},prize?String(prize.emoji||'🎁'):bokPrizeIcon(w)),
                h('span',{class:'bok-wheel-history-title'},w.title),
                h('span',{class:'bok-wheel-history-status'},w.status));
            }):[h('p',{class:'hint'},'Подарков пока нет')]));
        }).catch(()=>fill(wheelBox,h('p',{class:'hint'},'Барабан временно недоступен.')));
        loadWheel();
      }
      const depositBalance=verified&&privateDeposit?Number(privateDeposit.balance):0;
      const depositHistory=verified&&privateDeposit&&Array.isArray(privateDeposit.history)
        ?privateDeposit.history:[];
      const depositHasBalance=Number.isFinite(depositBalance)&&depositBalance!==0;
      const depositUI=authenticated&&verified&&(depositHasBalance||depositHistory.length>0)?
        h('section',{class:'cab-deposit bok-cab-panel'},
          h('h4',null,'💳 Тестовый баланс для бронирования'),
          depositHasBalance?h('div',null,
            h('p',{class:'lead'},'Доступно: '+depositBalance+' ₽'),
            h('p',{class:'hint'},'Назначение номерков выполняет администратор.')):null,
          depositHistory.length?h('details',{class:'bok-deposit-history'},
            h('summary',null,'📜 История движения средств ('+depositHistory.length+')'),
            ...depositHistory.map(op=>h('div',{class:'gift-item'},
              h('b',null,(Number(op.amount)>0?'+':'')+op.amount+' ₽ · '+op.type),
              h('div',{class:'meta'},String(op.date||'').slice(0,10)+' · Эфир №'+
                (op.event||'—')+' · '+(op.numbers||'')+' · '+(op.note||''))))):null):null;
      const cabStat=(symbol,label,value,tone='')=>h('div',{class:'bok-cab-stat'+(tone?' bok-cab-stat--'+tone:'')},
        h('span',{class:'bok-cab-stat-icon','aria-hidden':'true'},symbol),
        h('span',{class:'bok-cab-stat-copy'},
          h('span',{class:'bok-cab-stat-label'},label),
          h('b',{class:'bok-cab-stat-value'},String(value))));
      const stats=h('div',{class:'cab-stats'},
        cabStat('🎟️','Баланс',privatePlayer&&privatePlayer.bal!=null?privatePlayer.bal:(p.bal==null?'Скрыт':p.bal),'balance'),
        cabStat('❌','Пропуски',p.miss,'misses'),
        cabStat('🏆','Победы',p.wins||0,'wins'),
        cabStat(p.frozen?'❄️':'🌷','Статус',p.frozen?'Заморожен':'Активен',p.frozen?'frozen':'active'));
      const gifts=h('section',{class:'bok-cab-panel bok-cab-gifts'},
        h('h4',null,'🎁 Подарки эфиров'),
        h('div',{class:'gift-list'},(p.gifts||[]).length?(p.gifts||[]).map(g=>
          h('div',{class:'gift-item'},
            h('b',null,g.title),
            h('span',{class:'bok-cab-gift-status'},g.received?'✅ Получен '+(g.receivedAt||''):'📦 Ожидает выдачи')))
          :h('p',{class:'hint'},'Подарков пока нет')));
      fill(box,
        h('button',{class:'btn btn-ghost btn-sm bok-cab-change',onclick:()=>showSearch(true)},'← Сменить участника'),
        h('div',{class:'cab-profile'},
          h('div',{class:'bok-cab-avatar'},avatar(p.name,p.photo,112)),
          h('div',{class:'bok-cab-profile-copy'},
            h('h3',{class:p.frozen?'frozen-name':''},p.name),
            h('p',{class:'meta bok-cab-auth-meta'},authenticated?
              (identity.restored?'VK ID · вход сохранён на устройстве':'VK ID · вход выполнен'):
              'Публичная карточка · без авторизации'))),
        stats,
        p.frozen?h('p',{class:'msg bok-cab-freeze-note'},left===null?
          '❄ Бессрочная заморозка по старым правилам':
          '❄ До бесплатной разморозки осталось '+left+' дн.'):null,
        authenticated?freezeUI:null,exchangeUI,depositUI,achBox,authenticated?wheelBox:null,gifts,
        h('p',{class:'hint bok-cab-footer-note'},authenticated?
          'Действия с балансом подтверждены VK ID.':
          'Публичная карточка. Накопления и статус доступны для просмотра, но тестовый депозит, обмен и управление заморозкой требуют VK ID.'));
    };
    let searchSeq=0;
    const vkSlug=value=>{
      let x=String(value||'').trim().toLowerCase().split('\\').join('/').replace(/^@/,'');
      if(x.startsWith('https://'))x=x.slice(8);
      if(x.startsWith('http://'))x=x.slice(7);
      if(x.startsWith('www.'))x=x.slice(4);
      if(x.startsWith('m.vk.com/'))x=x.slice(2);
      if(x.startsWith('vk.com/')||x.startsWith('vk.ru/'))x=x.slice(x.indexOf('/')+1);
      return x.split('?')[0].split('/')[0];
    };
    const draw=()=>{
      const seq=++searchSeq,raw=q.value.trim(),t=vkSlug(raw);
      const arr=t.length>=2?window.BokPlayerSearch.filter(players,raw,20):[];
      fill(matches,arr.length?arr.map(p=>h('button',{class:'btn btn-soft btn-block',style:{marginTop:'6px'},onclick:()=>select(p)},p.name+' · 🎟 '+(p.bal==null?'—':p.bal))):h('p',{class:'hint'},t.length>=2?'Проверяем профиль…':'Начните вводить имя или ссылку ВК.'));
      if(arr.length||t.length<2)return;
      const looksVk=raw.includes('vk.')||raw.startsWith('@')||t.startsWith('id')||(/^[a-z0-9_.]{2,64}$/.test(t)&&!raw.includes(' '));
      if(!looksVk){fill(matches,h('p',{class:'hint'},'Участник не найден.'));return;}
      api.post('resolveCabinetVk',{vkUrl:raw}).then(r=>{
        if(seq!==searchSeq)return;
        if(!r||!r.ok){const msg=r&&r.error&&(r.error.message||r.error)||'';fill(matches,h('p',{class:'hint'},String(msg).includes('Неизвестное действие')?'Сервер не поддерживает поиск VK ID. Обновите развёртывание Apps Script.':msg||'Не удалось определить профиль ВК.'));return;}
        const id='id'+r.vkId,found=players.filter(p=>vkSlug(p.url||'')===id||(r.linkedUrl&&vkSlug(p.url||'')===vkSlug(r.linkedUrl)));
        fill(matches,found.length?found.map(p=>h('button',{class:'btn btn-soft btn-block',style:{marginTop:'6px'},onclick:()=>select(p)},p.name+' · 🎟 '+(p.bal==null?'—':p.bal))):h('div',{class:'msg'},
          h('b',null,'✅ Профиль ВК найден: '+(r.name||id)),
          h('p',{class:'hint'},'Участник ещё не бронировал номерки. Карточка с нулевым балансом создастся автоматически при первой успешной брони. Вход в чужой личный кабинет не требуется.'),
          h('button',{class:'btn btn-soft btn-block',onclick:()=>{closeModal();document.querySelector('.ticket.free,.ticket,.tnum')?.scrollIntoView({behavior:'smooth',block:'center'});}},'Выбрать номерки для бронирования')));
      }).catch(()=>{if(seq===searchSeq)fill(matches,h('p',{class:'hint'},'Ошибка проверки ВК'));});
    };
    const showSearch=(reset=false)=>{if(reset)q.value='';fill(box,h('p',{class:'lead'},'Публичные сведения. Вы можете просматривать карточки других участников.'),q,matches);draw();q.focus();};
    q.addEventListener('input',draw);
    const known=players.find(p=>verifiedSession&&verifiedSession.ok&&verifiedSession.player&&verifiedSession.player.url===p.url)||players.find(p=>{
      const url=String(p.url||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/^vk\.(?:com|ru)\//,'').replace(/\/$/,'');
      return identity&&url==='id'+identity.id;
    });
    const targetPlayer=target?players.find(p=>p.url===target||p.name===target):null;
    if(targetPlayer)select(targetPlayer);
    else if(known)select(known);
    else showSearch(false);

    if(identity)box.appendChild(h('button',{class:'btn btn-ghost btn-sm',style:{marginTop:'14px'},onclick:()=>{window.BokVK.logout();closeModal();openCabinet();}},'Выйти из VK ID'));
  }

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
      out.push(h('button', { class: 'prow participant-row', type: 'button', onclick: () => openCabinet(p.url || p.name), title: 'Открыть кабинет участника' },
        avatar(p.name, p.photo),
        h('div', { class: 'pname' }, h('b', null, p.name),
          h('div', { class: 'chips' }, p.items.map((it) => h('span', { class: 'chip' + (it[1] ? '' : ' pend') }, '№' + it[0])), marks(p)))));
    });
    fill(plistEl, ...out);
  }

  function renderAll() {
    renderHero(); renderBanner(); renderSteps(); renderMine(); renderGrid(); renderOverlay(); renderAction(); renderPlayers();
  }

  function tickTimers() {
    document.querySelectorAll('[data-act]').forEach(tickTimer);
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
      if (mine && mine.ok) { S.mine = mine.bookings; S.quiet = mine.quiet || null; }
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
    let seq = 0, chosen = null;

    // Выбор из списка игроков (кто уже участвовал): поиск по имени
    const pickEl = h('div', null);
    const pickBtn = h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: togglePicker }, '👥 Я уже участвовал(а) — выбрать из списка');
    async function togglePicker() {
      if (pickEl.children.length) { fill(pickEl); return; }
      fill(pickEl, h('div', { class: 'hint' }, 'Загружаем список…'));
      const r = await api.players();
      if (!r.ok) { fill(pickEl, h('div', { class: 'msg err' }, (r.error && r.error.message) || 'Не удалось загрузить список')); return; }
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Начните вводить имя', autocomplete: 'off' });
      const box = h('div', { class: 'blist', style: { maxHeight: '30vh' } });
      const draw = () => {
        const t = norm(q.value.trim());
        const rows = window.BokPlayerSearch.filter(r.players,q.value,60);
        fill(box, rows.length ? rows.map((x) => h('div', { class: 'prow', style: { cursor: 'pointer' }, onclick: () => choose(x) },
          avatar(x.name, x.photo, 32), h('div', { class: 'pname' }, h('b', null, x.name))))
          : h('div', { class: 'empty' }, r.players.length ? 'Никого не нашли — вставьте ссылку на профиль' : 'Список пока пуст — вставьте ссылку на профиль'));
      };
      q.addEventListener('input', draw);
      draw();
      fill(pickEl, q, box, h('div', { class: 'hint' }, 'Не нашли себя? Закройте список и вставьте ссылку на профиль ВК.'));
      q.focus();
    }
    function choose(x) {
      chosen = x; seq++;
      vkInput.value = '';
      errBox.textContent = '';
      nameField.classList.add('hidden');
      fill(pickEl);
      preview.className = 'msg';
      fill(preview, h('div', { class: 'profile-card' }, avatar(x.name, x.photo, 44),
        h('div', null, h('b', null, x.name), h('div', { class: 'meta' }, 'Выбрано из списка. Это не вы? Выберите другого или вставьте ссылку.'))));
    }

    async function resolve() {
      chosen = null;
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
    const suggestions=h('div',{class:'live-suggestions'});let directory=[];
    api.players().then(r=>{if(r.ok)directory=r.players||[];});
    const suggest=()=>{const t=norm(vkInput.value.trim());if(t.length<2){fill(suggestions);return;}
      const rows=window.BokPlayerSearch.filter(directory,vkInput.value,8);
      fill(suggestions,rows.map(p=>h('button',{type:'button',class:'btn btn-soft btn-block',onclick:()=>{choose(p);fill(suggestions);}},avatar(p.name,p.photo,28),' ',p.name)));
    };
    vkInput.addEventListener('input',suggest);
    vkInput.addEventListener('change', resolve);
    vkInput.addEventListener('input', () => { chosen = null; });

    submit.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!chosen && !vkInput.value.trim()) { errBox.textContent = 'Вставьте ссылку на ваш профиль ВКонтакте или выберите себя из списка'; vkInput.focus(); return; }
      submit.disabled = true; submit.textContent = 'Бронируем…';
      const r = await api.post('book', { clientId: CLIENT, vkUrl: chosen ? '' : vkInput.value.trim(), playerKey: chosen ? chosen.id : '', name: nameInput.value.trim(), numbers: nums });
      submit.disabled = false; submit.textContent = 'Забронировать ' + list(nums);
      if (r.ok) {
        if (!chosen) store('nomerok_vk', vkInput.value.trim());
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
        h('label', null, 'Ссылка на ваш профиль ВКонтакте'), vkInput, suggestions, h('div', { style: { margin: '8px 0' } }, pickBtn), pickEl,
        h('div', { class: 'hint' }, 'Нужна, чтобы мы вас узнали. В списке участников будут видны имя и фото из вашего профиля.'), preview),
      nameField, errBox, submit
    ]);
    if (vkInput.value) resolve(); else vkInput.focus();
  }

  function showSuccess(r) {
    const b = r.booking;
    const deadline = h('p', { style: { textAlign: 'center', margin: '0 0 12px' } }, timerNodes(b, r.quiet || S.quiet || S.st.quiet, off()));
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
