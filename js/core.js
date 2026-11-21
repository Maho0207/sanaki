// 早菜島軌道 — データ・時刻・運用・見合わせ・位置・経路探索
import { CONFIG } from './config.js';
import { rng, randomIncidentsFor, withdrawalsFor, nextInspection } from './sim.js';
export { rng, nextInspection };

export const TYPE_ORDER = ['特急', '快速', '急行', '準急', '各停'];
export const OP_TYPE_NAME = { T: '特急車 (4両)', B: '一般車 (4両)', C: '一般車 (2両)', L: '機関車列車' };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export { LS };

// ---------------------------------------------------------------- data
export const D = {
  ready: false, lines: [], lineById: {}, stations: [], stationId: {}, stationLines: [],
  lineIdx: {}, trains: [], trainByN: {}, ops: [], opById: {}, opsByTrain: {},
  formationsRepo: [], formationsRemote: null, incidentsRepo: [], incidentsRemote: [], news: [],
  remoteOk: false, lineKm: {}, fareTable: [], ltdTable: [], seatmaps: {}, yomi: {}, sim: {},
};

async function getText(url) {
  const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.text();
}
// 1列目=キロ(以下), 2列目=金額。見出し行・空行は無視
function parseCsv(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map((ln) => ln.split(',')).filter((c) => c.length >= 2 && /^\d+(\.\d+)?$/.test(c[0].trim()) && /^\d+$/.test(c[1].trim()))
    .map((c) => [+c[0], +c[1]]).sort((a, b) => a[0] - b[0]);
}
async function getJSON(url, fallback) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

export async function loadAll() {
  const [net, ops, forms, incs, news, dist, fareCsv, ltdCsv, seatmaps, yomi] = await Promise.all([
    getJSON('data/network.json'), getJSON('data/operations.json'),
    getJSON('data/formations.json', []), getJSON('data/incidents.json', []), getJSON('data/news.json', []),
    getJSON('data/distances.json', {}), getText('data/fare.csv'), getText('data/limited_express_fee.csv'),
    getJSON('data/seatmaps.json', {}), getJSON('data/stations.json', {}),
  ]);
  D.sim = await getJSON('data/sim.json', {});
  D.seatmaps = seatmaps; D.yomi = yomi;
  D.fareTable = parseCsv(fareCsv); D.ltdTable = parseCsv(ltdCsv);
  for (const l of net.lines) D.lineKm[l.id] = dist[l.id] || l.stations.map((_, i) => i * 2);
  D.stations = net.stations;
  net.stations.forEach((s, i) => (D.stationId[s] = i));
  D.stationLines = net.stations.map(() => []);
  for (const l of net.lines) {
    D.lines.push(l); D.lineById[l.id] = l;
    D.lineIdx[l.id] = new Map(l.stations.map((s, i) => [s, i]));
    l.stations.forEach((s) => D.stationLines[s].push(l.id));
  }
  for (const t of net.trains) {
    const st = [];
    for (let i = 0; i < t.s.length; i += 4) {
      const x = t.s[i + 3];
      st.push({ sid: t.s[i], a: t.s[i + 1], d: t.s[i + 2], L: x >> 3, op: !!(x & 1), b: !!(x & 6), th: !!(x & 4) });
    }
    const tr = { n: t.n, k: t.k, fast: !!t.f, dn: t.dn, cars: t.c, cr: t.cr, note: t.nt, partners: t.p, stops: st, nx: t.nx, pv: t.pv,
      first: st[0].d, last: st[st.length - 1].a };
    tr.kind = baseType(tr.k);
    D.trains.push(tr); D.trainByN[tr.n] = tr;
  }
  for (const o of ops) {
    D.ops.push(o); D.opById[o.id] = o;
    for (const leg of o.legs) for (const n of leg[0].split('→')) (D.opsByTrain[n] ||= []).includes(o.id) || D.opsByTrain[n].push(o.id);
  }
  D.formationsRepo = forms; D.incidentsRepo = incs; D.news = news;
  if (CONFIG.gasUrl) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(CONFIG.gasUrl + '?action=status', { signal: ctl.signal });
      clearTimeout(tm);
      const j = await r.json();
      if (j.ok) {
        D.remoteOk = true;
        if (Array.isArray(j.formations) && j.formations.length) D.formationsRemote = j.formations;
        D.incidentsRemote = j.incidents || [];
      }
    } catch (e) { console.warn('GAS status failed', e); }
  }
  D.ready = true;
}

export function baseType(k) {
  if (!k) return '各停';
  const f = k.split('→')[0];
  return f;
}
export const stName = (sid) => D.stations[sid];
export const lineOf = (id) => D.lineById[id];
export function findStation(name) {
  if (name == null) return -1;
  name = String(name).trim().replace(/駅$/, '');
  return D.stationId[name] ?? -1;
}
export function lineTerminal(L, down) {
  const s = D.lineById[L].stations; return stName(down ? s[s.length - 1] : s[0]);
}

// ---------------------------------------------------------------- time
const DAY = 86400000;
export function pad(n) { return String(n).padStart(2, '0'); }
export function fmt(min) {
  if (min == null || !isFinite(min)) return '--:--';
  const m = ((Math.floor(min) % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}
function jstParts(ms) {
  const d = new Date(ms + 9 * 3600000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
export function dateStr(p) { return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; }
export function addDays(ds, n) {
  const [y, m, d] = ds.split('-').map(Number); const t = Date.UTC(y, m - 1, d) + n * DAY; const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}
export function dayIndex(ds) { const [y, m, d] = ds.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / DAY); }
export function weekday(ds) { return '日月火水木金土'[new Date(dayIndex(ds) * DAY).getUTCDay()]; }

// 運行日: 3:00 を境に切り替え。分は 180〜1619(翌3:00直前)
export function realNow() {
  const p = jstParts(Date.now());
  let min = p.h * 60 + p.mi + p.s / 60; let date = dateStr(p);
  if (min < 180) { min += 1440; date = addDays(date, -1); }
  return { date, min };
}
export function now() {
  const sim = LS.get('sj.sim', null);
  if (sim) {
    const el = (Date.now() - sim.setAt) / 60000;
    let min = sim.min + (sim.frozen ? 0 : el); let date = sim.date;
    while (min >= 1620) { min -= 1440; date = addDays(date, 1); }
    return { date, min, sim: true };
  }
  return realNow();
}
export function setSim(date, min, frozen = false) { LS.set('sj.sim', { setAt: Date.now(), date, min, frozen }); invalidate(); }
export function clearSim() { LS.del('sj.sim'); invalidate(); }
export function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m) return null;
  let v = +m[1] * 60 + +m[2]; if (v < 180) v += 1440; return v;
}

// ---------------------------------------------------------------- RNG
// ---------------------------------------------------------------- formations / operations
export function formations() {
  const base = D.formationsRemote || D.formationsRepo;
  const local = LS.get('sj.formLocal', null); // 管理画面でのテスト編集
  return local || base;
}
export const ACTIVE_STATUS = ['在籍', '運用', '運用中', '', undefined, null];
export function isActiveFormation(f) { return ACTIVE_STATUS.includes(f.status); }

const cache = new Map();
export function invalidate() { cache.clear(); }

export function assignment(date) {
  const key = 'asg:' + date;
  if (cache.has(key)) return cache.get(key);
  const forms = formations();
  const opForm = {}; const formOp = {};
  const di = dayIndex(date);
  const prefs = CONFIG.seriesPreference || {};
  const spare = {};
  const virt = [];
  for (const type of ['T', 'C', 'B', 'L']) {
    const ops = D.ops.filter((o) => o.type === type).map((o) => o.id).sort();
    const wd = withdrawals(date);
    const fs = forms.filter((f) => f.type === type && isActiveFormation(f) && !wd[f.id]);
    const pinned = fs.filter((f) => f.pin && D.opById[f.pin] && D.opById[f.pin].type === type);
    for (const f of pinned) if (!opForm[f.pin]) { opForm[f.pin] = f.id; formOp[f.id] = f.pin; }
    const byId = (a, b) => String(a.id).localeCompare(String(b.id), 'ja', { numeric: true });
    const rotate = (arr) => { const r = arr.length ? di % arr.length : 0; return arr.slice(r).concat(arr.slice(0, r)); };
    const free = fs.filter((f) => !formOp[f.id]);
    // 形式ごとの優先路線(例: 5000型は空港線の運用へ優先充当)
    const general = [];
    const seriesList = [...new Set(free.map((f) => f.series))];
    const ordered = [...Object.keys(prefs).filter((k) => seriesList.includes(k) && prefs[k].length), ...seriesList.filter((k) => !(prefs[k] && prefs[k].length))];
    for (const ser of ordered) {
      const group = rotate(free.filter((f) => f.series === ser).sort(byId));
      const pl = prefs[ser] || [];
      if (!pl.length) { general.push(...group); continue; }
      for (const f of group) {
        let best = null, bs = 0;
        for (const op of ops) { if (opForm[op]) continue; const sc = opLineShare(op, pl); if (sc > bs) { bs = sc; best = op; } }
        if (best) { opForm[best] = f.id; formOp[f.id] = best; } else general.push(f);
      }
    }
    let k = 0;
    const rest = type === 'T' ? general : rotate(general.sort(byId));
    for (const op of ops) {
      if (opForm[op]) continue;
      if (k < rest.length) { const f = rest[k++]; opForm[op] = f.id; formOp[f.id] = op; }
      else opForm[op] = null; // 編成不足 → 運休
    }
    spare[type] = rest.slice(k);
    // 一般車4両の運用が足りないときは、余っている2両編成を2本つないで充当
    if (type === 'B' && CONFIG.allowDoubleTwoCar !== false) {
      const twos = spare.C || [];
      let q = 0;
      for (const op of ops) {
        if (opForm[op] || q + 1 >= twos.length) continue;
        const a = twos[q++], b = twos[q++];
        const id = `${a.id}+${b.id}`;
        virt.push({ id, type: 'B', series: `${a.series}×2`, cars: (a.cars || 2) + (b.cars || 2), status: '在籍', pair: [a.id, b.id], note: '2両編成×2' });
        opForm[op] = id; formOp[a.id] = op; formOp[b.id] = op;
      }
      spare.C = twos.slice(q);
    }
  }
  const res = { opForm, formOp, formById: Object.fromEntries([...forms, ...virt].map((f) => [f.id, f])), doubled: virt.length };
  cache.set(key, res);
  return res;
}

const _share = new Map();
function opLineShare(op, lines) {
  const key = op + '|' + lines.join(',');
  if (_share.has(key)) return _share.get(key);
  const legs = D.opById[op].legs; let hit = 0;
  for (const leg of legs) {
    const ls = new Set(); for (const n of leg[0].split('→')) D.trainByN[n]?.stops.forEach((s) => ls.add(s.L));
    if (lines.some((l) => ls.has(l))) hit++;
  }
  const v = legs.length ? hit / legs.length : 0; _share.set(key, v); return v;
}
// 列車番号の座席を受け持つ編成(その列車として終点まで走る編成を優先)
export function seatFormation(n, date) {
  const asg = assignment(date);
  const cand = (D.opsByTrain[n] || []).map((op) => {
    const leg = D.opById[op].legs.find((l) => l[0].split('→').includes(n));
    const ch = leg ? leg[0].split('→') : [n];
    return { op, rank: ch.length === 1 ? 0 : ch[ch.length - 1] === n ? 1 : 2, form: asg.opForm[op] };
  }).sort((a, b) => a.rank - b.rank || a.op.localeCompare(b.op));
  const hit = cand.find((c) => c.form);
  if (!hit) return null;
  const f = asg.formById[hit.form];
  return { op: hit.op, form: hit.form, f, map: D.seatmaps[f.series] || null };
}
export function seatUnits(map) {
  let n = 0; for (const c of map.cars) for (const r of c.grid) for (const x of r) if (x) n++; return n;
}
export function yomiOf(name) { return D.yomi[name] || ''; }

// 列車ごとの運用・編成・運休
export function trainOps(n, date) {
  const asg = assignment(date);
  const ops = D.opsByTrain[n] || [];
  const list = ops.map((id) => ({ op: id, form: asg.opForm[id], f: asg.formById[asg.opForm[id]] }));
  const ok = list.filter((x) => x.form);
  return { list, cancelled: list.length > 0 && ok.length === 0, reduced: ok.length > 0 && ok.length < list.length,
    cars: ok.reduce((s, x) => s + (x.f?.cars || 0), 0) };
}
export function isCancelled(n, date) {
  const key = 'cx:' + date;
  let m = cache.get(key);
  if (!m) {
    m = new Set();
    for (const t of D.trains) if (trainOps(t.n, date).cancelled) m.add(t.n);
    cache.set(key, m);
  }
  return m.has(n);
}

// ---------------------------------------------------------------- incidents (運転見合わせ)
function randomIncidents(date) {
  const R = D.sim.randomIncident || CONFIG.randomIncident;
  return randomIncidentsFor(date, D.lines.map((l) => ({ id: l.id, n: l.stations.length })), R, LS.get('sj.prob', null));
}
// 車両の自動離脱(検査・事故)
export function withdrawals(date) {
  const key = 'wd:' + date;
  if (!cache.has(key)) cache.set(key, withdrawalsFor(date, formations(), D.sim.withdrawal));
  return cache.get(key);
}
function normManual(x, src) {
  const l = D.lineById[+x.line]; if (!l) return null;
  const idx = D.lineIdx[l.id];
  let a = idx.get(findStation(x.from)), b = idx.get(findStation(x.to));
  if (a == null && b == null) { a = 0; b = l.stations.length - 1; }
  if (a == null) a = b; if (b == null) b = a;
  if (a > b) [a, b] = [b, a];
  if (a === b) { if (b < l.stations.length - 1) b++; else a--; }
  const start = parseHM(x.start) ?? 180;
  const end = x.end ? parseHM(x.end) : Infinity;
  return { id: x.id || `${src}-${x.date}-${x.line}-${x.start}`, line: l.id, a, b, start, end: end <= start ? end + 1440 : end,
    reason: x.reason || '運転見合わせ', source: src, date: x.date };
}
export function incidentsAll(date) {
  const key = 'inc:' + date;
  if (cache.has(key)) return cache.get(key);
  const manual = [...D.incidentsRepo.map((x) => ({ ...x, _s: 'manual' })), ...D.incidentsRemote.map((x) => ({ ...x, _s: 'manual' })),
    ...LS.get('sj.localInc', []).map((x) => ({ ...x, _s: 'local' }))]
    .filter((x) => x.enabled !== false && (!x.date || x.date === date))
    .map((x) => normManual(x, x._s)).filter(Boolean);
  const all = [...randomIncidents(date), ...manual].sort((p, q) => p.start - q.start);
  cache.set(key, all);
  return all;
}
// 公開されている(発生済みの)見合わせ
export function incidentsKnown(date, nowMin) {
  const t = now();
  if (date > t.date) return [];
  const cut = date < t.date ? Infinity : (nowMin ?? t.min);
  return incidentsAll(date).filter((i) => i.start <= cut);
}
export function incidentSection(i) {
  const l = D.lineById[i.line]; return [stName(l.stations[i.a]), stName(l.stations[i.b])];
}

// 列車がある路線区間 [a,b] にいる時間帯
function sectionInterval(tr, L, a, b) {
  const idx = D.lineIdx[L]; let tin = Infinity, tout = -Infinity;
  const st = tr.stops;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    const pi = idx.get(s.sid);
    if (pi != null && pi >= a && pi <= b && (s.L === L || st[i + 1]?.L === L)) { tin = Math.min(tin, s.a); tout = Math.max(tout, s.d); }
    const nx = st[i + 1];
    if (!nx || nx.L !== L) continue;
    const p0 = idx.get(s.sid), p1 = idx.get(nx.sid);
    if (p0 == null || p1 == null) continue;
    const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
    if (hi < a || lo > b) continue;
    const f = (p) => (p - p0) / (p1 - p0 || 1);
    let fa = f(a), fb = f(b); if (fa > fb) [fa, fb] = [fb, fa];
    fa = Math.max(0, fa); fb = Math.min(1, fb);
    const t0 = s.d + (nx.a - s.d) * fa, t1 = s.d + (nx.a - s.d) * fb;
    tin = Math.min(tin, t0); tout = Math.max(tout, t1);
  }
  return tin === Infinity ? null : [tin, tout];
}

// 見合わせによる影響: { hold, end, inc } — 実効時刻 = te(now)
export function trainEffect(tr, date) {
  const key = 'eff:' + date;
  let m = cache.get(key);
  if (!m) { m = new Map(); cache.set(key, m); }
  if (m.has(tr.n)) return m.get(tr.n);
  let res = null;
  for (const inc of incidentsAll(date)) {
    const lines = new Set(tr.stops.map((s) => s.L));
    if (!lines.has(inc.line)) continue;
    const iv = sectionInterval(tr, inc.line, inc.a, inc.b);
    if (!iv) continue;
    if (iv[0] < inc.end && iv[1] > inc.start) {
      const hold = Math.max(inc.start, iv[0]);
      if (!res || hold < res.hold) res = { hold, end: inc.end, inc };
    }
  }
  m.set(tr.n, res);
  return res;
}
// 実効時刻と状態 (now は運行日分)
export function effTime(tr, date, nowMin) {
  const e = trainEffect(tr, date);
  if (!e || nowMin < e.inc.start || (date === now().date && e.inc.start > now().min)) return { t: nowMin, delay: 0, held: false, eff: null };
  if (nowMin <= e.hold) return { t: nowMin, delay: 0, held: false, eff: e };
  if (nowMin < e.end) return { t: e.hold, delay: nowMin - e.hold, held: true, eff: e };
  return { t: nowMin - (e.end - e.hold), delay: e.end - e.hold, held: false, eff: e };
}

// ---------------------------------------------------------------- position
// 列車の時刻 t における位置
export function posAt(tr, t) {
  const st = tr.stops;
  if (t < st[0].d - 0.001 || t > st[st.length - 1].a + 0.001) return null;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (t >= s.a && t <= s.d) {
      const nx = st[i + 1];
      const L = nx ? nx.L : s.L;
      return { at: i, L, idx: D.lineIdx[L].get(s.sid), dir: dirOfEdge(tr, nx ? i + 1 : i), b: nx ? nx.b && s.b : s.b };
    }
    const nx = st[i + 1];
    if (nx && t > s.d && t < nx.a) {
      const L = nx.L; const idx = D.lineIdx[L];
      const p0 = idx.get(s.sid), p1 = idx.get(nx.sid);
      const f = (t - s.d) / (nx.a - s.d);
      return { from: i, to: i + 1, L, idx: p0 + (p1 - p0) * f, dir: p1 > p0 ? 1 : 0, b: nx.b };
    }
  }
  return null;
}
function dirOfEdge(tr, j) {
  const st = tr.stops; if (j <= 0) j = 1; if (!st[j]) return tr.dn;
  const idx = D.lineIdx[st[j].L]; const p0 = idx.get(st[j - 1].sid), p1 = idx.get(st[j].sid);
  return p1 > p0 ? 1 : 0;
}

// 現在走行中の列車一覧
export function activeTrains(date, nowMin) {
  const out = [];
  for (const tr of D.trains) {
    if (isCancelled(tr.n, date)) continue;
    for (const base of [nowMin, nowMin + 1440, nowMin - 1440]) {
      if (base < tr.first - 1 || base > tr.last + 200) continue;
      const ef = effTime(tr, date, base);
      const p = posAt(tr, ef.t);
      if (p) { out.push({ tr, p, ef }); break; }
    }
  }
  return out;
}

// 列車の現在の状態(列車詳細用)
export function trainNowState(tr, date) {
  const t = now();
  if (isCancelled(tr.n, date)) return { status: 'cancel' };
  if (date !== t.date) return { status: 'other' };
  for (const base of [t.min, t.min + 1440]) {
    const ef = effTime(tr, date, base);
    const p = posAt(tr, ef.t);
    if (p) return { status: ef.held ? 'held' : 'run', p, ef };
  }
  const ef = effTime(tr, date, t.min);
  if (ef.t < tr.first) return { status: 'before', ef };
  return { status: 'done', ef };
}

// ---------------------------------------------------------------- line status
export function lineStatus(L, date, nowMin) {
  const incs = incidentsKnown(date, nowMin).filter((i) => i.line === L);
  const active = incs.filter((i) => i.start <= nowMin && nowMin < i.end);
  if (active.length) return { level: 'stop', incs: active };
  const recent = incs.filter((i) => i.end <= nowMin && nowMin - i.end < 60);
  if (recent.length) return { level: 'delay', incs: recent };
  const cx = D.trains.filter((tr) => tr.stops.some((s) => s.L === L) && isCancelled(tr.n, date)).length;
  if (cx) return { level: 'partial', cancelled: cx };
  return { level: 'ok' };
}

// ---------------------------------------------------------------- station timetable
export function departures(sid, date) {
  const out = [];
  for (const tr of D.trains) {
    const st = tr.stops;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (s.sid !== sid || s.op || s.b) continue;
      const nx = st[i + 1];
      if (!nx) { out.push({ tr, i, t: s.a, arrOnly: true, L: s.L, dir: dirOfEdge(tr, i) }); continue; }
      out.push({ tr, i, t: s.d, L: nx.L, dir: dirOfEdge(tr, i + 1) });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ---------------------------------------------------------------- routing (CSA)
let CONN = null;
function connections() {
  if (CONN) return CONN;
  const c = [];
  for (let ti = 0; ti < D.trains.length; ti++) {
    const st = D.trains[ti].stops;
    for (let i = 0; i + 1 < st.length; i++) {
      c.push({ ti, i, u: st[i].sid, v: st[i + 1].sid, d: st[i].d, a: st[i + 1].a, board: !st[i].op, alight: !st[i + 1].op, L: st[i + 1].L });
    }
  }
  c.sort((x, y) => x.d - y.d || x.a - y.a);
  CONN = c; return c;
}
function blockedFn(date) {
  const t = now();
  const incs = date === t.date ? incidentsKnown(date) : [];
  return (c) => {
    if (isCancelled(D.trains[c.ti].n, date)) return true;
    for (const i of incs) {
      if (i.line !== c.L) continue;
      if (c.a < i.start || c.d > i.end) continue;
      const idx = D.lineIdx[i.line]; const p0 = idx.get(c.u), p1 = idx.get(c.v);
      if (Math.max(p0, p1) >= i.a && Math.min(p0, p1) <= i.b) return true;
    }
    return false;
  };
}

function csaForward(from, to, t0, date, blocked) {
  const C = connections(); const T = CONFIG.transferMinutes;
  const E = new Float64Array(D.stations.length).fill(Infinity);
  const tripIn = new Int32Array(D.trains.length).fill(-1);
  const J = new Array(D.stations.length);
  E[from] = t0;
  let lo = 0, hi = C.length; while (lo < hi) { const m = (lo + hi) >> 1; if (C[m].d < t0) lo = m + 1; else hi = m; }
  for (let k = lo; k < C.length; k++) {
    const c = C[k];
    if (c.d >= E[to]) break;
    if (blocked(c)) continue;
    if (tripIn[c.ti] < 0) {
      if (!c.board) continue;
      const need = c.u === from ? E[from] : E[c.u] + T;
      if (!(need <= c.d)) continue;
      // 同一列車番号の乗り継ぎ(直通)は乗換時間不要
      tripIn[c.ti] = k;
    }
    if (c.alight && c.a < E[c.v]) { E[c.v] = c.a; J[c.v] = [tripIn[c.ti], k]; }
  }
  if (!J[to]) return null;
  const legs = []; let s = to; let guard = 0;
  while (s !== from && guard++ < 50) { const [ki, ko] = J[s]; legs.unshift(legFrom(C[ki], C[ko])); s = C[ki].u; }
  return mergeLegs(legs);
}
function csaBackward(from, to, tEnd, date, blocked) {
  const C = connections(); const T = CONFIG.transferMinutes;
  const Lt = new Float64Array(D.stations.length).fill(-Infinity);
  const tripOut = new Int32Array(D.trains.length).fill(-1);
  const J = new Array(D.stations.length);
  Lt[to] = tEnd;
  if (!_bwOrder) _bwOrder = Int32Array.from(C.map((c, i) => i).sort((x, y) => C[y].a - C[x].a || C[y].d - C[x].d));
  const order = _bwOrder;
  let lo = 0, hi = order.length; while (lo < hi) { const m = (lo + hi) >> 1; if (C[order[m]].a > tEnd) lo = m + 1; else hi = m; }
  for (let q = lo; q < order.length; q++) {
    const k = order[q];
    const c = C[k];
    if (c.a > tEnd) continue;
    if (c.a <= Lt[from]) break;
    if (blocked(c)) continue;
    if (tripOut[c.ti] < 0) {
      if (!c.alight) continue;
      const need = c.v === to ? Lt[to] : Lt[c.v] - T;
      if (!(c.a <= need)) continue;
      tripOut[c.ti] = k;
    }
    if (c.board && c.d > Lt[c.u]) { Lt[c.u] = c.d; J[c.u] = [k, tripOut[c.ti]]; }
  }
  if (!J[from]) return null;
  const legs = []; let s = from; let guard = 0;
  while (s !== to && guard++ < 50) { const [ki, ko] = J[s]; legs.push(legFrom(C[ki], C[ko])); s = C[ko].v; }
  return mergeLegs(legs);
}
let _bwOrder = null;
function legFrom(cin, cout) {
  const tr = D.trains[cin.ti];
  return { tr, i: cin.i, j: cout.i + 1, from: cin.u, to: cout.v, d: cin.d, a: cout.a };
}
function mergeLegs(legs) {
  return { legs, dep: legs[0].d, arr: legs[legs.length - 1].a, transfers: legs.length - 1 };
}

export function searchRoutes(from, to, date, time, mode = 'dep', count = 4) {
  const blocked = blockedFn(date);
  const res = [];
  if (from === to || from < 0 || to < 0) return res;
  if (mode === 'dep') {
    let t = time;
    for (let n = 0; n < count; n++) {
      const r = csaForward(from, to, t, date, blocked);
      if (!r) break;
      // 同じ到着でより遅い出発を探す(待ち時間を短縮)
      const late = csaBackward(from, to, r.arr, date, blocked);
      const best = late && late.dep >= r.dep ? late : r;
      if (!res.some((x) => x.dep === best.dep && x.arr === best.arr)) res.push(best);
      t = best.dep + 1;
    }
  } else {
    let t = time;
    for (let n = 0; n < count; n++) {
      const r = csaBackward(from, to, t, date, blocked);
      if (!r) break;
      const early = csaForward(from, to, r.dep, date, blocked);
      const best = early && early.arr <= r.arr ? early : r;
      if (!res.some((x) => x.dep === best.dep && x.arr === best.arr)) res.unshift(best);
      t = best.arr - 1;
    }
  }
  return res;
}

// ---------------------------------------------------------------- 特急
// 列車 tr の i 番目 → j 番目の停車駅までの営業キロ
export function legKm(tr, i, j) {
  let km = 0;
  for (let k = i + 1; k <= j; k++) {
    const L = tr.stops[k].L; const idx = D.lineIdx[L]; const c = D.lineKm[L];
    km += Math.abs(c[idx.get(tr.stops[k].sid)] - c[idx.get(tr.stops[k - 1].sid)]);
  }
  return Math.round(km * 10) / 10;
}
function lookup(table, km) {
  if (!table.length) return 0;
  const k = Math.max(1, Math.ceil(km - 1e-9));
  for (const [lim, yen] of table) if (k <= lim) return yen;
  return table[table.length - 1][1];
}
export const fareFor = (km) => lookup(D.fareTable, km);       // 運賃
export const ltdFeeFor = (km) => lookup(D.ltdTable, km);      // 特急料金
// 経路の運賃(全区間の通算キロ)と特急料金(特急に乗る区間ごと)
export function routeFare(r) {
  const kms = r.legs.map((l) => legKm(l.tr, l.i, l.j));
  const km = kms.reduce((s, x) => s + x, 0);
  const ltd = r.legs.reduce((s, l, k) => s + (l.tr.kind === '特急' ? ltdFeeFor(kms[k]) : 0), 0);
  return { km: Math.round(km * 10) / 10, fare: fareFor(km), ltd, kms };
}
export function limitedExpressBetween(from, to) {
  const out = [];
  for (const tr of D.trains) {
    if (tr.kind !== '特急') continue;
    const st = tr.stops;
    const i = st.findIndex((s) => s.sid === from && !s.op);
    if (i < 0) continue;
    const j = st.findIndex((s, k) => k > i && s.sid === to && !s.op);
    if (j < 0) continue;
    out.push({ tr, i, j, d: st[i].d, a: st[j].a });
  }
  // 列車番号が変わる直通列車は、直通元の番号で予約(同じ編成の座席を二重に売らないため)
  const has = new Set(out.map((x) => x.tr.n));
  return out.filter((x) => !(x.tr.pv && has.has(x.tr.pv))).sort((x, y) => x.d - y.d);
}
export function typeClass(k) {
  const b = baseType(k);
  return { '特急': 'ltd', '快速': 'rap', '急行': 'exp', '準急': 'sexp', '各停': 'loc' }[b] || 'loc';
}
