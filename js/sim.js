// ランダム見合わせ・車両離脱の計算(サイトと gas/Code.gs で同じ内容。変更するときは両方を揃えてください)
// 日付と編成番号から決まる乱数を使うので、誰が・いつ計算しても同じ結果になります。

export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}
export function rng(seed) {
  let a = hashStr(seed);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function dayNo(ds) { const p = ds.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
export function dayStr(n) { const d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

// lines: [{id, n(駅数)}] → [{id, line, a, b(駅の並び番号), start, end(運行日の分), reason}]
export function randomIncidentsFor(date, lines, R, prob) {
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

// forms: [{id, built, status}] → { 編成番号: {kind, name, reason, from, to(復帰予定日), id} }
export function withdrawalsFor(date, forms, W) {
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
// 次回の検査日(表示用)
export function nextInspection(date, f, W) {
  const d = dayNo(date); const res = [];
  for (const key of ['inspection', 'overhaul']) {
    const I = W && W[key]; if (!I || !(I.intervalDays > 0)) continue;
    const phase = hashStr(key + '|' + f.id) % I.intervalDays;
    const k = (((d - phase) % I.intervalDays) + I.intervalDays) % I.intervalDays;
    res.push({ name: I.name, date: dayStr(d - k + (k < I.days ? 0 : I.intervalDays)) });
  }
  return res;
}
