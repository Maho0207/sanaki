// 運行シミュレーション:単線の行き違い・複線の続行(追い越しは★駅のみ)・運用/併結の接続による遅れの波及
//
// ・線路は★駅(待避・行き違いのできる駅)で区切った「閉塞区間」に分ける。
//   単線: 対向列車が区間内にいる間は★駅で待つ。 複線: 区間内では追い越せない(最低1分間隔)。 複々線: 制約なし。
// ・運用(同じ編成の次の列車)、併結・分割、番号の変わる直通は、前の列車が遅れると後の列車も遅れる。
// ・遅れた列車は停車時間を詰めて回復する(最短0.5分)。
// ・時刻表どおりなら制約にかからないよう、ダイヤ上の余裕を超えた遅れだけが波及する。
import { D, isCancelled, incidentsKnown, now } from './core.js';

const HEADWAY = 1;      // 最低続行間隔(分)
const MIN_DWELL = 0.5;  // 遅れ回復時の最短停車(分)
const COUPLE = 3;       // 増解結・折返しの最短時間(分)

let TRACK = null;
async function loadTrack() {
  if (TRACK) return TRACK;
  try { TRACK = await (await fetch('data/track.json', { cache: 'no-cache' })).json(); } catch { TRACK = { passing: {}, sections: {} }; }
  return TRACK;
}
export const trackReady = loadTrack();

// 路線ごと: 区間 g(駅g〜g+1)の線路数、閉塞番号
let LINEINFO = null;
function lineInfo() {
  if (LINEINFO) return LINEINFO;
  LINEINFO = {};
  for (const l of D.lines) {
    const n = l.stations.length;
    const tracks = new Array(n - 1).fill(2);
    for (const s of (TRACK?.sections?.[l.id] || [])) for (let g = s.from; g < s.to; g++) tracks[g] = s.tracks;
    const passing = new Set([0, n - 1, ...(TRACK?.passing?.[l.id] || [])]);
    const blockOf = new Array(n - 1); let k = 0;
    for (let g = 0; g < n - 1; g++) { if (g > 0 && passing.has(g)) k++; blockOf[g] = k; }
    LINEINFO[l.id] = { tracks, passing, blockOf, km: D.lineKm[l.id] };
  }
  return LINEINFO;
}
export function isPassingStation(L, idx) { return lineInfo()[L].passing.has(idx); }
export function trackCount(L, g) { return lineInfo()[L].tracks[g]; }

// 列車の経路点: 自列車区間の停車駅+通過する★駅(時刻はキロ程で按分)
function waypoints(tr) {
  const info = lineInfo(); const out = [];
  const st = tr.stops;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (s.b) continue; // 併結(相手が本務)・直通の区間は本務列車の動きに従う
    if (out.length) {
      const prev = out[out.length - 1];
      const L = s.L; const idx = D.lineIdx[L]; const I = info[L];
      const p0 = idx.get(prev.sid), p1 = idx.get(s.sid);
      if (p0 != null && p1 != null && Math.abs(p1 - p0) > 1) {
        const dir = p1 > p0 ? 1 : -1;
        const k0 = I.km[p0], k1 = I.km[p1];
        for (let p = p0 + dir; p !== p1; p += dir) {
          if (!I.passing.has(p)) continue;
          const f = (I.km[p] - k0) / ((k1 - k0) || 1);
          const t = prev.d + (s.a - prev.d) * f;
          out.push({ sid: D.lines.find((x) => x.id === L).stations[p], a: t, d: t, L, pass: true, wp: true, si: -1 });
        }
      }
    }
    out.push({ sid: s.sid, a: s.a, d: s.d, L: s.L, pass: s.pass || s.op, si: i });
  }
  return out;
}

// 経路点 j → j+1 の区間(閉塞)
function hopInfo(w, j) {
  const a = w[j], b = w[j + 1]; const L = b.L; const I = lineInfo()[L]; const idx = D.lineIdx[L];
  const p0 = idx.get(a.sid), p1 = idx.get(b.sid);
  if (p0 == null || p1 == null) return { L, free: true, lo: 0, hi: 0, dir: 1 };
  const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
  let tracks = 4; for (let g = lo; g < hi; g++) tracks = Math.min(tracks, I.tracks[g]);
  return { L, lo, hi, dir: p1 > p0 ? 1 : 0, tracks, free: tracks >= 4, block: `${L}:${I.blockOf[lo]}` };
}

// 列車どうしの接続(運用・併結・直通): after は「この列車のこの経路点を出る前に、相手がその駅に着いている」
function buildLinks(trains, W) {
  const byN = new Map(trains.map((t, i) => [t.n, i]));
  const deps = trains.map(() => []); // [{wp, other, otherWp:'end'|sid, gap}]
  const add = (ti, wp, oi, oSid, gap) => { if (ti != null && oi != null && ti !== oi) deps[ti].push({ wp, oi, oSid, gap }); };
  // 運用: 前の行路の最後の列車 → 次の行路の最初の列車
  for (const op of D.ops) {
    for (let k = 0; k + 1 < op.legs.length; k++) {
      const x = op.legs[k][0].split('→').at(-1), y = op.legs[k + 1][0].split('→')[0];
      const xi = byN.get(x), yi = byN.get(y);
      if (xi == null || yi == null) continue;
      const wx = W[xi], wy = W[yi];
      if (!wx.length || !wy.length) continue;
      const gap = wy[0].d - wx[wx.length - 1].a;
      if (gap < -1) continue; // 日をまたぐ運用(翌朝の列車)はつながない
      add(yi, 0, xi, wx[wx.length - 1].sid, Math.max(0, gap));
    }
  }
  // 併結・分割・直通: 自列車区間の端の駅が、相手列車の経路にある場合
  trains.forEach((t, ti) => {
    const w = W[ti]; if (!w.length) return;
    const rel = [...t.partners, t.nx, t.pv].filter(Boolean);
    for (const pn of rel) {
      const oi = byN.get(pn); if (oi == null) continue;
      const wo = W[oi];
      // 分割・直通の後: 自分の始発駅に相手が着いてから発車
      const first = w[0];
      const atO = wo.find((x) => x.sid === first.sid);
      if (atO && atO.a <= first.d + 0.01 && wo[0].sid !== first.sid) add(ti, 0, oi, first.sid, Math.max(0, first.d - atO.a));
      // 併結: 相手が自分の終点で併結される → 相手(本務)はこちらの到着を待って発車
      const last = w[w.length - 1];
      const j = wo.findIndex((x) => x.sid === last.sid);
      if (j >= 0 && j < wo.length - 1 && wo[j].d >= last.a - 0.01 && t.stops.at(-1).sid !== last.sid) add(oi, j, ti, last.sid, Math.max(0, wo[j].d - last.a));
    }
  });
  return deps;
}

class Heap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].t <= a[i].t) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].t < a[m].t) m = l; if (r < a.length && a[r].t < a[m].t) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

// incidents: [{line, a, b, start, end}]
function simulate(date, incidents, debugN) {
  const LOG = [];
  const trains = D.trains.filter((t) => !isCancelled(t.n, date));
  const W = trains.map(waypoints);
  const deps = buildLinks(trains, W);
  const act = W.map((w) => w.map((x) => ({ a: null, d: null })));
  const holds = W.map(() => ({}));
  const pos = new Int32Array(trains.length); // 現在の経路点
  const blocks = new Map(); // block -> [{ti, dir, ent, exit, sEnt, sExit, arr: Map(sid->t)}]
  const inc = incidents.map((i) => ({ ...i }));
  const incOn = (h) => inc.filter((i) => i.line === h.L && Math.max(h.lo, i.a) < Math.min(h.hi, i.b));
  const hp = new Heap();
  trains.forEach((t, ti) => { if (W[ti].length > 1) { act[ti][0].a = W[ti][0].a; hp.push({ t: W[ti][0].d, ti }); } });
  let guard = 0;
  while (hp.size && guard++ < 2e6) {
    const ev = hp.pop(); const ti = ev.ti; let t = ev.t; const w = W[ti]; let j = pos[ti];
    if (!(t < 5000)) continue; // 再開見込みの無い見合わせ等で動けない列車はここで止まる
    // 接続待ち
    let wait = t;
    for (const dp of deps[ti]) {
      if (dp.wp !== j) continue;
      const wo = W[dp.oi]; const k = wo.findIndex((x) => x.sid === dp.oSid);
      if (k < 0) continue;
      const arr = act[dp.oi][k].a;
      if (arr == null) { wait = Math.max(wait, t + 1); continue; } // 相手がまだ着いていない → 少し後に再確認
      wait = Math.max(wait, arr + Math.min(COUPLE, dp.gap));
    }
    if (wait > t + 1e-6) { if (trains[ti].n === debugN) LOG.push(`dep wait wp${j} ${D.stations[w[j].sid]} t=${t.toFixed(1)}→${wait.toFixed(1)} deps=${deps[ti].filter((d) => d.wp === j).map((d) => trains[d.oi].n + '@' + D.stations[d.oSid] + ' gap' + d.gap.toFixed(1)).join(',')}`); hp.push({ t: wait, ti }); continue; }
    // 閉塞区間(★駅から次の★駅まで)
    const h0 = hopInfo(w, j);
    let k = j + 1;
    while (k < w.length - 1 && !h0.free) { const hk = hopInfo(w, k); if (hk.block !== h0.block || hk.dir !== h0.dir) break; k++; }
    // 見合わせ区間に入れない
    let hold = t;
    for (const i of incOn(h0)) if (t >= i.start && t < i.end) hold = Math.max(hold, i.end);
    if (hold > t + 1e-6) { hp.push({ t: hold, ti }); continue; }
    // 単線: 対向列車がいれば待つ
    const sEnt = w[j].d, sExit = w[k].a;
    let leader = null;
    if (!h0.free) {
      const occ = blocks.get(h0.block) || [];
      let until = t;
      for (const o of occ) {
        if (o.ti === ti) continue;
        if (h0.tracks === 1 && o.dir !== h0.dir && o.exit > t + 1e-6) {
          const planned = o.sEnt < sExit && sEnt < o.sExit; // ダイヤ上で重なっている組は対象外
          if (!planned) until = Math.max(until, o.exit);
        }
        if (o.dir === h0.dir && (!leader || o.ent > leader.ent)) leader = o;
      }
      if (until > t + 1e-6) { if (trains[ti].n === debugN) LOG.push(`single-track wait ${h0.block} at ${D.stations[w[j].sid]} t=${t.toFixed(1)}→${until.toFixed(1)} occ=${occ.filter((o) => o.dir !== h0.dir && o.exit > t).map((o) => trains[o.ti].n + ' s[' + o.sEnt.toFixed(0) + '-' + o.sExit.toFixed(0) + '] a[' + o.ent.toFixed(1) + '-' + o.exit.toFixed(1) + ']').join(',')} me s[${sEnt.toFixed(0)}-${sExit.toFixed(0)}]`); hp.push({ t: until, ti }); continue; }
    }
    // 区間を走る
    const arrMap = new Map();
    let dep = t;
    for (let q = j; q < k; q++) {
      if (q > j) {
        const sched = w[q];
        dep = Math.max(sched.d, act[ti][q].a + (sched.d > sched.a ? Math.min(MIN_DWELL, sched.d - sched.a) : 0));
        for (const i of incOn(hopInfo(w, q))) if (dep >= i.start && dep < i.end) dep = i.end;
      }
      act[ti][q].d = dep;
      const run = Math.max(0.2, w[q + 1].a - w[q].d);
      let a = dep + run;
      for (const i of incOn(hopInfo(w, q))) if (dep < i.start && i.start < a) { holds[ti][q] = [i.start, Math.min(i.end, 1e9)]; a += i.end - i.start; }
      if (leader) {
        const la = leader.arr.get(w[q + 1].sid);
        if (la != null) {
          const sg = w[q + 1].a - (leader.sArr.get(w[q + 1].sid) ?? -1e9);
          // ダイヤ上こちらが先の駅では制約しない(遅れて順序が入れ替わった場合だけ後ろにつく)
          const lateMe = t - sEnt > 0.5;
          const na = sg >= 0 ? Math.max(a, la + Math.min(HEADWAY, sg)) : lateMe ? Math.max(a, la + HEADWAY) : a;
          if (na > a + 0.01 && trains[ti].n === debugN) LOG.push(`headway behind ${trains[leader.ti].n} at ${D.stations[w[q + 1].sid]} a ${a.toFixed(1)}→${na.toFixed(1)} sched me ${w[q + 1].a} leader ${leader.sArr.get(w[q + 1].sid)}`);
          a = na;
        }
      }
      if (!isFinite(a)) a = 1e9;
      act[ti][q + 1].a = a; arrMap.set(w[q + 1].sid, a);
    }
    if (!h0.free) {
      const list = blocks.get(h0.block) || []; blocks.set(h0.block, list);
      const sArr = new Map(); for (let q = j + 1; q <= k; q++) sArr.set(w[q].sid, w[q].a);
      list.push({ ti, dir: h0.dir, ent: t, exit: act[ti][k].a, sEnt, sExit, arr: arrMap, sArr });
      if (list.length > 40) list.splice(0, list.length - 40);
    }
    pos[ti] = k;
    if (k >= w.length - 1) { act[ti][k].d = act[ti][k].a; continue; }
    const sk = w[k];
    const ready = Math.max(sk.d, act[ti][k].a + (sk.d > sk.a ? Math.min(MIN_DWELL, sk.d - sk.a) : 0));
    hp.push({ t: ready, ti });
  }
  // 結果: 列車ごとの実際の時刻(停車駅+通過★駅)
  const res = new Map();
  trains.forEach((t, ti) => {
    const w = W[ti];
    res.set(t.n, w.map((x, q) => ({ ...x, a: act[ti][q].a ?? x.a, d: act[ti][q].d ?? act[ti][q].a ?? x.d, sa: x.a, sd: x.d, hold: holds[ti][q] || null })));
  });
  // 併結・直通区間(b)は本務列車の時刻に合わせる
  for (const t of trains) {
    const own = res.get(t.n); if (!own) continue;
    const full = [];
    for (let i = 0; i < t.stops.length; i++) {
      const s = t.stops[i];
      if (!s.b) continue;
      // 同じ駅を通る相手列車のうち、ダイヤ上の時刻がいちばん近いものの「遅れ」を当てはめる
      let src = null, best = 1e9;
      for (const pn of [...t.partners, t.nx, t.pv].filter(Boolean)) {
        const r = res.get(pn); if (!r) continue;
        for (const y of r) {
          if (y.sid !== s.sid || y.b) continue;
          const diff = Math.abs(y.sa - s.a) + Math.abs(y.sd - s.d);
          if (diff < best) { best = diff; src = y; }
        }
      }
      const da = src ? src.a - src.sa : 0, dd = src ? src.d - src.sd : 0;
      full.push({ i, x: { sid: s.sid, L: s.L, pass: s.pass || s.op, b: true, si: i, sa: s.a, sd: s.d, a: s.a + da, d: Math.max(s.a + da, s.d + dd) } });
    }
    if (full.length) {
      const merged = [...own];
      for (const { i, x } of full) {
        const at = merged.findIndex((y) => y.si > i && y.si >= 0);
        if (merged.some((y) => y.si === i)) continue;
        if (at < 0) merged.push(x); else merged.splice(at, 0, x);
      }
      res.set(t.n, merged);
    }
  }
  if (debugN) { const di = trains.findIndex((t) => t.n === debugN); res.LOG = LOG; res.W = W[di].map((x, q) => [D.stations[x.sid], x.a, x.d, act[di][q].a, act[di][q].d]); res.DEPS = deps[di].map((d) => [d.wp, trains[d.oi].n, D.stations[d.oSid], d.gap]); }
  return res;
}

// 実際の運行(遅れを反映した時刻)。見合わせが無い日は時刻表どおり
let CACHE = { key: null, res: null };
export function actualRuns(date, nowMin) {
  if (!TRACK) return null;
  const incs = incidentsKnown(date, nowMin);
  const key = date + '|' + incs.map((i) => `${i.id}:${i.start}:${i.end}`).join(',');
  if (CACHE.key === key) return CACHE.res;
  let res = null;
  if (incs.length) {
    const t0 = performance.now();
    res = simulate(date, incs);
    console.info(`運行シミュレーション ${Math.round(performance.now() - t0)}ms (見合わせ${incs.length}件)`);
  }
  CACHE = { key, res };
  return res;
}
// 列車の実際の経路(時刻表の stops と同じ形 + 予定時刻 sa/sd)
export function actualTrain(tr, date, nowMin) {
  const res = actualRuns(date, nowMin);
  const r = res && res.get(tr.n);
  if (r) return { ...tr, stops: r, first: r[0].d, last: r[r.length - 1].a, simulated: true };
  return { ...tr, stops: tr.stops.map((s, i) => ({ ...s, sa: s.a, sd: s.d, si: i })), simulated: false };
}
// テスト用: 見合わせが無い場合に遅れが出ないか
export function selfTest(date) {
  const res = simulate(date, []);
  let maxD = 0, worst = null; const late = [];
  for (const [n, r] of res) {
    let m = 0, at = null;
    for (const x of r) { const dl = Math.max((x.a ?? 0) - (x.sa ?? 0), (x.d ?? 0) - (x.sd ?? 0)); if (dl > m) { m = dl; at = D.stations[x.sid]; } }
    if (m >= 0.5) late.push([n, Math.round(m * 10) / 10, at]);
    if (m > maxD) { maxD = m; worst = n + ' ' + at; }
  }
  late.sort((a, b) => b[1] - a[1]);
  return { maxDelay: maxD, worst, count: late.length, sample: late.slice(0, 15) };
}
export { simulate };
