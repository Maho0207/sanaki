// 共通UI部品
import { D, stName, fmt, typeClass, baseType, lineOf, posAt } from './core.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function lineBadge(L, withName = false) {
  const l = lineOf(L);
  return `<span class="lb" style="--lc:${l.color}">${l.id}</span>${withName ? `<span class="lb-name">${esc(l.name)} <small>${esc(l.sub)}</small></span>` : ''}`;
}
export function typeBadge(k, fast) {
  const b = baseType(k);
  return `<span class="tb ${typeClass(k)}">${esc(k.includes('→') ? k : b)}${fast ? '<i>最速達</i>' : ''}</span>`;
}
export function trainLink(tr, label) {
  return `<a class="trn" href="#/train/${encodeURIComponent(tr.n)}">${esc(label || tr.n)}</a>`;
}
export const dest = (tr) => stName(tr.stops[tr.stops.length - 1].sid);
export const orig = (tr) => stName(tr.stops[0].sid);

export function stationInput(id, value = '', placeholder = '駅名') {
  return `<input id="${id}" class="inp" list="stlist" value="${esc(value)}" placeholder="${placeholder}" autocomplete="off">`;
}
export function ensureStationDatalist() {
  if (document.getElementById('stlist')) return;
  const dl = document.createElement('datalist'); dl.id = 'stlist';
  dl.innerHTML = [...D.stations].sort((a, b) => a.localeCompare(b, 'ja')).map((s) => `<option value="${esc(s)}">`).join('');
  document.body.appendChild(dl);
}

export function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
}

// ---------------------------------------------------------------- 路線図
const ANCHORS = {
  1: [['浜川', 80, 330], ['早菜中央', 430, 330], ['松島街道', 430, 200], ['松野木宿', 430, 120], ['赤窪', 430, 40]],
  2: [['浅山早菜口', 230, 560], ['早菜中央', 430, 330], ['増森', 610, 330], ['エアロシティ', 800, 330], ['清水峡', 800, 500], ['端浜', 800, 610]],
  3: [['増森', 610, 330], ['莉里島', 610, 255], ['桜川口', 610, 190], ['雲平', 610, 40]],
  4: [['桜川口', 610, 190], ['桜湖', 700, 190], ['菜川', 950, 190]],
  5: [['エアロシティ', 800, 330], ['早菜空港', 950, 330]],
  6: [['松島街道', 430, 200], ['天連町', 250, 200], ['西早菜岬', 60, 200]],
  7: [['早菜中央', 430, 330], ['金岸海岸', 540, 440], ['楯山町', 540, 615]],
  8: [['天連町', 250, 200], ['天連湖', 250, 90], ['夜越温泉', 250, 40]],
  9: [['金岸海岸', 540, 440], ['坂志港', 610, 470], ['西部町', 650, 540], ['紗穂中央', 690, 600], ['澪浜', 745, 575], ['清水峡', 800, 500]],
};
const LABEL_POS = { // 'r' | 'l' | 't' | 'b'
  '浜川': 't', '早菜中央': 'bl', '松島街道': 'r', '赤窪': 'r', '浅山早菜口': 'b', '増森': 'b', 'エアロシティ': 'tr', '清水峡': 'r', '端浜': 'r',
  '桜川口': 'l', '雲平': 'r', '菜川': 't', '早菜空港': 't', '天連町': 'b', '西早菜岬': 't', '金岸海岸': 'l', '楯山町': 'r', '夜越温泉': 'r',
  '莉里島': 'l', '桜湖': 't', '松野木宿': 'r', '天連湖': 'r', '坂志港': 'tr', '西部町': 'l', '紗穂中央': 'b', '澪浜': 'b',
};
let GEO = null;
export function mapGeometry() {
  if (GEO) return GEO;
  const pos = {}; // line -> idx -> [x,y]
  for (const l of D.lines) {
    const an = ANCHORS[l.id]; const st = l.stations; const idx = D.lineIdx[l.id];
    const pts = new Array(st.length);
    for (let k = 0; k + 1 < an.length; k++) {
      const i0 = idx.get(D.stationId[an[k][0]]), i1 = idx.get(D.stationId[an[k + 1][0]]);
      for (let i = i0; i <= i1; i++) {
        const f = (i - i0) / (i1 - i0 || 1);
        pts[i] = [an[k][1] + (an[k + 1][1] - an[k][1]) * f, an[k][2] + (an[k + 1][2] - an[k][2]) * f];
      }
    }
    pos[l.id] = pts;
  }
  GEO = { pos };
  return GEO;
}
export function mapXY(L, fidx) {
  const p = mapGeometry().pos[L]; const i = Math.floor(fidx); const f = fidx - i;
  const a = p[Math.max(0, Math.min(p.length - 1, i))], b = p[Math.min(p.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
export function networkMap({ trains = [], lineStatus = {} } = {}) {
  const g = mapGeometry();
  let s = `<svg class="netmap" viewBox="0 0 1010 650" role="img" aria-label="早菜島軌道 路線図">`;
  s += `<defs><pattern id="sea" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 7 Q3.5 4 7 7 T14 7" fill="none" stroke="currentColor" stroke-opacity=".07"/></pattern></defs>`;
  s += `<rect x="0" y="0" width="1010" height="650" fill="url(#sea)"/>`;
  s += `<path class="island" d="M40 170 Q60 20 250 20 L460 15 Q640 10 700 30 Q980 60 985 200 Q990 330 960 360 Q860 380 840 450 Q850 640 760 635 Q600 645 520 635 Q470 635 420 600 Q300 600 210 590 Q120 560 120 450 Q60 400 50 330 Q30 250 40 170Z"/>`;
  for (const l of D.lines) {
    const pts = g.pos[l.id];
    const st = lineStatus[l.id];
    s += `<a href="#/live/${l.id}"><polyline class="ml${st && st !== 'ok' ? ' ml-' + st : ''}" points="${pts.map((p) => p.join(',')).join(' ')}" style="--lc:${l.color}"><title>${l.name} ${l.sub}</title></polyline></a>`;
  }
  const done = new Set();
  for (const l of D.lines) {
    l.stations.forEach((sid, i) => {
      const [x, y] = g.pos[l.id][i]; const name = stName(sid);
      const jn = D.stationLines[sid].length > 1;
      if (jn && done.has(sid)) return; done.add(sid);
      s += `<a href="#/timetable/${encodeURIComponent(name)}"><circle class="${jn ? 'mj' : 'ms'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${jn ? 6.5 : 2.2}" style="--lc:${l.color}"><title>${esc(name)}</title></circle></a>`;
      const lp = LABEL_POS[name];
      if (lp) {
        let dx = 10, dy = 4, anc = 'start';
        if (lp.includes('l')) { dx = -10; anc = 'end'; }
        if (lp === 't') { dx = 0; dy = -12; anc = 'middle'; } else if (lp === 'b') { dx = 0; dy = 20; anc = 'middle'; }
        else if (lp === 'tr') { dy = -10; } else if (lp === 'bl') { dy = 20; }
        s += `<text class="mlabel${jn ? ' mlj' : ''}" x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anc}">${esc(name)}</text>`;
      }
    });
  }
  for (const { tr, p, ef } of trains) {
    if (p.b) continue;
    const [x, y] = mapXY(p.L, p.idx);
    s += `<a href="#/train/${encodeURIComponent(tr.n)}"><circle class="mt ${typeClass(tr.k)}${ef.held ? ' held' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${esc(tr.n)} ${esc(tr.k)} ${esc(dest(tr))}行</title></circle></a>`;
  }
  // line number badges
  const badgePos = { 1: [80, 330], 2: [230, 560], 3: [610, 40], 4: [950, 190], 5: [950, 330], 6: [60, 200], 7: [540, 615], 8: [250, 40], 9: [650, 540] };
  for (const l of D.lines) {
    const [x, y] = badgePos[l.id];
    const off = { 1: [-22, 0], 2: [-22, -14], 3: [-22, 0], 4: [22, 0], 5: [22, 0], 6: [0, 22], 7: [-22, 0], 8: [-22, 0], 9: [22, 0] }[l.id];
    s += `<g class="mbadge"><rect x="${x + off[0] - 11}" y="${y + off[1] - 11}" width="22" height="22" rx="5" fill="${l.color}"/><text x="${x + off[0]}" y="${y + off[1] + 5}" text-anchor="middle">${l.id}</text></g>`;
  }
  s += `</svg>`;
  return s;
}

export function minutesLabel(m) { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`; }
export { fmt };
