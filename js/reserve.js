// 特急予約 (Google スプレッドシート + Apps Script で空席管理。未設定時はこの端末内のデモ保存)
import { CONFIG } from './config.js';
import { D, now, fmt, stName, findStation, addDays, weekday, limitedExpressBetween, fareFor, ltdFeeFor, legKm, isCancelled, trainOps, seatFormation, seatUnits, LS } from './core.js';
import { esc, $, $$, lineBadge, typeBadge, dest, ensureStationDatalist, stationInput, minutesLabel, toast } from './ui.js';

// ---------------------------------------------------------------- API
const api = {
  demo: !CONFIG.gasUrl,
  async get(params) {
    const r = await fetch(CONFIG.gasUrl + '?' + new URLSearchParams(params));
    return r.json();
  },
  async post(body) {
    const r = await fetch(CONFIG.gasUrl, { method: 'POST', body: JSON.stringify(body) });
    return r.json();
  },
  async booked(date) {
    if (this.demo) {
      const rows = LS.get('sj.rsv', []).filter((r) => r.date === date && r.state === '有効');
      return { ok: true, booked: rows.map((r) => [r.train, r.car, r.seat, r.fromIdx, r.toIdx]), stopped: LS.get('sj.stopped', []) };
    }
    return this.get({ action: 'booked', date });
  },
  async reserve(p) {
    if (this.demo) {
      const all = LS.get('sj.rsv', []);
      for (const s of p.seats) {
        if (all.some((r) => r.state === '有効' && r.date === p.date && r.train === p.train && r.car === s.car && r.seat === s.seat && r.fromIdx < p.toIdx && p.fromIdx < r.toIdx))
          return { ok: false, error: `${s.car}号車${s.seat}は既に予約されています` };
      }
      const code = genCode();
      const ts = new Date().toISOString();
      for (const s of p.seats) all.push({ code, ts, date: p.date, train: p.train, car: s.car, seat: s.seat, from: p.from, to: p.to, fromIdx: p.fromIdx, toIdx: p.toIdx, name: p.name, contact: p.contact, fare: s.price, kind: s.kind, persons: s.persons, state: '有効' });
      LS.set('sj.rsv', all);
      return { ok: true, code };
    }
    return this.post({ action: 'reserve', ...p });
  },
  async lookup(code, name) {
    if (this.demo) {
      const items = LS.get('sj.rsv', []).filter((r) => r.code === code.toUpperCase() && r.name === name);
      return items.length ? { ok: true, items } : { ok: false, error: '予約が見つかりません' };
    }
    return this.get({ action: 'lookup', code, name });
  },
  async cancel(code, name) {
    if (this.demo) {
      const all = LS.get('sj.rsv', []); let n = 0;
      for (const r of all) if (r.code === code.toUpperCase() && r.name === name && r.state === '有効') { r.state = '取消'; n++; }
      LS.set('sj.rsv', all);
      return n ? { ok: true, count: n } : { ok: false, error: '取り消せる予約がありません' };
    }
    return this.post({ action: 'cancel', code, name });
  },
};
function genCode() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = 'SJ'; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

// ---------------------------------------------------------------- page
export function pageReserve(el, sub, query) {
  if (sub === 'check') return pageCheck(el);
  const q = new URLSearchParams(query || '');
  const t = now();
  let date = q.get('date') || t.date;
  let trainN = q.get('train');
  if (trainN && D.trainByN[trainN]?.pv) trainN = D.trainByN[trainN].pv; // 直通列車は直通元の番号で予約
  let from = q.get('from') || '', to = q.get('to') || '';
  const preTr = trainN && D.trainByN[trainN];
  if (preTr && (!from || !to)) {
    const st = preTr.stops.filter((s) => !s.op);
    from ||= stName(st[0].sid); to ||= stName(st[st.length - 1].sid);
  }
  const dates = []; for (let i = 0; i <= CONFIG.reserveDaysAhead; i++) dates.push(addDays(t.date, i));
  if (!dates.includes(date)) date = t.date;
  el.innerHTML = `
  <div class="wrap">
    <div class="ph-row"><h1 class="ph">特急予約</h1><a class="btn" href="#/reserve/check">予約の確認・取消</a></div>
    <div class="fiction"><b>ご注意</b> 早菜島軌道は架空の鉄道です。この予約は遊びのためのもので、実際の列車・座席の予約ではなく、<b>料金が請求・決済されることは一切ありません</b>。表示される運賃・料金も架空のものです。</div>
    ${api.demo ? `<div class="alert info small"><b>デモモード</b>：予約用スプレッドシートが未設定のため、予約はこのブラウザ内にのみ保存されます。設定方法は README を参照してください。</div>` : ''}
    <p class="muted small">早菜島軌道の特急は全車指定席です。乗車日の${CONFIG.reserveDaysAhead}日前から発車時刻まで予約できます。</p>
    <form class="card search" id="vf">
      <div class="rgrid">
        <label>乗車駅<span>${stationInput('vfrom', from, '乗車駅')}</span></label>
        <button type="button" class="swap" id="vswap">⇄</button>
        <label>降車駅<span>${stationInput('vto', to, '降車駅')}</span></label>
      </div>
      <div class="rgrid2"><select id="vdate" class="inp">${dates.map((d, i) => `<option value="${d}" ${d === date ? 'selected' : ''}>${d.slice(5).replace('-', '/')}(${weekday(d)})${i === 0 ? ' 今日' : ''}</option>`).join('')}</select>
      <button class="btn primary">特急を検索</button></div>
    </form>
    <div id="vres"></div>
    <div id="vseat"></div>
  </div>`;
  ensureStationDatalist();
  $('#vswap').onclick = () => { const a = $('#vfrom').value; $('#vfrom').value = $('#vto').value; $('#vto').value = a; };
  $('#vf').onsubmit = (e) => {
    e.preventDefault();
    location.hash = '#/reserve?' + new URLSearchParams({ from: $('#vfrom').value.trim(), to: $('#vto').value.trim(), date: $('#vdate').value });
  };
  if (from && to) listTrains(from, to, date, trainN);
}

async function listTrains(fromName, toName, date, preselect) {
  const box = $('#vres');
  const from = findStation(fromName), to = findStation(toName);
  if (from < 0 || to < 0) { box.innerHTML = `<p class="err">駅名を確認してください。</p>`; return; }
  const list = limitedExpressBetween(from, to);
  if (!list.length) { box.innerHTML = `<div class="card"><p>${esc(fromName)}から${esc(toName)}へ直通する特急はありません。<a href="#/route?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}">乗換案内</a>で経路を確認してください。</p></div>`; return; }
  box.innerHTML = '<p class="muted">空席を確認しています…</p>';
  let bk;
  try { bk = await api.booked(date); if (!bk.ok) throw new Error(bk.error); }
  catch (e) { box.innerHTML = `<p class="err">空席情報を取得できませんでした (${esc(e.message)})</p>`; return; }
  const t = now();
  const rows = list.map((x) => {
    const cx = isCancelled(x.tr.n, date);
    const gone = date === t.date && x.d <= t.min;
    const stopped = (bk.stopped || []).includes(x.tr.n);
    const cap = capacity(x.tr, date) || 1;
    const sf = seatFormation(x.tr.n, date);
    const taken = takenSet(bk, x);
    const kinds = sf && sf.map ? kindStats(sf.map, taken) : {};
    const left = Object.values(kinds).reduce((a, k) => a + k.left, 0);
    const ratio = left / cap;
    const mark = cx ? ['運休', 'cx'] : gone ? ['発車済', 'cx'] : stopped ? ['販売停止', 'cx'] : left <= 0 ? ['満席', 'full'] : ratio < 0.1 ? ['残りわずか', 'few'] : ratio < 0.5 ? ['空席あり', 'some'] : ['空席多数', 'many'];
    return { ...x, sf, kinds, cx: cx || gone || stopped || left <= 0, mark, left };
  });
  const goneN = rows.filter((x) => x.mark[0] === '発車済').length;
  rows.splice(0, rows.length, ...rows.filter((x) => x.mark[0] !== '発車済'));
  if (!rows.length) { box.innerHTML = `<div class="card"><p>この日の予約できる特急は終了しました。</p></div>`; return; }
  box.innerHTML = (goneN ? `<p class="muted small">発車済みの${goneN}本は表示していません。</p>` : '') + `<div class="card"><table class="tbl rsv"><thead><tr><th>列車</th><th>発</th><th>着</th><th>所要</th><th>営業キロ</th><th>特急料金</th><th>車両</th><th>空席</th><th></th></tr></thead><tbody>
  ${rows.map((x, k) => `<tr class="${x.cx ? 'cx' : ''}"><td>${typeBadge(x.tr.k, x.tr.fast)} <a href="#/train/${encodeURIComponent(x.tr.n)}">${esc(x.tr.n)}</a><br><small class="muted">${esc(dest(x.tr))}行</small></td>
    <td class="tnum">${fmt(x.d)}</td><td class="tnum">${fmt(x.a)}</td><td>${minutesLabel(x.a - x.d)}</td><td>${legKm(x.tr, x.i, x.j).toFixed(1)}km</td><td>${ltdFeeFor(legKm(x.tr, x.i, x.j)).toLocaleString()}円</td>
    <td class="small">${x.sf && x.sf.map ? `${esc(x.sf.map.name)}<br><span class="muted">${esc(x.sf.map.nick)}</span>` : '-'}</td><td>${['運休', '発車済', '販売停止'].includes(x.mark[0]) ? `<span class="seatmark ${x.mark[1]}">${x.mark[0]}</span>` : kindChips(x.kinds)}</td><td>${x.cx ? '' : `<button class="btn small primary" data-k="${k}">座席を選ぶ</button>`}</td></tr>`).join('')}
  </tbody></table>
  <p class="legend small"><span>◎ 空席多数</span><span>○ 空席あり</span><span>△ 残りわずか</span><span>× 満席</span><span class="muted">(数字は残り席数・個室は残り室数。乗車区間での空き)</span></p></div>`;
  box.querySelectorAll('button[data-k]').forEach((b) => (b.onclick = () => seatPicker(rows[+b.dataset.k], date, bk)));
  const pre = rows.find((x) => x.tr.n === preselect && !x.cx);
  if (pre) seatPicker(pre, date, bk);
}

const KIND_ORDER = ['s', 'sp', 'v', 'r'];
function takenSet(bk, x) {
  return new Set(bk.booked.filter((b) => b[0] === x.tr.n && b[3] < x.j && x.i < b[4]).map((b) => `${b[1]}-${b[2]}`));
}
// 座席種別ごとの定員・残り {s:{cap,left}, sp:…, v:…, r:…}。car を指定するとその号車だけ
function kindStats(map, taken, carNo) {
  const out = {};
  for (const c of map.cars) {
    if (carNo != null && c.no !== carNo) continue;
    for (const row of c.grid) for (const cell of row) {
      if (!cell) continue;
      const k = cellKind(c, cell); const o = (out[k] ||= { cap: 0, left: 0 });
      o.cap++; if (!taken.has(`${c.no}-${cell.id}`)) o.left++;
    }
  }
  return out;
}
function availMark(o) {
  if (o.left <= 0) return ['×', 'full'];
  const r = o.left / o.cap;
  return r < 0.1 ? ['△', 'few'] : r < 0.5 ? ['○', 'some'] : ['◎', 'many'];
}
function kindChips(kinds) {
  const ks = KIND_ORDER.filter((k) => kinds[k]);
  if (!ks.length) return '<span class="muted">-</span>';
  return `<div class="kchips">${ks.map((k) => { const [m, c] = availMark(kinds[k]); return `<span class="kchip ${c}" title="${KIND[k]} 残り${kinds[k].left}/${kinds[k].cap}"><i class="seat k-${k}"></i>${KIND[k].replace('席', '')}<b>${m}</b><small>${kinds[k].left}</small></span>`; }).join('')}</div>`;
}

function capacity(tr, date) {
  const sf = seatFormation(tr.n, date);
  return sf && sf.map ? seatUnits(sf.map) : 0;
}

const KIND = { s: '普通席', sp: '特別席', v: '展望席', r: '個室' };
function cellKind(car, cell) { return cell.k === 'r' ? 'r' : cell.fee ? 'sp' : cell.view ? 'v' : 's'; }

function seatPicker(x, date, bk) {
  const box = $('#vseat');
  const sf = seatFormation(x.tr.n, date);
  if (!sf || !sf.map) { box.innerHTML = `<div class="card"><p class="err">この列車の座席配列が登録されていません(編成 ${esc(sf?.form || '-')}・形式 ${esc(sf?.f?.series || '-')})。</p></div>`; return; }
  const map = sf.map;
  const taken = takenSet(bk, x);
  const sel = new Map(); // key -> {car, seat, kind, cap, fee, persons}
  let car = map.cars[0].no;
  const km = legKm(x.tr, x.i, x.j);
  const ltd = ltdFeeFor(km);       // 特急料金(1人)
  const baseFare = fareFor(km);    // 運賃(1人)
  const priceOf = (s) => s.kind === 'r' ? ltd * s.persons + s.fee : ltd + (s.fee || 0);
  const carLabel = (c) => `${c.no}号車${c.special ? ' ★' : ''}`;
  const draw = () => {
    const c = map.cars.find((z) => z.no === car);
    const cols = Math.max(...c.grid.map((r) => r.length));
    let grid = '';
    for (const row of c.grid) {
      if (row.every((v) => !v)) { grid += `<div class="srow aisle-row" style="--cols:${cols}"></div>`; continue; }
      grid += `<div class="srow" style="--cols:${cols}">` + row.map((cell) => {
        if (!cell) return '<span class="sgap"></span>';
        const key = `${car}-${cell.id}`;
        const kd = cellKind(c, cell);
        const st = taken.has(key) ? 'taken' : sel.has(key) ? 'sel' : '';
        const obs = cell.id === '展望個室';
        const lab = obs ? `展望個室<small>${cell.cap}人用</small>` : cell.k === 'r' ? `${esc(cell.id.replace('個室', ''))}<small>${cell.cap}人</small>` : esc(cell.id);
        const tip = `${car}号車 ${cell.id} ${KIND[kd]}${cell.k === 'r' ? `(${cell.cap}人用・個室料金${cell.fee.toLocaleString()}円)` : cell.fee ? `(+${cell.fee}円)` : ''}`;
        return `<button type="button" class="seat k-${kd}${cell.pr ? ' prem' : ''}${obs ? ' obs' : ''} ${st}" data-key="${key}" ${st === 'taken' ? 'disabled' : ''} title="${esc(tip)}">${lab}</button>`;
      }).join('') + '</div>';
    }
    const items = [...sel.values()];
    const total = items.reduce((s, it) => s + priceOf(it), 0);
    const persons = items.reduce((s, it) => s + (it.kind === 'r' ? it.persons : 1), 0);
    box.innerHTML = `<section class="card seatcard" id="seatcard">
      <div class="card-h"><h2>${esc(x.tr.n)} 座席指定</h2><span class="muted">${date.slice(5).replace('-', '/')} ${esc(stName(x.tr.stops[x.i].sid))} ${fmt(x.d)} → ${esc(stName(x.tr.stops[x.j].sid))} ${fmt(x.a)}・${km.toFixed(1)}km</span></div>
      <p class="fleet-tag"><b>${esc(map.name)}</b> ${esc(map.nick)} <small class="muted">編成 ${esc(sf.form)}・${map.cars.length}両</small></p>
      <div class="kindsum small"><b>この区間の空席</b> ${kindChips(kindStats(map, taken))}</div>
      <div class="tabs small cartabs">${map.cars.map((z) => { const ks = kindStats(map, taken, z.no); return `<a href="javascript:void 0" data-car="${z.no}" class="${z.no === car ? 'on' : ''}">${carLabel(z)}<small>${esc(z.label)}</small><small class="carleft">${KIND_ORDER.filter((k) => ks[k]).map((k) => `${KIND[k].replace('席', '')}${ks[k].left}`).join('・')}</small></a>`; }).join('')}</div>
      <div class="car-info small"><b>${c.no}号車</b> ${esc(c.label)}${c.special ? ` <span class="pill sp">特別席 +${c.fee}円</span>` : ''}${c.notes.map((n) => ` <span class="muted">${esc(n)}</span>`).join('')}</div>
      <div class="cabin-scroll"><div class="cabin h">${grid}</div></div>
      <div class="seatlegend small"><span><i class="seat k-s"></i>普通席</span><span><i class="seat k-sp"></i>特別席(+料金)</span><span><i class="seat k-v"></i>展望席</span><span><i class="seat k-r"></i>個室</span><span><i class="seat sel"></i>選択中</span><span><i class="seat taken"></i>予約済</span></div>
      <form id="rsvform" class="rsvform">
        <div class="sum">${items.length ? `<table class="tbl"><tbody>${items.map((it) => `<tr><td>${it.car}号車 ${esc(it.seat)}</td><td>${KIND[it.kind]}${it.kind === 'r' ? ` <select class="inp sm" data-persons="${it.car}-${esc(it.seat)}">${Array.from({ length: it.cap }, (_, i) => `<option ${i + 1 === it.persons ? 'selected' : ''} value="${i + 1}">${i + 1}人</option>`).join('')}</select>` : ''}</td>
            <td class="tnum">${priceOf(it).toLocaleString()}円<br><small class="muted">${it.kind === 'r' ? `特急${ltd.toLocaleString()}×${it.persons} + 個室${it.fee.toLocaleString()}` : `特急${ltd.toLocaleString()}${it.fee ? ` + 特別席${it.fee}` : ''}`}</small></td></tr>`).join('')}</tbody></table>
          <p><b>特急券 合計 ${total.toLocaleString()}円</b>(${persons}人)<br><small class="muted">別途、乗車券(運賃 ${baseFare.toLocaleString()}円/人)が必要です。</small></p>` : '座席・個室をタップして選んでください。'}</div>
        <label>予約名(16文字まで・ニックネーム可) <span class="muted" id="rcount">0/16</span><input class="inp" id="rname" required placeholder="例: さなじま太郎 / Sana" autocomplete="off"></label>
        <label>連絡先(電話番号またはメール・任意)<input class="inp" id="rcontact" placeholder="任意"></label>
        <p class="small muted">※ 架空の予約です。お支払いは発生しません。個人情報(本名・実在の連絡先)の入力は不要です。</p>
        <button class="btn primary" ${items.length ? '' : 'disabled'}>予約を確定する</button>
      </form>
    </section>`;
    const keep = () => { const a = $('#rname')?.value, b = $('#rcontact')?.value; return () => { $('#rname').value = a || ''; $('#rcontact').value = b || ''; $('#rname').oninput(); }; };
    const nm = $('#rname');
    nm.oninput = () => { const ch = [...nm.value]; if (ch.length > 16) nm.value = ch.slice(0, 16).join(''); $('#rcount').textContent = `${[...nm.value].length}/16`; };
    box.querySelectorAll('[data-car]').forEach((a) => (a.onclick = () => { const r = keep(); car = +a.dataset.car; draw(); r(); }));
    box.querySelectorAll('[data-persons]').forEach((s) => (s.onchange = () => { const r = keep(); sel.get(s.dataset.persons).persons = +s.value; draw(); r(); }));
    box.querySelectorAll('.cabin .seat[data-key]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.key;
      const r = keep();
      if (sel.has(k)) sel.delete(k);
      else if (sel.size >= CONFIG.maxSeatsPerReservation) { toast(`一度に予約できるのは${CONFIG.maxSeatsPerReservation}席(室)までです`); return; }
      else {
        const [cn, id] = [+k.split('-')[0], k.slice(k.indexOf('-') + 1)];
        const cc = map.cars.find((z) => z.no === cn); const cell = cc.grid.flat().find((v) => v && v.id === id);
        const kind = cellKind(cc, cell);
        sel.set(k, { car: cn, seat: id, kind, cap: cell.cap || 1, fee: cell.fee || 0, persons: kind === 'r' ? cell.cap : 1 });
      }
      draw(); r();
    }));
    $('#rsvform').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button.primary'); btn.disabled = true; btn.textContent = '送信中…';
      const seats = [...sel.values()].map((it) => ({ car: it.car, seat: it.seat, kind: KIND[it.kind], persons: it.persons, price: priceOf(it) }));
      const payload = { date, train: x.tr.n, from: stName(x.tr.stops[x.i].sid), to: stName(x.tr.stops[x.j].sid), fromIdx: x.i, toIdx: x.j,
        dep: fmt(x.d), arr: fmt(x.a), km, baseFare, ltd, series: `${map.name} ${map.nick}`, form: sf.form, seats,
        name: [...$('#rname').value.trim()].slice(0, 16).join(''), contact: $('#rcontact').value.trim(), fare: seats.reduce((s, it) => s + it.price, 0) };
      try {
        const r = await api.reserve(payload);
        if (!r.ok) throw new Error(r.error || '予約に失敗しました');
        done(payload, r.code);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = '予約を確定する'; }
    };
  };
  draw();
  $('#seatcard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function done(p, code) {
  $('#vres').innerHTML = '';
  const persons = p.seats.reduce((s, it) => s + it.persons, 0);
  $('#vseat').innerHTML = `<section class="card ticket">
    <p class="eyebrow">予約が完了しました</p>
    <div class="tk">
      <div class="tk-l"><span class="tk-mihon">見本・架空</span><small>予約番号</small><b class="code">${esc(code)}</b><small>${esc(p.name)} 様</small></div>
      <div class="tk-r">
        <div class="tk-train">${esc(p.train)} <small class="muted">${esc(p.series)}</small></div>
        <div class="tk-route"><b>${esc(p.from)}</b><span>${esc(p.dep)}発</span> → <b>${esc(p.to)}</b><span>${esc(p.arr)}着</span></div>
        <div>${p.date.replace(/-/g, '/')}(${weekday(p.date)}) ・ ${p.seats.map((s) => `${s.car}号車 ${esc(s.seat)}(${s.kind}${s.kind === '個室' ? `・${s.persons}人` : ''})`).join('、')}</div>
        <div>特急券 ${p.fare.toLocaleString()}円 <small class="muted">(${persons}人・${p.km.toFixed(1)}km)</small></div>
        <div class="small muted">乗車券(運賃 ${p.baseFare.toLocaleString()}円/人)は別途お求めください。</div>
      </div>
    </div>
    <p class="small muted">予約番号と予約名で、<a href="#/reserve/check">予約の確認・取消</a>ができます。予約番号を控えてください。</p>
    <p class="fiction small">これは架空の鉄道の予約票です。実際の乗車券・特急券としては使えず、表示の金額が請求されることはありません。</p>
  </section>`;
}

function pageCheck(el) {
  el.innerHTML = `
  <div class="wrap narrow">
    <p class="crumb"><a href="#/reserve">特急予約</a> › 予約の確認・取消</p>
    <h1 class="ph">予約の確認・取消</h1>
    <div class="fiction small">架空の鉄道の予約です。料金の請求・返金は発生しません。</div>
    <form class="card" id="ckf"><div class="row"><input class="inp" id="ccode" placeholder="予約番号 (SJ…)" required><input class="inp" id="cname" placeholder="予約名" required><button class="btn primary">確認</button></div></form>
    <div id="ckres"></div>
  </div>`;
  $('#ckf').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#ccode').value.trim().toUpperCase(), name = $('#cname').value.trim();
    const box = $('#ckres'); box.innerHTML = '<p class="muted">確認中…</p>';
    try {
      const r = await api.lookup(code, name);
      if (!r.ok) throw new Error(r.error);
      const it = r.items; const a = it[0];
      const active = it.some((x) => x.state === '有効');
      box.innerHTML = `<div class="card"><dl class="kv">
        <dt>予約番号</dt><dd><b>${esc(a.code)}</b> ${active ? '<span class="pill ok">有効</span>' : '<span class="pill stop">取消済</span>'}</dd>
        <dt>乗車日</dt><dd>${esc(a.date)}</dd><dt>列車</dt><dd>${esc(a.train)}</dd>
        <dt>区間</dt><dd>${esc(a.from)} → ${esc(a.to)}</dd>
        <dt>座席</dt><dd>${it.map((x) => `${x.car}号車 ${esc(x.seat)}${x.kind ? `(${esc(x.kind)}${x.kind === '個室' ? '・' + x.persons + '人' : ''})` : ''}`).join('、')}</dd></dl>
        ${active ? '<button class="btn danger" id="cbtn">この予約を取り消す</button>' : ''}</div>`;
      const cb = $('#cbtn');
      if (cb) cb.onclick = async () => {
        if (!confirm('予約を取り消します。よろしいですか?')) return;
        const c = await api.cancel(code, name);
        if (c.ok) { toast('予約を取り消しました'); $('#ckf').requestSubmit(); } else toast(c.error, 'err');
      };
    } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  };
}
