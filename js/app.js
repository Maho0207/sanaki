// 早菜島軌道 — ルーター・ホーム・列車位置・列車詳細
import { CONFIG } from './config.js';
import {
  D, loadAll, now, fmt, stName, lineOf, lineStatus, activeTrains, incidentsKnown, incidentSection,
  trainOps, trainNowState, isCancelled, seatFormation, OP_TYPE_NAME, weekday, lineTerminal, typeClass,
} from './core.js';
import { esc, $, $$, lineBadge, typeBadge, trainLink, dest, orig, networkMap, ensureStationDatalist, stationInput, minutesLabel } from './ui.js';
import { pageTimetable } from './timetable.js';
import { pageRoute } from './route.js';
import { pageReserve } from './reserve.js';
import { pageFleet } from './fleet.js';
import { pageAdmin } from './admin.js';

const app = $('#app');
let timer = null;
export function setTicker(fn, ms = 15000) { clearInterval(timer); if (fn) timer = setInterval(fn, ms); }

const ROUTES = [
  [/^#?\/?$/, pageHome, 'home'],
  [/^#\/status$/, pageStatus, 'status'],
  [/^#\/live(?:\/(\d))?$/, pageLive, 'live'],
  [/^#\/train\/(.+)$/, pageTrain, 'timetable'],
  [/^#\/timetable(?:\/([^?]+))?(?:\?(.*))?$/, pageTimetable, 'timetable'],
  [/^#\/route(?:\?(.*))?$/, pageRoute, 'route'],
  [/^#\/reserve(?:\/(\w+))?(?:\?(.*))?$/, pageReserve, 'reserve'],
  [/^#\/fleet(?:\/([^?]+))?(?:\?(.*))?$/, pageFleet, 'fleet'],
  [/^#\/admin$/, pageAdmin, 'admin'],
];

function render() {
  setTicker(null);
  const h = location.hash || '#/';
  for (const [re, fn, nav] of ROUTES) {
    const m = h.match(re);
    if (m) {
      $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
      app.innerHTML = '';
      try { fn(app, ...m.slice(1).map((x) => (x == null ? x : decodeURIComponent(x)))); }
      catch (e) { console.error(e); app.innerHTML = `<div class="wrap"><p class="err">表示中にエラーが発生しました: ${esc(e.message)}</p></div>`; }
      window.scrollTo(0, 0);
      updateClock();
      return;
    }
  }
  app.innerHTML = `<div class="wrap"><h1>ページが見つかりません</h1><p><a href="#/">トップへ戻る</a></p></div>`;
}

function updateClock() {
  const t = now();
  const el = $('#clock');
  if (el) el.innerHTML = `${t.sim ? '<b class="simtag">シミュレーション</b>' : ''}<span class="dt">${t.date.slice(5).replace('-', '/')}(${weekday(t.date)})</span> <strong>${fmt(t.min)}</strong>`;
}

// ---------------------------------------------------------------- home
const LV = { ok: ['平常運転', 'ok'], stop: ['運転見合わせ', 'stop'], delay: ['遅れ', 'delay'], partial: ['一部運休', 'partial'] };
function statusRows(date, min) {
  return D.lines.map((l) => {
    const s = lineStatus(l.id, date, min);
    const [label, cls] = LV[s.level];
    let detail = '';
    if (s.level === 'stop') detail = s.incs.map((i) => { const [a, b] = incidentSection(i); return `${esc(i.reason)}のため、${esc(a)}〜${esc(b)}駅間で運転を見合わせています。運転再開見込み ${isFinite(i.end) ? fmt(i.end) + '頃' : '未定'}`; }).join('<br>');
    else if (s.level === 'delay') detail = s.incs.map((i) => { const [a, b] = incidentSection(i); return `${fmt(i.start)}頃に${esc(a)}〜${esc(b)}駅間で発生した${esc(i.reason)}の影響で、一部列車に遅れが出ています。`; }).join('<br>');
    else if (s.level === 'partial') detail = `車両運用の都合により、本日${s.cancelled}本の列車を運休しています。`;
    return { l, s, label, cls, detail };
  });
}

function pageHome(el) {
  const t = now();
  const rows = statusRows(t.date, t.min);
  const ls = Object.fromEntries(rows.map((r) => [r.l.id, r.s.level]));
  const trouble = rows.filter((r) => r.s.level !== 'ok');
  el.innerHTML = `
  <section class="hero">
    <div class="wrap hero-in">
      <div class="hero-txt">
        <p class="eyebrow">${esc(CONFIG.siteNameEn)}</p>
        <h1>島をむすぶ、<br>9つの路線。</h1>
        <p class="lead">早菜島軌道は、早菜中央を中心に島内${D.stations.length}駅・${D.lines.length}路線を結んでいます。毎日${D.trains.length.toLocaleString()}本の列車が走っています。</p>
        <form class="quick" id="qr">
          <div class="qrow">${stationInput('qfrom', '', '出発駅')}<button type="button" class="swap" id="qswap" aria-label="入れ替え">⇅</button>${stationInput('qto', '', '到着駅')}</div>
          <button class="btn primary">乗換案内を検索</button>
        </form>
      </div>
      <div class="hero-map card">
        <div class="card-h"><h2>路線図・走行中の列車</h2><a href="#/live" class="more">列車位置へ →</a></div>
        <div id="homemap">${networkMap({ trains: activeTrains(t.date, t.min), lineStatus: ls })}</div>
        <div class="maplegend"><span><i class="dot ltd"></i>特急</span><span><i class="dot rap"></i>快速</span><span><i class="dot exp"></i>急行</span><span><i class="dot sexp"></i>準急</span><span><i class="dot loc"></i>各停</span></div>
      </div>
    </div>
  </section>
  <div class="wrap">
    <section class="card status-card">
      <div class="card-h"><h2>運行情報</h2><span class="muted">${fmt(t.min)} 現在</span></div>
      ${trouble.length === 0 ? '<p class="allok">現在、全線で平常どおり運転しています。</p>' : ''}
      <ul class="status-list">${rows.map((r) => `
        <li class="st-${r.cls}"><a href="#/live/${r.l.id}">${lineBadge(r.l.id, true)}<span class="pill ${r.cls}">${r.label}</span></a>${r.detail ? `<p>${r.detail}</p>` : ''}</li>`).join('')}
      </ul>
    </section>
    <section class="tiles">
      <a class="tile" href="#/timetable"><span class="ic">🕒</span><b>駅時刻表</b><small>駅ごとの発車時刻と列車の停車駅</small></a>
      <a class="tile" href="#/route"><span class="ic">⇄</span><b>乗換案内</b><small>最短・最速の経路を検索</small></a>
      <a class="tile" href="#/reserve"><span class="ic">🎫</span><b>特急予約</b><small>全席指定の特急を座席指定で予約</small></a>
      <a class="tile" href="#/fleet"><span class="ic">🚃</span><b>車両・運用</b><small>今日どの編成がどの列車に入るか</small></a>
    </section>
    <section class="card">
      <div class="card-h"><h2>お知らせ</h2></div>
      <ul class="news">${(D.news || []).map((n) => `<li><time>${esc(n.date)}</time><span>${esc(n.title)}</span></li>`).join('') || '<li>お知らせはありません。</li>'}</ul>
    </section>
  </div>`;
  ensureStationDatalist();
  $('#qswap').onclick = () => { const a = $('#qfrom').value; $('#qfrom').value = $('#qto').value; $('#qto').value = a; };
  $('#qr').onsubmit = (e) => { e.preventDefault(); location.hash = `#/route?from=${encodeURIComponent($('#qfrom').value)}&to=${encodeURIComponent($('#qto').value)}`; };
  setTicker(() => {
    const t2 = now(); updateClock();
    const r2 = statusRows(t2.date, t2.min);
    $('#homemap').innerHTML = networkMap({ trains: activeTrains(t2.date, t2.min), lineStatus: Object.fromEntries(r2.map((r) => [r.l.id, r.s.level])) });
  });
}

function pageStatus(el) { location.hash = '#/'; }

// ---------------------------------------------------------------- live
function pageLive(el, lineId) {
  const L = +(lineId || 1);
  const l = lineOf(L);
  el.innerHTML = `
  <div class="wrap">
    <h1 class="ph">列車位置</h1>
    <div class="tabs linetabs">${D.lines.map((x) => `<a href="#/live/${x.id}" class="${x.id === L ? 'on' : ''}" style="--lc:${x.color}">${lineBadge(x.id)}<span>${esc(x.sub)}</span></a>`).join('')}</div>
    <div class="live-head">
      <div>${lineBadge(L, true)}</div>
      <div id="livestatus"></div>
    </div>
    <p class="muted small">左列が下り(${esc(lineTerminal(L, true))}方面)、右列が上り(${esc(lineTerminal(L, false))}方面)。列車をタップすると詳細を表示します。15秒ごとに更新します。</p>
    <div id="livebox" class="live"></div>
  </div>`;
  const draw = () => {
    const t = now(); updateClock();
    const st = lineStatus(L, t.date, t.min);
    const [label, cls] = LV[st.level];
    $('#livestatus').innerHTML = `<span class="pill ${cls}">${label}</span>`;
    const ROW = 44;
    const stations = l.stations;
    const incs = incidentsKnown(t.date, t.min).filter((i) => i.line === L && i.start <= t.min && t.min < i.end);
    const trains = activeTrains(t.date, t.min).filter((x) => x.p.L === L && !x.p.b);
    let h = `<div class="live-grid" style="height:${stations.length * ROW + 10}px">`;
    for (const i of incs) h += `<div class="live-inc" style="top:${i.a * ROW + 22}px;height:${(i.b - i.a) * ROW}px"><span>${esc(i.reason)}<br>見合わせ中</span></div>`;
    h += `<div class="live-rail" style="--lc:${l.color};height:${(stations.length - 1) * ROW}px"></div>`;
    stations.forEach((sid, i) => {
      const lines = D.stationLines[sid].filter((x) => x !== L);
      h += `<div class="live-st" style="top:${i * ROW}px"><span class="dot" style="--lc:${l.color}"></span><a href="#/timetable/${encodeURIComponent(stName(sid))}">${esc(stName(sid))}</a>${lines.map((x) => lineBadge(x)).join('')}</div>`;
    });
    // 同じ位置の列車をずらす
    const lanes = { 1: [], 0: [] };
    trains.sort((a, b) => a.p.idx - b.p.idx);
    for (const x of trains) {
      const y = x.p.idx * ROW + 11;
      const lane = lanes[x.p.dir];
      let off = 0; while (lane.some((o) => Math.abs(o.y - y) < 24 && o.off === off)) off++;
      lane.push({ y, off });
      const ops = trainOps(x.tr.n, t.date);
      h += `<a class="lt ${typeClass(x.tr.k)} d${x.p.dir}${x.ef.held ? ' held' : ''}${x.p.at != null ? ' atst' : ''}" href="#/train/${encodeURIComponent(x.tr.n)}" style="top:${y}px;--off:${off}">
        <b>${esc(x.tr.k.split('→')[0])}</b><span class="no">${esc(x.tr.n)}</span><span class="to">${esc(dest(x.tr))}</span>${ops.reduced ? '<em>減車</em>' : ''}${x.ef.delay >= 1 ? `<em>${x.ef.held ? '停車中' : Math.round(x.ef.delay) + '分遅れ'}</em>` : ''}</a>`;
    }
    h += `</div>`;
    $('#livebox').innerHTML = h + (trains.length ? '' : '<p class="muted center">現在この路線を走行中の列車はありません。</p>');
  };
  draw();
  setTicker(draw);
}

// ---------------------------------------------------------------- train detail
function pageTrain(el, n) {
  const tr = D.trainByN[n];
  if (!tr) { el.innerHTML = `<div class="wrap"><h1>列車が見つかりません</h1><p>列車番号「${esc(n)}」は存在しません。</p></div>`; return; }
  const draw = () => {
    const t = now();
    const ops = trainOps(tr.n, t.date);
    const sfm = seatFormation(tr.n, t.date);
    const ns = trainNowState(tr, t.date);
    const lines = [...new Set(tr.stops.map((s) => s.L))];
    let stateHtml = '';
    if (ns.status === 'cancel') stateHtml = `<div class="alert stop">この列車は本日、車両(編成)不足のため<b>運休</b>です。</div>`;
    else if (ns.status === 'held') stateHtml = `<div class="alert stop">${esc(ns.ef.eff.inc.reason)}のため運転を見合わせています(${Math.round(ns.ef.delay)}分経過)。</div>`;
    else if (ns.ef && ns.ef.delay >= 1) stateHtml = `<div class="alert delay">約${Math.round(ns.ef.delay)}分遅れで運転しています。</div>`;
    let cur = -1, curFrac = null;
    if (ns.p) { cur = ns.p.at ?? ns.p.from; if (ns.p.at == null) curFrac = true; }
    const done = ns.status === 'done';
    const delay = ns.ef?.delay || 0;
    const rows = tr.stops.map((s, i) => {
      const passed = done || (cur >= 0 && (i < cur || (i === cur && curFrac)));
      const here = cur === i && !curFrac;
      const between = cur === i && curFrac;
      const ex = delay >= 1 && !passed ? `<small class="late">→ ${fmt(s.d + delay)}</small>` : '';
      return `<li class="${passed ? 'passed' : ''}${here ? ' here' : ''}${s.op ? ' opstop' : ''}${s.b ? ' coupled' : ''}">
        <span class="tt">${i > 0 && s.a !== s.d ? `<small>${fmt(s.a)}着</small>` : ''}${i === tr.stops.length - 1 ? fmt(s.a) + '着' : fmt(s.d) + (i === 0 ? '発' : '')}${ex}</span>
        <span class="sd" style="--lc:${lineOf(s.L).color}"></span>
        <span><a href="#/timetable/${encodeURIComponent(stName(s.sid))}">${esc(stName(s.sid))}</a>${s.op ? ' <small class="muted">運転停車</small>' : ''}${s.th ? ' <small class="muted">(直通)</small>' : s.b ? ' <small class="muted">(併結)</small>' : ''}${here ? '<span class="nowtag">停車中</span>' : ''}</span>
      </li>${between ? '<li class="runningtag"><span>走行中 ▼</span></li>' : ''}`;
    }).join('');
    el.innerHTML = `
    <div class="wrap narrow">
      <p class="crumb"><a href="#/timetable">時刻表</a> › 列車詳細</p>
      <div class="train-h">
        ${typeBadge(tr.k, tr.fast)}
        <h1>${esc(tr.n)} <small>${esc(dest(tr))}行</small></h1>
        <div class="lines">${lines.map((x) => lineBadge(x, true)).join('')}</div>
      </div>
      ${stateHtml}
      <div class="grid2">
        <div class="card">
          <h3>停車駅</h3>
          <ul class="stops">${rows}</ul>
        </div>
        <div>
          <div class="card">
            <h3>列車情報</h3>
            <dl class="kv">
              <dt>区間</dt><dd>${esc(orig(tr))} ${fmt(tr.first)}発 → ${esc(dest(tr))} ${fmt(tr.last)}着</dd>
              <dt>両数</dt><dd>${ops.reduced ? `<b class="warn">${ops.cars}両(減車)</b> <small class="muted">通常 ${esc(tr.cars)}両</small>` : ops.cars ? `${ops.cars}両${String(ops.cars) !== String(tr.cars).split('→')[0] ? ` <small class="muted">(時刻表上 ${esc(tr.cars)}両)</small>` : ''}` : esc(tr.cars) + '両'}</dd>
              ${tr.kind === '特急' && sfm ? `<dt>車両</dt><dd>${esc(sfm.f.series)} ${esc(sfm.map?.nick || '')} <small class="muted">${esc(sfm.form)}</small></dd>` : ''}
              ${tr.partners.length ? `<dt>併結</dt><dd>${tr.partners.map((p) => D.trainByN[p] ? trainLink(D.trainByN[p]) + ` (${esc(dest(D.trainByN[p]))}行)` : esc(p)).join('、')}</dd>` : ''}
              ${tr.nx && D.trainByN[tr.nx] ? `<dt>直通</dt><dd>${esc(stName(tr.stops[Math.max(0, tr.stops.findIndex((x) => x.th) - 1)].sid))}から ${trainLink(D.trainByN[tr.nx])} に列車番号が変わります</dd>` : ''}
              ${tr.pv && D.trainByN[tr.pv] ? `<dt>直通</dt><dd>${esc(stName(tr.stops.filter((x) => x.th).at(-1).sid))}までは ${trainLink(D.trainByN[tr.pv])} として運転します</dd>` : ''}
              ${tr.note ? `<dt>備考</dt><dd>${esc(tr.note)}</dd>` : ''}
            </dl>
            ${tr.kind === '特急' && !isCancelled(tr.n, t.date) ? `<a class="btn primary block" href="#/reserve?train=${encodeURIComponent(tr.n)}">この特急を予約する</a>` : ''}
          </div>
          <div class="card">
            <h3>本日の運用・編成</h3>
            <table class="tbl"><thead><tr><th>運用</th><th>編成</th><th>車種</th></tr></thead><tbody>
            ${ops.list.map((o) => `<tr class="${o.form ? '' : 'cx'}"><td><a href="#/fleet/${o.op}">${o.op}</a></td><td>${o.form ? o.form.split('+').map((x) => `<a href="#/fleet/${encodeURIComponent(x)}">${esc(x)}</a>`).join('+') : '<b class="warn">未充当(運休)</b>'}</td><td>${esc(o.f ? o.f.series : OP_TYPE_NAME[o.op[0]])}${o.f && D.seatmaps[o.f.series] ? `<br><small class="muted">${esc(D.seatmaps[o.f.series].nick)}・${o.f.cars}両</small>` : ''}</td></tr>`).join('')}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>`;
  };
  draw();
  setTicker(draw, 20000);
}

// ---------------------------------------------------------------- boot
(async function boot() {
  if (location.protocol === 'file:') return; // index.html の案内を表示
  try {
    await loadAll();
  } catch (e) {
    app.innerHTML = `<div class="wrap"><p class="err">データの読み込みに失敗しました。ローカルで開く場合は簡易サーバー(例: <code>python3 -m http.server</code>)で表示してください。</p></div>`;
    return;
  }
  if (!CONFIG.gasUrl) $('#demo-note')?.removeAttribute('hidden');
  window.addEventListener('hashchange', render);
  render();
  setInterval(updateClock, 10000);
})();
