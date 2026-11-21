// 駅時刻表
import { D, yomiOf, now, fmt, stName, findStation, departures, isCancelled, effTime, lineOf, typeClass, trainOps } from './core.js';
import { esc, $, $$, lineBadge, typeBadge, dest, ensureStationDatalist, stationInput } from './ui.js';
import { setTicker } from './app.js';

export function pageTimetable(el, station, query) {
  const sid = findStation(station);
  if (!station || sid < 0) return indexPage(el, station);
  const q = new URLSearchParams(query || '');
  const t = now();
  const deps = departures(sid, t.date);
  const groups = new Map();
  for (const d of deps) {
    if (d.arrOnly) continue;
    const key = `${d.L}-${d.dir}`;
    if (!groups.has(key)) groups.set(key, { L: d.L, dir: d.dir, list: [] });
    groups.get(key).list.push(d);
  }
  const keys = [...groups.keys()].sort();
  const sel = q.get('g') && groups.has(q.get('g')) ? q.get('g') : keys[0];
  const g = groups.get(sel);
  const dirLabel = (gr) => {
    const l = lineOf(gr.L); const st = l.stations;
    return `${l.name} ${gr.dir ? '下り' : '上り'} ${stName(gr.dir ? st[st.length - 1] : st[0])}方面`;
  };
  const lines = D.stationLines[sid];

  el.innerHTML = `
  <div class="wrap">
    <p class="crumb"><a href="#/timetable">時刻表</a> › ${esc(stName(sid))}</p>
    <div class="st-h"><h1><ruby>${esc(stName(sid))}<rt>${esc(yomiOf(stName(sid)))}</rt></ruby><small>駅</small></h1><div>${lines.map((x) => lineBadge(x, true)).join('')}</div></div>
    <div class="grid2 tt-grid">
      <section class="card">
        <div class="card-h"><h2>まもなく発車</h2><span class="muted small" id="nextnow"></span></div>
        <div id="nextbox"></div>
      </section>
      <section class="card">
        <div class="card-h"><h2>時刻表</h2></div>
        <div class="tabs small">${keys.map((k) => `<a href="#/timetable/${encodeURIComponent(stName(sid))}?g=${k}" class="${k === sel ? 'on' : ''}">${esc(dirLabel(groups.get(k)))}</a>`).join('')}</div>
        ${g ? hourGrid(g.list, t.date) : '<p class="muted">この駅から発車する列車はありません。</p>'}
        <p class="legend small">${['特急', '快速', '急行', '準急', '各停'].map((k) => `<span class="tm ${typeClass(k)}">${k}</span>`).join('')} <span class="muted">数字の下は行先の頭文字。<s>取消線</s>は運休。</span></p>
      </section>
    </div>
  </div>`;
  const drawNext = () => {
    const t2 = now();
    $('#nextnow').textContent = fmt(t2.min) + ' 現在';
    const up = [];
    for (const d of deps) {
      if (d.arrOnly) continue;
      const e0 = effTime(d.tr, t2.date, t2.min);
      const affected = e0.eff && d.t >= e0.eff.hold;
      const ef = affected ? e0 : { delay: 0, held: false, t: t2.min };
      const real = affected ? (e0.held ? Infinity : d.t + e0.delay) : d.t;
      if (real < t2.min - 0.5) continue;
      up.push({ d, ef, real });
      if (up.length >= 10) break;
    }
    $('#nextbox').innerHTML = up.length ? `<table class="tbl next"><tbody>${up.map(({ d, ef }) => {
      const cx = isCancelled(d.tr.n, t2.date);
      const ops = trainOps(d.tr.n, t2.date);
      let st = '';
      if (cx) st = '<span class="pill stop">運休</span>';
      else if (ef.held) st = '<span class="pill stop">見合わせ</span>';
      else if (ef.delay >= 1) st = `<span class="pill delay">${Math.round(ef.delay)}分遅れ</span>`;
      return `<tr class="${cx ? 'cx' : ''}"><td class="tnum">${fmt(d.t)}</td><td>${typeBadge(d.tr.k, d.tr.fast)}</td><td><a href="#/train/${encodeURIComponent(d.tr.n)}">${esc(dest(d.tr))}行</a><small class="muted"> ${esc(d.tr.n)}${ops.reduced ? ' 減車' : ''}</small></td><td>${lineBadge(d.L)}</td><td>${st}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="muted">本日の発車は終了しました。</p>';
  };
  drawNext();
  setTicker(drawNext, 20000);
}

function hourGrid(list, date) {
  const byH = new Map();
  for (const d of list) {
    const m = d.t % 1440; const h = Math.floor(m / 60);
    const key = d.t >= 1440 ? h + 24 : h;
    if (!byH.has(key)) byH.set(key, []);
    byH.get(key).push(d);
  }
  const hours = [...byH.keys()].sort((a, b) => a - b);
  return `<table class="hgrid"><tbody>${hours.map((h) => `<tr><th>${h % 24}</th><td>${byH.get(h).map((d) => {
    const cx = isCancelled(d.tr.n, date);
    return `<a class="tm ${typeClass(d.tr.k)}${cx ? ' cx' : ''}" href="#/train/${encodeURIComponent(d.tr.n)}" title="${esc(d.tr.k)} ${esc(dest(d.tr))}行 ${esc(d.tr.n)}">${String(Math.floor(d.t % 60)).padStart(2, '0')}<small>${esc(dest(d.tr)[0])}</small></a>`;
  }).join('')}</td></tr>`).join('')}</tbody></table>`;
}

function indexPage(el, bad) {
  el.innerHTML = `
  <div class="wrap">
    <h1 class="ph">時刻表</h1>
    ${bad ? `<p class="err">「${esc(bad)}」という駅は見つかりませんでした。</p>` : ''}
    <div class="grid2">
      <form class="card" id="stf"><h3>駅名から探す</h3><div class="row">${stationInput('stq', '', '例: 早菜中央')}<button class="btn primary">表示</button></div></form>
      <form class="card" id="trf"><h3>列車番号から探す</h3><div class="row"><input id="trq" class="inp" placeholder="例: 2601 / さるり201"><button class="btn">表示</button></div></form>
    </div>
    <section class="card">
      <h3>路線から探す</h3>
      ${D.lines.map((l) => `<details class="stidx"><summary>${lineBadge(l.id, true)}<small class="muted">${l.stations.length}駅</small></summary><div class="stchips">${l.stations.map((s) => `<a href="#/timetable/${encodeURIComponent(stName(s))}">${esc(stName(s))}</a>`).join('')}</div></details>`).join('')}
    </section>
  </div>`;
  ensureStationDatalist();
  $('#stf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/timetable/' + encodeURIComponent($('#stq').value.trim().replace(/駅$/, '')); };
  $('#trf').onsubmit = (e) => {
    e.preventDefault(); const v = $('#trq').value.trim();
    const hit = D.trainByN[v] || D.trains.find((x) => x.n.endsWith(v) || x.n.includes(v));
    if (hit) location.hash = '#/train/' + encodeURIComponent(hit.n); else alert('該当する列車がありません');
  };
}
