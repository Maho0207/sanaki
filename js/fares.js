// 運賃(お客さま向け): 運賃計算・ワンマン区間の運賃表とダウンロード
import { D, stName, findStation, fareFor, yomiOf } from './core.js';
import { esc, $, $$, lineBadge, ensureStationDatalist, stationInput, toast } from './ui.js';

// 全路線のキロ程による最短経路
let G = null;
function graph() {
  if (G) return G;
  G = new Map();
  for (const l of D.lines) {
    const km = D.lineKm[l.id];
    for (let i = 0; i + 1 < l.stations.length; i++) {
      const a = l.stations[i], b = l.stations[i + 1], d = Math.abs(km[i + 1] - km[i]);
      (G.get(a) || G.set(a, new Map()).get(a)).set(b, d);
      (G.get(b) || G.set(b, new Map()).get(b)).set(a, d);
    }
  }
  return G;
}
export function shortestKm(a, b) {
  const g = graph(); const dist = new Map([[a, 0]]); const done = new Set();
  for (;;) {
    let u = -1, best = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
    if (u < 0) return null;
    if (u === b) return Math.round(best * 10) / 10;
    done.add(u);
    for (const [v, w] of g.get(u) || []) if (best + w < (dist.get(v) ?? Infinity)) dist.set(v, best + w);
  }
}

export function onemanAreas() { return D.oneman?.areas || []; }
// ワンマン列車: 特急以外の2両編成で、ワンマン区間の駅に停まる列車
let OM = null;
export function isOneman(tr) {
  if (!OM) { OM = new Set(); for (const a of onemanAreas()) for (const s of a.stations) OM.add(D.stationId[s.name]); }
  if (tr.kind === '特急') return false;
  // 機関車けん引の客車列車(8号線 天連湖〜夜越温泉など)は車掌が乗務する
  if ((D.opsByTrain[tr.n] || []).some((id) => D.opById[id]?.type === 'L')) return false;
  if (String(tr.cars).split('→')[0].trim() !== '2') return false;
  return tr.stops.some((s) => !s.b && OM.has(s.sid));
}

export function csvOf(area) {
  const st = area.stations;
  const rows = [['乗車駅＼降車駅', ...st.map((s) => s.name)]];
  st.forEach((s, i) => rows.push([s.name, ...st.map((_, j) => (i === j ? '' : area.fares[i][j]))]));
  return '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const xlsxName = (area) => `運賃表_${area.name.split(' ')[0]}.xlsx`;

// 印刷用(三角表)
export function printTriangle(area, title) {
  const st = area.stations;
  let t = '<table class="tri">';
  st.forEach((s, i) => {
    t += '<tr>' + st.slice(0, i).map((_, j) => `<td>${area.fares[i][j].toLocaleString()}</td>`).join('') + `<th>${esc(s.name)}</th></tr>`;
  });
  t += '</table>';
  const w = window.open('', '_blank');
  if (!w) { toast('ポップアップがブロックされました', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:'Noto Sans JP',sans-serif;margin:12mm;color:#1d2733} h1{font-size:16px;margin:0 0 4px} p{font-size:10px;margin:2px 0}
    .tri{border-collapse:collapse;margin-top:8px} .tri td,.tri th{border:1px solid #aaa;font-size:8px;width:26px;height:20px;text-align:center;padding:0}
    .tri th{background:#0e2a47;color:#fff;font-size:7px;writing-mode:vertical-rl;height:52px;letter-spacing:-.5px} .tri tr:nth-child(even) td{background:#f5f3ee}
    .fic{color:#c92a2a} @page{size:A4 portrait;margin:8mm}</style></head><body>
    <h1>${esc(title)}</h1><p>対象区間: ${esc(area.sections.join(' / '))}。ワンマン列車をご利用の際は、乗車時に整理券をお取りください。</p>
    <p>見方: 乗車駅と降車駅から、それぞれ左・上へたどって交わるところが運賃(円・大人)です。</p>
    <p class="fic">※ 早菜島軌道は架空の鉄道です。この運賃表は創作物で、実際に運賃が請求されることはありません。</p>${t}
    <script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

export function pageFares(el, query) {
  const q = new URLSearchParams(query || '');
  const areas = onemanAreas();
  const sel = areas.find((a) => a.id === q.get('area')) || areas[0];
  el.innerHTML = `
  <div class="wrap">
    <h1 class="ph">運賃</h1>
    <div class="fiction small">早菜島軌道は架空の鉄道です。運賃・料金は創作物で、実際に請求されることはありません。</div>
    <form class="card search" id="ff">
      <h3>運賃を調べる</h3>
      <div class="rgrid">
        <label>乗車駅<span>${stationInput('ffrom', q.get('from') || '', '乗車駅')}</span></label>
        <button type="button" class="swap" id="fswap">⇄</button>
        <label>降車駅<span>${stationInput('fto', q.get('to') || '', '降車駅')}</span></label>
      </div>
      <div class="row"><button class="btn primary">計算</button><span id="fres"></span></div>
      <p class="small muted">運賃は乗車駅から降車駅までの最短経路の営業キロで計算します(1km未満切り上げ)。特急に乗る場合は別に特急料金が必要です。</p>
    </form>
    <section class="card">
      <div class="card-h"><h2>ワンマン運転区間の運賃表</h2></div>
      <p class="small">次の区間では一部の列車がワンマン運転です。<b>ワンマン列車では、乗車時に整理券をお取りいただき、降車時に運賃表示器の整理券番号の運賃を運賃箱にお支払いください</b>(無人駅・駅員不在の時間帯)。</p>
      <ul class="small">${areas.map((a) => `<li><b>${esc(a.name)}</b>: ${esc(a.sections.join('・'))}</li>`).join('')}</ul>
      <div class="tabs small">${areas.map((a) => `<a href="#/fares?area=${a.id}" class="${a === sel ? 'on' : ''}">${esc(a.name)}</a>`).join('')}</div>
      ${sel ? `
      <div class="dlrow">
        <a class="btn primary" href="downloads/${encodeURIComponent(xlsxName(sel))}" download>Excel(.xlsx)でダウンロード</a>
        <button class="btn" id="dlcsv">CSVでダウンロード</button>
        <button class="btn" id="dlprint">印刷・PDF保存</button>
      </div>
      <div class="row"><label class="small">乗車駅を選ぶと、各駅までの運賃を表示します: <select id="fboard" class="inp" style="max-width:220px">${sel.stations.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select></label></div>
      <div id="fboardres" class="farelist"></div>` : '<p class="muted">データがありません。</p>'}
    </section>
  </div>`;
  ensureStationDatalist();
  $('#fswap').onclick = () => { const a = $('#ffrom').value; $('#ffrom').value = $('#fto').value; $('#fto').value = a; };
  const calc = () => {
    const a = findStation($('#ffrom').value), b = findStation($('#fto').value);
    if (a < 0 || b < 0) { $('#fres').innerHTML = '<span class="err">駅名を確認してください</span>'; return; }
    const km = shortestKm(a, b);
    $('#fres').innerHTML = km == null ? '<span class="err">経路が見つかりません</span>' : `<b class="bigfare">${fareFor(km).toLocaleString()}円</b> <span class="muted">(${km.toFixed(1)}km・大人)</span>`;
  };
  $('#ff').onsubmit = (e) => { e.preventDefault(); calc(); };
  if (q.get('from') && q.get('to')) calc();
  if (!sel) return;
  const board = () => {
    const i = +$('#fboard').value; const st = sel.stations;
    $('#fboardres').innerHTML = `<table class="tbl"><thead><tr><th>降車駅</th><th>営業キロ</th><th>運賃</th><th>駅員</th></tr></thead><tbody>${st.map((s, j) => `<tr class="${i === j ? 'here' : ''}"><td>${esc(s.name)} <small class="muted">${esc(s.yomi)}</small></td><td class="tnum">${i === j ? '' : sel.km[i][j].toFixed(1) + 'km'}</td><td class="tnum"><b>${i === j ? '−' : sel.fares[i][j].toLocaleString() + '円'}</b></td><td class="small">${staffLabel(s)}</td></tr>`).join('')}</tbody></table>`;
  };
  $('#fboard').onchange = board; board();
  $('#dlcsv').onclick = () => download(`運賃表_${sel.name.split(' ')[0]}.csv`, csvOf(sel));
  $('#dlprint').onclick = () => printTriangle(sel, `早菜島軌道 ${sel.name} 運賃表`);
}
export function staffLabel(s) {
  const m = { '〇': '<span class="pill ok">有人</span>', '△': '<span class="pill delay">時間帯有人</span>', '×': '<span class="muted">無人</span>', '?': '<span class="muted">−</span>' };
  return (m[s.staff] || esc(s.staff)) + (s.staff === '△' && s.staffNote ? ` <small class="muted">${esc(s.staffNote)}</small>` : '');
}
