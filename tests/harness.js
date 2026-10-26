/**
 * Имитация сервисов Google Apps Script, чтобы прогонять Code.gs и TimeLogic.gs в Node.
 * Запуск тестов:  node --test tests/
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'apps-script');

function chain() {
  const fn = function () {};
  return new Proxy(fn, {
    get: (t, p) => (p === 'then' ? undefined : chain()),
    apply: () => chain()
  });
}

function withNoop(obj) {
  return new Proxy(obj, { get: (t, p) => (p in t ? t[p] : (p === 'then' ? undefined : () => chain())) });
}

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i] && this.rows[i].some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return chain();
    return withNoop(new Range(this, a, b, c || 1, d || 1));
  }
  appendRow(arr) { this.rows[this.getLastRow()] = arr.slice(); }
  deleteRows(start, n) { this.rows.splice(start - 1, n); }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((row, i) => {
      const idx = this.r - 1 + i;
      this.sh.rows[idx] = this.sh.rows[idx] || [];
      row.forEach((v, j) => { this.sh.rows[idx][this.c - 1 + j] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  getValue() { return this.getValues()[0][0]; }
}

function createEnv(opts = {}) {
  const clock = { now: Date.UTC(2026, 8, 2, 11, 0, 0) }; // 2 сентября 2026, 14:00 МСК
  const sheets = {};
  const props = new Map(Object.entries({ ADMIN_PASSWORD: 'correct-horse-battery', ...(opts.props || {}) }));
  const cache = new Map();
  const mails = [];
  const fetches = [];
  const env = { clock, sheets, props, mails, fetches, vkHandler: () => ({ response: [] }) };

  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }

  const ss = {
    getId: () => 'SS1',
    getSheetByName: (n) => (sheets[n] ? withNoop(sheets[n]) : null),
    insertSheet: (n) => { sheets[n] = new Sheet(n); return withNoop(sheets[n]); },
    getSpreadsheetTimeZone: () => 'Europe/Moscow'
  };

  const sandbox = {
    console, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent,
    Date: FakeDate,
    Logger: { log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      newDataValidation: () => chain(),
      newConditionalFormatRule: () => chain(),
      getUi: () => ({ createMenu: () => chain(), alert() {} })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); return e && e.exp > clock.now ? e.v : null; },
        put: (k, v, ttl) => cache.set(k, { v, exp: clock.now + (ttl || 600) * 1000 }),
        remove: (k) => cache.delete(k)
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: {
      fetch: (url) => {
        fetches.push(url);
        const body = env.vkHandler(url);
        return { getContentText: () => JSON.stringify(body) };
      }
    },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => chain(), deleteTrigger() {} },
    Utilities: { sleep() {} }
  };

  const ctx = vm.createContext(sandbox);
  for (const f of ['TimeLogic.gs', 'Code.gs']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  env.ctx = ctx;
  env.run = (code) => vm.runInContext(code, ctx);

  env.post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  env.get = (params = {}) => JSON.parse(ctx.doGet({ parameter: params }).text);
  env.admin = (action, extra = {}) => env.post({ action, password: 'correct-horse-battery', ...extra });
  env.msk = (day, h, m = 0) => Date.UTC(2026, 8, day, h - 3, m);
  env.setClock = (ms) => { clock.now = ms; };
  env.advance = (ms) => { clock.now += ms; };

  /** Меняет значение настройки прямо в листе (как будто админ правит таблицу с телефона). */
  env.editSettingInSheet = (label, value) => {
    const rows = sheets['Настройки'].rows;
    const row = rows.find((r) => r && r[0] === label);
    if (!row) throw new Error('нет настройки ' + label);
    row[1] = value;
  };

  ctx.init();
  return env;
}

module.exports = { createEnv };
