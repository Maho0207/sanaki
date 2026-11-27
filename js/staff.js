// 業務用: 整理券対照表・運賃表示器・ワンマン列車
import { CONFIG } from './config.js';
import { D, now, fmt, stName, weekday, isCancelled, trainOps } from './core.js';
import { esc, $, $$, typeBadge, dest, orig, toast } from './ui.js';
import { onemanAreas, isOneman, staffLabel, download, csvOf } from './fares.js';

// 「7:00~22:00のみ」「平日9:00~17:00」「土日初電~14:00」→ 今いるか
export function staffNow(s, date, min) {
  if (s.staff === '〇') return { on: true, text: '終日有人' };
  if (s.staff === '×') return { on: false, text: '終日無人' };
  if (s.staff !== '△') return { on: null, text: '情報なし' };
  const note = s.staffNote || '';
  const wd = weekday(date);
  if (/平日/.test(note) && /[土日]/.test(wd)) return { on: false, text: '本日は不在(平日のみ)' };
  if (/土日/.test(note) && !/[土日]/.test(wd)) return { on: false, text: '本日は不在(土日のみ)' };
  const m = /(初電|\d{1,2}:\d{2})\s*[~〜～\-]\s*(終電|\d{1,2}:\d{2})/.exec(note);
  if (!m) return { on: null, text: note };
  const hm = (x, def) => (/電/.test(x) ? def : +x.split(':')[0] * 60 + +x.split(':')[1]);
  const a = hm(m[1], 180), b = hm(m[2], 1620);
  const t = min % 1440;
  const on = t >= a && t < b;
  return { on, text: on ? `在中(〜${m[2]})` : `不在(${m[1]}〜${m[2]})` };
}

export function pageStaff(el, sub) {
  const code = CONFIG.staffPasscode || '';
  let ok = !code;
  try { ok ||= sessionStorage.getItem('sj.staff') === code; } catch {}
  if (!ok) {
    el.innerHTML = `<div class="wrap narrow"><h1 class="ph">業務用</h1><form class="card" id="sf"><p>業務用ページです。パスコードを入力してください。</p><div class="row"><input class="inp" type="password" id="sc" autocomplete="off"><button class="btn primary">表示</button></div><p class="small muted">※ 架空の鉄道の業務用ページ(創作物)です。静的サイトのため、パスコードは簡易的な目隠しです。</p></form></div>`;
    $('#sf').onsubmit = (e) => { e.preventDefault(); if ($('#sc').value === code) { try { sessionStorage.setItem('sj.staff', code); } catch {} pageStaff(el, sub); } else toast('パスコードが違います', 'err'); };
    return;
  }
  const areas = onemanAreas();
  const [aid, view] = (sub || '').split('/');
  const area = areas.find((a) => a.id === aid) || areas[0];
  const v = view || 'ticket';
  const t = now();
  el.innerHTML = `
  <div class="wrap staff">
    <div class="staffbar"><b>業務用</b> ワンマン運転区間 <span class="muted small">— 架空の鉄道の業務資料(創作物)です</span></div>
    <h1 class="ph">整理券・運賃 対照表</h1>
    <div class="tabs">${areas.map((a) => `<a href="#/staff/${a.id}/${v}" class="${a === area ? 'on' : ''}">${esc(a.name)}</a>`).join('')}</div>
    <div class="tabs small">${[['ticket', '整理券番号 対照表'], ['board', '運賃表示器'], ['trains', 'ワンマン列車(本日)']].map(([k, n]) => `<a href="#/staff/${area.id}/${k}" class="${k === v ? 'on' : ''}">${n}</a>`).join('')}
      <span class="spacer"></span><a class="btn small" href="downloads/${encodeURIComponent('整理券対照表_業務用.xlsx')}" download>業務用 Excel</a></div>
    ${area.missing?.length ? `<div class="alert delay small">整理券データに無い駅(${area.missing.map(esc).join('・')})は、続きの番号(${area.stations.find((s) => s.name === area.missing[0])?.no}〜)を仮に振り、駅員配置は「?」にしています。</div>` : ''}
    <div id="sv"></div>
  </div>`;
  const box = $('#sv');
  if (v === 'ticket') {
    box.innerHTML = `<div class="card"><p class="small muted">対象区間: ${esc(area.sections.join(' / '))}。駅員の在中状況は ${t.date}(${weekday(t.date)}) ${fmt(t.min)} 現在。</p>
      <table class="tbl"><thead><tr><th>整理券</th><th>乗車駅</th><th>読み</th><th>路線</th><th>キロ程</th><th>駅員</th><th>いま</th></tr></thead><tbody>
      ${area.stations.map((s) => { const n = staffNow(s, t.date, t.min); return `<tr><td class="tnum"><b class="ticketno">${s.no}</b></td><td>${esc(s.name)}</td><td class="small muted">${esc(s.yomi)}</td><td>${s.line}号線</td><td class="tnum">${s.km.toFixed(1)}</td><td>${staffLabel(s)}</td><td class="small">${n.on === true ? `<span class="ok-text">● ${esc(n.text)}</span>` : n.on === false ? `<span class="muted">○ ${esc(n.text)}</span>` : esc(n.text)}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  } else if (v === 'board') {
    box.innerHTML = `<div class="card"><div class="row"><label>降車駅(到着する駅): <select class="inp" id="bd" style="max-width:220px">${area.stations.map((s, i) => `<option value="${i}">${s.no} ${esc(s.name)}</option>`).join('')}</select></label>
      <button class="btn small" id="bcsv">全駅分をCSV</button></div>
      <div id="bdres"></div><p class="small muted">車内の運賃表示器と同じ並びです(整理券番号 → その駅で降りるときの運賃)。</p></div>`;
    const draw = () => {
      const i = +$('#bd').value; const st = area.stations;
      $('#bdres').innerHTML = `<div class="fareboard"><div class="fb-h">${esc(st[i].name)} までの運賃</div><div class="fb-grid">${st.map((s, j) => `<div class="fb-c${i === j ? ' self' : ''}"><span>${s.no}</span><b>${i === j ? '−' : area.fares[j][i].toLocaleString()}</b></div>`).join('')}</div></div>`;
    };
    $('#bd').onchange = draw; draw();
    $('#bcsv').onclick = () => {
      const st = area.stations;
      const rows = [['降車駅＼整理券', ...st.map((s) => s.no)], ...st.map((s, i) => [s.name, ...st.map((_, j) => (i === j ? '' : area.fares[j][i]))])];
      download(`運賃表示器_${area.name.split(' ')[0]}.csv`, '﻿' + rows.map((r) => r.join(',')).join('\r\n'));
    };
  } else {
    const set = new Set(area.stations.map((s) => D.stationId[s.name]));
    const list = D.trains.filter((tr) => isOneman(tr) && tr.stops.some((s) => !s.b && set.has(s.sid))).sort((a, b) => a.first - b.first);
    box.innerHTML = `<div class="card"><p class="small">特急以外の2両編成の列車をワンマン運転として扱っています(${list.length}本)。機関車けん引の客車列車は車掌が乗務するため含みません。</p>
      <table class="tbl"><thead><tr><th>発</th><th>列車</th><th>区間</th><th>着</th><th>編成</th><th></th></tr></thead><tbody>
      ${list.map((tr) => { const cx = isCancelled(tr.n, t.date); const ops = trainOps(tr.n, t.date); return `<tr class="${cx ? 'cx' : ''}"><td class="tnum">${fmt(tr.first)}</td><td>${typeBadge(tr.k)} <a href="#/train/${encodeURIComponent(tr.n)}">${esc(tr.n)}</a></td><td>${esc(orig(tr))} → ${esc(dest(tr))}</td><td class="tnum">${fmt(tr.last)}</td><td class="small">${ops.list.map((o) => o.form ? esc(o.form) : '<span class="warn">運休</span>').join('+')}</td><td>${cx ? '<span class="pill stop">運休</span>' : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
}
