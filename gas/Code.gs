/**
 * 早菜島軌道 — 特急予約・運行管理 バックエンド (Google Apps Script)
 *
 * 1. 新しい Google スプレッドシートを作り、[拡張機能] → [Apps Script] を開く
 * 2. このファイルの内容を Code.gs に貼り付けて保存
 * 3. 関数「setup」を選んで実行(初回は権限の承認が必要)→ 各シートが作成されます
 * 4. [デプロイ] → [新しいデプロイ] → 種類「ウェブアプリ」
 *      実行ユーザー: 自分 / アクセスできるユーザー: 全員
 * 5. 表示された URL (…/exec) を js/config.js の gasUrl に貼る
 * 6. 下の SITE_URL に公開サイトの URL を入れて保存し、関数「installTrigger」を実行
 *    → 1時間ごとに「離脱情報」「見合わせ記録」シートが自動更新されます
 *
 * シート:
 *   予約      … 1座席=1行の予約台帳(サイトから自動追記)。状態を「取消」にすると空席に戻ります
 *   空席状況  … 乗車日・列車ごとの予約席数(自動集計)
 *   販売停止  … 乗車日(空欄=毎日)と列車番号を書くと、その列車の予約を受け付けません
 *   編成      … 編成の手動登録。1行でも登録があるとサイトはこのシートの編成を使います
 *   運行情報  … 手動の運転見合わせ。行を追加するとサイトに反映されます
 *   離脱情報  … 検査・事故などで運用を離れた編成の記録(自動更新)
 *   見合わせ記録 … ランダム・手動の運転見合わせの記録(自動更新)
 */

// 公開サイトの URL(末尾の / まで)。例: 'https://yourname.github.io/sanajima/'
const SITE_URL = '';

const TZ = 'Asia/Tokyo';
const SHEETS = {
  rsv: { name: '予約', head: ['予約番号', '受付日時', '乗車日', '列車', '号車', '座席', '乗車駅', '降車駅', '乗車順', '降車順', '予約名', '連絡先', '料金(特急券)', '状態', '席種', '人数'] },
  stop: { name: '販売停止', head: ['乗車日(空欄=毎日)', '列車番号', '理由'] },
  form: { name: '編成', head: ['編成番号', '車種(T/B/C/L)', '形式', '両数', '状態(在籍/検査/休車/廃車)', '固定運用', '備考', '製造年'] },
  wd: { name: '離脱情報', head: ['ID', '編成番号', '車種', '形式', '製造年', '種別', '理由', '離脱日', '復帰予定日', '状態', '更新日時'] },
  log: { name: '見合わせ記録', head: ['ID', '日付', '路線', '区間', '開始', '再開見込み', '理由', '種別', '状態', '更新日時'] },
  inc: { name: '運行情報', head: ['日付(空欄=毎日)', '路線番号(1-9)', '区間(から)', '区間(まで)', '開始(HH:MM)', '再開見込み(HH:MM・空欄=未定)', '理由', '有効(TRUE/FALSE)'] },
};
const SEAT_LIMIT = 6;

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.values(SHEETS).forEach((s) => {
    let sh = ss.getSheetByName(s.name);
    if (!sh) sh = ss.insertSheet(s.name);
    sh.getRange(1, 1, 1, s.head.length).setValues([s.head]).setFontWeight('bold').setBackground('#0e2a47').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, s.head.length).setNumberFormat('@'); // 文字列として保存
  });
  let sum = ss.getSheetByName('空席状況');
  if (!sum) sum = ss.insertSheet('空席状況');
  sum.clear();
  sum.getRange('A1').setFormula('=QUERY(予約!A:P,"select C, D, count(A), sum(P), sum(M) where N = \'有効\' group by C, D order by C, D label C \'乗車日\', D \'列車\', count(A) \'予約席・室数\', sum(P) \'人数\', sum(M) \'特急券売上\'",1)');
  sum.getRange('G1').setFormula('=QUERY(予約!A:P,"select C, D, O, count(A), sum(P) where N = \'有効\' group by C, D, O order by C, D, O label C \'乗車日\', D \'列車\', O \'席種\', count(A) \'予約席・室数\', sum(P) \'人数\'",1)');
  sum.getRange('M1').setValue('※ 左: 列車ごと / 右: 座席種別ごと。区間ごとに座席を管理しているため、同じ座席が別区間で重複して数えられることがあります');
  const def = ss.getSheetByName('シート1'); if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
}

// ------------------------------------------------------------------ HTTP
function doGet(e) {
  const p = e.parameter || {};
  try {
    if (p.action === 'status') return json(status());
    if (p.action === 'booked') return json(booked(p.date));
    if (p.action === 'lookup') return json(lookup(p.code, p.name));
    return json({ ok: true, service: 'sanajima-kido' });
  } catch (err) { return json({ ok: false, error: String(err.message || err) }); }
}
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: '不正なリクエストです' }); }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, error: '混み合っています。もう一度お試しください' });
  try {
    if (body.action === 'reserve') return json(reserve(body));
    if (body.action === 'cancel') return json(cancel(body.code, body.name));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) { return json({ ok: false, error: String(err.message || err) });
  } finally { lock.releaseLock(); }
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ------------------------------------------------------------------ helpers
function sheet(key) { return SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name); }
function rows(key) {
  const sh = sheet(key); const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, SHEETS[key].head.length).getValues();
}
function d2s(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); }
function t2s(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'HH:mm') : String(v || '').trim(); }
function stoppedTrains(date) {
  return rows('stop').filter((r) => String(r[1]).trim() && (!d2s(r[0]) || d2s(r[0]) === date)).map((r) => String(r[1]).trim());
}

// ------------------------------------------------------------------ API
function status() {
  const formations = rows('form').filter((r) => String(r[0]).trim()).map((r) => ({
    id: String(r[0]).trim(), type: String(r[1]).trim().toUpperCase(), series: String(r[2]), cars: Number(r[3]) || (String(r[1]).toUpperCase() === 'C' ? 2 : 4),
    status: String(r[4] || '在籍').trim(), pin: String(r[5] || '').trim(), note: String(r[6] || ''), built: Number(r[7]) || '',
  }));
  const incidents = rows('inc').filter((r) => r[1] !== '' && String(r[7]).toUpperCase() !== 'FALSE').map((r, i) => ({
    id: 'S' + (i + 2), date: d2s(r[0]) || undefined, line: Number(r[1]), from: String(r[2]).trim(), to: String(r[3]).trim(),
    start: t2s(r[4]), end: t2s(r[5]), reason: String(r[6] || '運転見合わせ'),
  }));
  return { ok: true, formations, incidents };
}

function booked(date) {
  if (!date) throw new Error('date が必要です');
  const b = rows('rsv').filter((r) => d2s(r[2]) === date && r[13] === '有効')
    .map((r) => [String(r[3]), Number(r[4]), String(r[5]), Number(r[8]), Number(r[9])]);
  return { ok: true, booked: b, stopped: stoppedTrains(date) };
}

function reserve(p) {
  if (!p.date || !p.train || !Array.isArray(p.seats) || !p.seats.length) throw new Error('入力が不足しています');
  if (p.seats.length > SEAT_LIMIT) throw new Error('一度に予約できるのは' + SEAT_LIMIT + '席(室)までです');
  const name = String(p.name || '').trim();
  if (!name) throw new Error('予約名を入力してください');
  if (Array.from(name).length > 16) throw new Error('予約名は16文字以内で入力してください');
  if (/^[=+\-@]/.test(name)) p.name = "'" + name; else p.name = name; // 数式として解釈されないように
  const fromIdx = Number(p.fromIdx), toIdx = Number(p.toIdx);
  if (!(fromIdx < toIdx)) throw new Error('区間が正しくありません');
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (p.date < today) throw new Error('過去の日付は予約できません');
  if (stoppedTrains(p.date).indexOf(String(p.train)) >= 0) throw new Error('この列車は現在販売を停止しています');
  const all = rows('rsv');
  for (const s of p.seats) {
    const clash = all.some((r) => r[13] === '有効' && d2s(r[2]) === p.date && String(r[3]) === String(p.train) &&
      Number(r[4]) === Number(s.car) && String(r[5]) === String(s.seat) && Number(r[8]) < toIdx && fromIdx < Number(r[9]));
    if (clash) throw new Error(s.car + '号車' + s.seat + 'は既に予約されています。別の座席を選んでください');
  }
  const code = genCode(all.map((r) => r[0]));
  const ts = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const out = p.seats.map((s) => [code, ts, p.date, String(p.train), Number(s.car), String(s.seat), p.from, p.to, fromIdx, toIdx,
    String(p.name).trim(), String(p.contact || ''), Number(s.price) || 0, '有効', String(s.kind || '普通席'), Number(s.persons) || 1]);
  const sh = sheet('rsv');
  const numeric = [4, 8, 9, 12, 15]; // 号車・乗車順・降車順・料金・人数 は数値、それ以外は文字列
  const fmts = out.map((r) => r.map((_, i) => (numeric.indexOf(i) >= 0 ? '0' : '@')));
  sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setNumberFormats(fmts)
    .setValues(out.map((r) => r.map((v, i) => (numeric.indexOf(i) >= 0 ? Number(v) : String(v)))));
  return { ok: true, code };
}

function lookup(code, name) {
  code = String(code || '').toUpperCase().trim();
  const items = rows('rsv').filter((r) => r[0] === code && sameName(r[10], name)).map((r) => ({
    code: r[0], date: d2s(r[2]), train: String(r[3]), car: Number(r[4]), seat: String(r[5]), from: r[6], to: r[7], state: r[13], kind: r[14], persons: Number(r[15]) || 1,
  }));
  return items.length ? { ok: true, items } : { ok: false, error: '予約が見つかりません。予約番号と予約名を確認してください' };
}

function cancel(code, name) {
  code = String(code || '').toUpperCase().trim();
  const sh = sheet('rsv'); const data = rows('rsv'); let n = 0;
  data.forEach((r, i) => {
    if (r[0] === code && sameName(r[10], name) && r[13] === '有効') { sh.getRange(i + 2, 14).setValue('取消'); n++; }
  });
  return n ? { ok: true, count: n } : { ok: false, error: '取り消せる予約がありません' };
}

function sameName(stored, given) {
  return String(stored || '').replace(/^'/, '').trim() === String(given || '').trim();
}

function genCode(existing) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = 'SJ'; for (let i = 0; i < 6; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    if (existing.indexOf(s) < 0) return s;
  }
}


// ================================================================== 自動記録(離脱情報・見合わせ記録)
function installTrigger() {
  if (!SITE_URL) throw new Error('SITE_URL を設定してください');
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'syncStatus').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncStatus').timeBased().everyHours(1).create();
  syncStatus();
}

function fetchJSON(path) {
  const res = UrlFetchApp.fetch(SITE_URL.replace(/\/?$/, '/') + path, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error(path + ' を取得できません (' + res.getResponseCode() + ')');
  return JSON.parse(res.getContentText());
}
// 運行日(3:00 で切替)と運行日の分
function serviceNow() {
  const now = new Date();
  let min = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'));
  let date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  if (min < 180) { min += 1440; date = dayStr(dayNo(date) - 1); }
  return { date, min };
}
function hm(m) { if (!isFinite(m)) return ''; m = ((Math.round(m) % 1440) + 1440) % 1440; return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2); }
function hmToMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m) return null; let v = +m[1] * 60 + +m[2]; if (v < 180) v += 1440; return v; }

function upsert(key, records) {
  const sh = sheet(key); const head = SHEETS[key].head;
  const data = rows(key); const idx = {};
  data.forEach((r, i) => (idx[r[0]] = i + 2));
  const add = [];
  records.forEach((rec) => {
    const row = head.map((h) => (rec[h] === undefined ? '' : rec[h]));
    if (idx[rec.ID]) sh.getRange(idx[rec.ID], 1, 1, row.length).setValues([row]);
    else add.push(row);
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, head.length).setNumberFormat('@').setValues(add.map((r) => r.map(String)));
}

function syncStatus() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) return;
  try {
    const t = serviceNow();
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    const sim = fetchJSON('data/sim.json');
    const lines = fetchJSON('data/lines.json');
    const st = status();
    const forms = st.formations.length ? st.formations : fetchJSON('data/formations.json');

    // ---- 離脱情報
    const wd = withdrawalsFor(t.date, forms, sim.withdrawal);
    const recs = [];
    forms.forEach((f) => {
      const w = wd[f.id];
      if (w) recs.push({ ID: w.id, '編成番号': f.id, '車種': f.type, '形式': f.series, '製造年': f.built || '', '種別': w.name, '理由': w.reason, '離脱日': w.from, '復帰予定日': w.to, '状態': '離脱中', '更新日時': stamp });
      else if (f.status && f.status !== '在籍') recs.push({ ID: 'M-' + f.id, '編成番号': f.id, '車種': f.type, '形式': f.series, '製造年': f.built || '', '種別': '手動(' + f.status + ')', '理由': f.note || '', '離脱日': '', '復帰予定日': '', '状態': '離脱中', '更新日時': stamp });
    });
    const current = {}; recs.forEach((r) => (current[r.ID] = true));
    const sh = sheet('wd');
    rows('wd').forEach((r, i) => { // 今日は離脱していない → 復帰済
      if (r[9] === '離脱中' && !current[r[0]]) sh.getRange(i + 2, 10, 1, 2).setValues([['復帰済', stamp]]);
    });
    upsert('wd', recs);

    // ---- 見合わせ記録
    const lineById = {}; lines.forEach((l) => (lineById[l.id] = l));
    const stateOf = (a, b) => (a > t.min ? '予定' : b > t.min ? '発生中' : '終了');
    const log = randomIncidentsFor(t.date, lines, sim.randomIncident, null)
      .filter((i) => i.start <= t.min) // まだ起きていないものは記録しない
      .map((i) => ({ ID: i.id, '日付': t.date, '路線': lineById[i.line].name, '区間': lineById[i.line].stations[i.a] + '〜' + lineById[i.line].stations[i.b],
        '開始': hm(i.start), '再開見込み': hm(i.end), '理由': i.reason, '種別': 'ランダム', '状態': stateOf(i.start, i.end), '更新日時': stamp }));
    let repo = [];
    try { repo = fetchJSON('data/incidents.json'); } catch (e) { repo = []; }
    const manual = repo.map((x, k) => Object.assign({ _id: 'J-' + (x.date || 'daily') + '-' + k }, x))
      .concat(st.incidents.map((x) => Object.assign({ _id: x.id }, x)));
    manual.filter((x) => x.enabled !== false && (!x.date || x.date === t.date)).forEach((x) => {
      const a = hmToMin(x.start), b = x.end ? hmToMin(x.end) : Infinity;
      const l = lineById[Number(x.line)];
      log.push({ ID: x._id + (x.date ? '' : '-' + t.date), '日付': t.date, '路線': l ? l.name : x.line, '区間': (x.from || '') + '〜' + (x.to || ''),
        '開始': x.start, '再開見込み': x.end || '未定', '理由': x.reason || '', '種別': '手動', '状態': a == null ? '' : stateOf(a, b), '更新日時': stamp });
    });
    upsert('log', log);
  } finally { lock.releaseLock(); }
}

// ================================================================== js/sim.js と同じ計算(変更するときは両方を揃える)
function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}
function rng(seed) {
  let a = hashStr(seed);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function dayNo(ds) { const p = ds.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
function dayStr(n) { const d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
function randomIncidentsFor(date, lines, R, prob) {
  const p = prob == null ? R.probabilityPerHour : prob;
  if (!R.enabled || !(p > 0)) return [];
  const out = [];
  for (const l of lines) {
    for (let h = R.firstHour; h <= R.lastHour; h++) {
      const r = rng(date + '|' + l.id + '|' + h);
      if (r() >= p) continue;
      const start = h * 60 + Math.floor(r() * 60);
      const dur = R.minMinutes + Math.floor(r() * (R.maxMinutes - R.minMinutes + 1));
      const len = 1 + Math.floor(r() * 4);
      const i = Math.floor(r() * (l.n - len));
      out.push({ id: 'R' + date + '-' + l.id + '-' + h, line: l.id, a: i, b: i + len, start, end: start + dur,
        reason: R.reasons[Math.floor(r() * R.reasons.length)], source: 'random' });
    }
  }
  return out;
}

function withdrawalsFor(date, forms, W) {
  const out = {};
  if (!W || !W.enabled) return out;
  const d = dayNo(date);
  const year = Number(date.slice(0, 4));
  for (const f of forms) {
    if (f.status && f.status !== '在籍') continue;
    const id = String(f.id);
    // 事故・故障(古い車両ほど起きやすい)
    const A = W.accident;
    if (A && A.probabilityPerDay > 0) {
      const age = f.built ? Math.max(0, year - Number(f.built)) : 0;
      const p = A.probabilityPerDay * (1 + age * (A.ageFactorPerYear || 0));
      for (let s = d - A.maxDays; s <= d; s++) {
        const r = rng('acc|' + id + '|' + s);
        if (r() >= p) continue;
        const dur = A.minDays + Math.floor(r() * (A.maxDays - A.minDays + 1));
        if (s + dur > d) { out[id] = { kind: 'accident', name: '事故・故障', reason: A.reasons[Math.floor(r() * A.reasons.length)], from: dayStr(s), to: dayStr(s + dur - 1), id: 'A-' + id + '-' + dayStr(s) }; }
      }
      if (out[id]) continue;
    }
    // 検査(全般検査を優先)
    for (const key of ['overhaul', 'inspection']) {
      const I = W[key];
      if (!I || !(I.intervalDays > 0)) continue;
      const phase = hashStr(key + '|' + id) % I.intervalDays;
      const k = (((d - phase) % I.intervalDays) + I.intervalDays) % I.intervalDays;
      if (k < I.days) {
        out[id] = { kind: key, name: I.name, reason: I.name + 'のため入場', from: dayStr(d - k), to: dayStr(d - k + I.days - 1), id: (key === 'overhaul' ? 'O-' : 'I-') + id + '-' + dayStr(d - k) };
        break;
      }
    }
  }
  return out;
}

