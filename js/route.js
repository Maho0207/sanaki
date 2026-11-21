// 乗換案内
import { CONFIG } from './config.js';
import { D, now, fmt, stName, findStation, searchRoutes, parseHM, addDays, weekday, incidentsKnown, incidentSection, routeFare, ltdFeeFor } from './core.js';
import { esc, $, lineBadge, typeBadge, dest, ensureStationDatalist, stationInput, minutesLabel } from './ui.js';

export function pageRoute(el, query) {
  const q = new URLSearchParams(query || '');
  const t = now();
  const date = q.get('date') || t.date;
  const time = q.get('time') || fmt(t.min);
  const mode = q.get('mode') || 'dep';
  el.innerHTML = `
  <div class="wrap">
    <h1 class="ph">乗換案内</h1>
    <form class="card search" id="rf">
      <div class="rgrid">
        <label>出発<span>${stationInput('rfrom', q.get('from') || '', '出発駅')}</span></label>
        <button type="button" class="swap" id="rswap" aria-label="入れ替え">⇄</button>
        <label>到着<span>${stationInput('rto', q.get('to') || '', '到着駅')}</span></label>
      </div>
      <div class="rgrid2">
        <select id="rdate" class="inp">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(t.date, i); return `<option value="${d}" ${d === date ? 'selected' : ''}>${d.slice(5).replace('-', '/')}(${weekday(d)})${i === 0 ? ' 今日' : ''}</option>`; }).join('')}</select>
        <input id="rtime" class="inp" type="time" value="${esc(time.padStart(5, '0'))}">
        <div class="seg"><label><input type="radio" name="mode" value="dep" ${mode === 'dep' ? 'checked' : ''}>出発</label><label><input type="radio" name="mode" value="arr" ${mode === 'arr' ? 'checked' : ''}>到着</label></div>
        <button class="btn primary">検索</button>
      </div>
    </form>
    <div id="rres"></div>
  </div>`;
  ensureStationDatalist();
  $('#rswap').onclick = () => { const a = $('#rfrom').value; $('#rfrom').value = $('#rto').value; $('#rto').value = a; };
  $('#rf').onsubmit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams({ from: $('#rfrom').value.trim(), to: $('#rto').value.trim(), date: $('#rdate').value, time: $('#rtime').value, mode: $('#rf').mode.value });
    location.hash = '#/route?' + p.toString();
  };
  if (q.get('from') && q.get('to')) run(q.get('from'), q.get('to'), date, time, mode);
}

function run(fromName, toName, date, time, mode) {
  const box = $('#rres');
  const from = findStation(fromName), to = findStation(toName);
  if (from < 0 || to < 0) { box.innerHTML = `<p class="err">${from < 0 ? `「${esc(fromName)}」` : ''}${to < 0 ? `「${esc(toName)}」` : ''}という駅は見つかりませんでした。</p>`; return; }
  if (from === to) { box.innerHTML = `<p class="err">出発駅と到着駅が同じです。</p>`; return; }
  const tm = parseHM(time) ?? now().min;
  box.innerHTML = '<p class="muted">検索中…</p>';
  setTimeout(() => {
    const t0 = performance.now();
    const res = searchRoutes(from, to, date, tm, mode, 4);
    const ms = Math.round(performance.now() - t0);
    if (!res.length) { box.innerHTML = `<div class="card"><p>指定の時刻以降に到着できる経路が見つかりませんでした。${mode === 'dep' ? '本日の運転は終了している可能性があります。' : ''}</p></div>`; return; }
    const fastest = Math.min(...res.map((r) => r.arr - r.dep));
    const fewest = Math.min(...res.map((r) => r.transfers));
    const incs = date === now().date ? incidentsKnown(date).filter((i) => i.end > now().min) : [];
    box.innerHTML = `<p class="muted small">${esc(stName(from))} → ${esc(stName(to))}  ${res.length}件 (${ms}ms)</p>` +
      (incs.length ? `<div class="alert stop small">運転見合わせ中の区間を避けて検索しています: ${incs.map((i) => { const [a, b] = incidentSection(i); return `${D.lineById[i.line].name} ${esc(a)}〜${esc(b)}`; }).join(' / ')}</div>` : '') +
      res.map((r, k) => routeCard(r, k, date, r.arr - r.dep === fastest, r.transfers === fewest)).join('') + '<p class="small muted">※ 早菜島軌道は架空の鉄道です。運賃・料金は架空のもので、実際に請求されることはありません。</p>';
  }, 20);
}

function routeCard(r, k, date, isFast, isFew) {
  const f = routeFare(r);
  let html = `<article class="card route">
    <header><div class="rt-time"><b>${fmt(r.dep)}</b> → <b>${fmt(r.arr)}</b></div>
      <div class="rt-meta"><span>${minutesLabel(r.arr - r.dep)}</span><span>乗換 ${r.transfers}回</span><span>${f.km.toFixed(1)}km</span><span class="yen">運賃 <b>${f.fare.toLocaleString()}円</b></span>${f.ltd ? `<span class="yen">特急料金 <b>${f.ltd.toLocaleString()}円</b></span>` : ''}
      ${isFast ? '<span class="tag fast">早</span>' : ''}${isFew ? '<span class="tag few">楽</span>' : ''}</div></header>
    <ol class="legs">`;
  r.legs.forEach((l, i) => {
    const tr = l.tr; const st = tr.stops;
    const mid = st.slice(l.i + 1, l.j - 1).filter((s) => !s.op);
    if (i > 0) {
      const wait = l.d - r.legs[i - 1].a;
      html += `<li class="xfer">乗換 ${wait}分待ち</li>`;
    }
    html += `<li class="stn"><span class="tt">${fmt(l.d)}</span><a href="#/timetable/${encodeURIComponent(stName(l.from))}">${esc(stName(l.from))}</a></li>
      <li class="ride" style="--lc:${D.lineById[st[l.i + 1].L].color}">
        <div>${lineBadge(st[l.i + 1].L)} ${typeBadge(tr.k, tr.fast)} <a href="#/train/${encodeURIComponent(tr.n)}">${esc(tr.n)} ${esc(dest(tr))}行</a></div>
        <details><summary>${minutesLabel(l.a - l.d)}・${f.kms[i].toFixed(1)}km・途中${mid.length}駅に停車${tr.kind === '特急' ? `・特急料金 ${ltdFeeFor(f.kms[i]).toLocaleString()}円` : ''}</summary><p class="small muted">${mid.map((s) => `${esc(stName(s.sid))} ${fmt(s.d)}`).join(' / ') || '途中停車なし'}</p></details>
        ${tr.kind === '特急' ? `<a class="btn small" href="#/reserve?train=${encodeURIComponent(tr.n)}&from=${encodeURIComponent(stName(l.from))}&to=${encodeURIComponent(stName(l.to))}&date=${date}">この特急を予約</a>` : ''}
      </li>`;
    if (i === r.legs.length - 1) html += `<li class="stn"><span class="tt">${fmt(l.a)}</span><a href="#/timetable/${encodeURIComponent(stName(l.to))}">${esc(stName(l.to))}</a></li>`;
  });
  return html + `</ol></article>`;
}
