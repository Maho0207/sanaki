// 車両・運用
import { D, now, fmt, assignment, formations, isActiveFormation, OP_TYPE_NAME, parseHM, isCancelled, trainNowState, typeClass, withdrawals, nextInspection, rotations, rotationMode, opEnds, formationSchedule, addDays } from './core.js';
import { esc, $, $$, typeBadge } from './ui.js';
import { setTicker } from './app.js';

function opTimes(o) {
  const first = o.legs[0], last = o.legs[o.legs.length - 1];
  return { out: first[2], outT: first[3], in: last[4], inT: last[5] };
}
function legMin(s, prev) { let v = parseHM(s); if (prev != null) while (v < prev - 720) v += 1440; return v; }
function opNow(o, nowMin) {
  let prev = null;
  for (const leg of o.legs) {
    const d = legMin(leg[3], prev), a = legMin(leg[5], d); prev = a;
    if (nowMin < d) return { state: 'wait', leg, at: leg[2], next: d };
    if (nowMin <= a) return { state: 'run', leg };
  }
  return { state: 'done' };
}

export function pageFleet(el, id, query) {
  if (id && D.opById[id]) return opDetail(el, id);
  if (id) return formDetail(el, id);
  const q = new URLSearchParams(query || '');
  if (q.get('view') === 'rot') return rotationView(el);
  const type = q.get('type') || 'T';
  const t = now();
  const asg = assignment(t.date);
  const forms = formations();
  const summary = ['T', 'B', 'C', 'L'].map((ty) => {
    const ops = D.ops.filter((o) => o.type === ty);
    const fs = forms.filter((f) => f.type === ty);
    const wd = withdrawals(t.date);
    const act = fs.filter((f) => isActiveFormation(f) && !wd[f.id]);
    const out = fs.filter((f) => wd[f.id]).length;
    const short = ops.filter((o) => !asg.opForm[o.id]).length;
    return { ty, ops: ops.length, fs: fs.length, act: act.length, short, out };
  });
  const cxCount = D.trains.filter((tr) => isCancelled(tr.n, t.date)).length;
  el.innerHTML = `
  <div class="wrap">
    <h1 class="ph">車両・運用</h1>
    <p class="muted small">「運用」は1日の中で1つの編成が受け持つ列車の組み合わせです。登録された編成を毎日入れ替えながら各運用に充当します。編成が足りない運用の列車は運休になります。</p>
    <div class="sumgrid">${summary.map((s) => `<a class="card sum ${s.short ? 'bad' : ''}" href="#/fleet?type=${s.ty}"><b>${OP_TYPE_NAME[s.ty]}</b>
      <div class="big">${s.ops - s.short}<small>/${s.ops} 運用</small></div>
      <small>在籍 ${s.fs}編成・使用可 ${s.act}編成${s.out ? `・<b class="warn">離脱 ${s.out}</b>` : ''}</small>${s.ty === 'B' && asg.doubled ? `<small>うち ${asg.doubled}運用は2両編成×2で代走</small>` : ''}${s.short ? `<span class="pill stop">${s.short}運用 不足</span>` : '<span class="pill ok">充足</span>'}</a>`).join('')}</div>
    ${rotBanner(asg)}
    ${cxCount ? `<div class="alert stop">本日は${rotationMode() ? 'ローテーション外の運用・' : ''}編成不足のため <b>${cxCount}本</b> の列車が運休です。</div>` : ''}
    ${wdTable(t.date, forms)}
    <div class="card">
      <div class="card-h"><div class="tabs small">${['T', 'B', 'C', 'L'].map((ty) => `<a href="#/fleet?type=${ty}" class="${ty === type ? 'on' : ''}">${OP_TYPE_NAME[ty]}</a>`).join('')}<a href="#/fleet?view=rot">ローテーション</a></div>
        <input id="fq" class="inp" placeholder="運用番号・編成番号で絞り込み" style="max-width:260px"></div>
      <div id="optable"></div>
    </div>
  </div>`;
  const draw = () => {
    const t2 = now(); const f = ($('#fq').value || '').trim().toUpperCase();
    const ops = D.ops.filter((o) => o.type === type && (!f || o.id.includes(f) || String(asg.opForm[o.id] || '').toUpperCase().includes(f)));
    $('#optable').innerHTML = `<table class="tbl ops"><thead><tr><th>運用</th><th>編成</th><th>出庫</th><th>入庫</th><th>現在</th></tr></thead><tbody>${ops.map((o) => {
      const tm = opTimes(o); const form = asg.opForm[o.id]; const st = opNow(o, t2.min);
      let cur = '';
      if (!form) cur = '<span class="pill stop">運休</span>';
      else if (st.state === 'run') cur = `<a href="#/train/${encodeURIComponent(st.leg[0].split('→')[0])}">${esc(st.leg[0])}</a> <small class="muted">${esc(st.leg[2])}→${esc(st.leg[4])}</small>`;
      else if (st.state === 'wait') cur = `<small class="muted">${esc(st.at)}で待機 (${fmt(st.next)}発)</small>`;
      else cur = '<small class="muted">入庫済</small>';
      return `<tr class="${form ? '' : 'cx'}"><td><a href="#/fleet/${o.id}">${o.id}</a></td><td>${form ? form.split('+').map((x) => `<a href="#/fleet/${encodeURIComponent(x)}">${esc(x)}</a>`).join('+') + (form.includes('+') ? ' <small class="pill partial">2両×2</small>' : '') : '<b class="warn">未充当</b>'}</td><td>${esc(tm.out)} ${esc(tm.outT)}</td><td>${esc(tm.in)} ${esc(tm.inT)}</td><td>${cur}</td></tr>`;
    }).join('')}</tbody></table>`;
  };
  $('#fq').oninput = draw;
  draw();
  setTicker(draw, 30000);
}

const WD_CLASS = { inspection: 'partial', overhaul: 'delay', accident: 'stop' };
function wdTable(date, forms) {
  const wd = withdrawals(date);
  const list = forms.filter((f) => wd[f.id]).map((f) => ({ f, w: wd[f.id] }))
    .sort((a, b) => ['accident', 'overhaul', 'inspection'].indexOf(a.w.kind) - ['accident', 'overhaul', 'inspection'].indexOf(b.w.kind) || a.w.to.localeCompare(b.w.to));
  if (!list.length) return '';
  return `<details class="card" ${list.some((x) => x.w.kind === 'accident') ? 'open' : ''}><summary><b>本日の離脱車両 ${list.length}編成</b> <small class="muted">(検査・事故などで運用から外れている編成。予備編成で補えない分は運休)</small></summary>
    <table class="tbl"><thead><tr><th>編成</th><th>形式</th><th>製造年</th><th>種別</th><th>理由</th><th>期間</th></tr></thead><tbody>${list.map(({ f, w }) => `<tr>
      <td><a href="#/fleet/${encodeURIComponent(f.id)}">${esc(f.id)}</a></td><td>${esc(f.series)}</td><td>${f.built || '-'}</td>
      <td><span class="pill ${WD_CLASS[w.kind]}">${esc(w.name)}</span></td><td class="small">${esc(w.reason)}</td><td class="small">${w.from.slice(5).replace('-', '/')}〜${w.to.slice(5).replace('-', '/')}</td></tr>`).join('')}</tbody></table></details>`;
}

function rotBanner(asg) {
  const R = rotations();
  if (!rotationMode() && R.invalid.length) return `<div class="alert stop small"><b>ローテーションがすべて無効です</b>(回送の抜けなど)。<a href="#/fleet?view=rot">詳しく見る</a> — 有効なローテーションが無いため、全編成を自動で割り当てています。</div>`;
  if (!rotationMode()) return `<div class="card small"><b>運用の割り当て:</b> 自動(<code>data/rotations.txt</code> にローテーションが無いため、在籍編成を毎日入れ替えて充当)。<a href="#/fleet?view=rot">ローテーションについて</a></div>`;
  const inRot = new Set(R.rotations.flatMap((r) => r.ops));
  const out = D.ops.filter((o) => !inRot.has(o.id)).length;
  return `<div class="card small"><b>運用の割り当て:</b> ローテーション(${R.rotations.length}本・${inRot.size}運用)。ローテーション外の <b class="warn">${out}運用は運休</b>。 <a href="#/fleet?view=rot">ローテーションを見る →</a>${R.invalid.length ? ` <span class="pill stop">無効なローテーション ${R.invalid.length}</span>` : ''}</div>`;
}

function stepsHtml(r) {
  return r.steps.map((x) => x.deadhead ? `<span class="dhchip" title="回送">回送${x.from ? `<small>${esc(x.from)}〜${esc(x.to)}</small>` : ''}</span>` : D.opById[x.op] ? `<a href="#/fleet/${x.op}" class="opchip">${x.op}</a>` : `<span class="opchip bad">${esc(x.op)}</span>`).join('<span class="arr">→</span>');
}
function rotationView(el) {
  const t = now(); const tm = addDays(t.date, 1);
  const asg = assignment(t.date); const asg2 = assignment(tm);
  const R = rotations(); const forms = formations(); const wd = withdrawals(t.date);
  const inRot = new Set(R.rotations.flatMap((r) => r.ops));
  const byDepot = {};
  for (const r of R.rotations) (byDepot[r.depot] ||= []).push(r);
  const at = (a, r, day) => Object.keys(a.formRot || {}).find((id) => a.formRot[id].rot === r && a.formRot[id].day === day);
  const fl = (id) => id ? `<a href="#/fleet/${encodeURIComponent(id)}">${esc(id)}</a>` : '<span class="warn">なし</span>';
  el.innerHTML = `<div class="wrap">
    <p class="crumb"><a href="#/fleet">車両・運用</a> › ローテーション</p>
    <h1 class="ph">運用ローテーション</h1>
    <div class="card small">
      <p>ローテーションは <code>data/rotations.txt</code> に1行1本で書きます(GitHub にアップロード)。各編成は1日ごとに矢印の順に次の運用へ進みます。</p>
      <pre class="code">車庫名,ローテーション\n桜湖,T019→T036→T043→T057\n桜湖,T016→T052→回送→T021</pre>
      <ul><li><b>ローテーションを最後まで終えた編成は、翌日、同じ車庫・同じ車種のどのローテーションの1日目に入るかをランダムで決めます</b>(車庫の予備編成も候補に入ります)。</li>
      <li>前日の運用の終了駅と翌日の運用の起点駅が違うところには <code>回送</code> を入れてください。回送が無いとそのローテーションは<b>無効</b>になり、その運用は運休です。区間を書く場合は <code>回送(桜湖〜東越藤川)</code>。</li>
      <li>編成の「所属車庫」が車庫名と同じ編成が使われます。<b>どのローテーションにも入っていない運用は運休</b>です。ローテーションが1本も無いときは全編成を自動で割り当てます。</li></ul>
    </div>
    ${R.invalid.length ? `<div class="alert stop"><b>無効なローテーション(運用は運休)</b>${R.invalid.map((r) => `<div class="rot"><div class="rot-h"><b>${r.line}行目 ${esc(r.depot)}</b><span class="rot-seq">${stepsHtml(r)}</span></div><ul>${r.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
    ${R.errors.filter((e) => !/無効です$/.test(e)).length ? `<div class="alert delay"><ul>${R.errors.filter((e) => !/無効です$/.test(e)).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    ${!R.rotations.length ? '<p class="muted">有効なローテーションはありません。</p>' : ''}
    ${Object.entries(byDepot).map(([depot, rs]) => {
      const types = [...new Set(rs.map((r) => r.type))];
      const mem = forms.filter((f) => (f.depot || '') === depot && types.includes(f.type) && isActiveFormation(f));
      const slots = rs.reduce((a, r) => a + r.ops.length, 0);
      const idle = mem.filter((f) => !asg.formRot?.[f.id]);
      return `<section class="card"><div class="card-h"><h2>${esc(depot)} 車庫</h2><span class="muted small">所属 ${mem.length}編成・ローテーション ${slots}日分・予備 ${Math.max(0, mem.length - slots)}編成</span></div>
      ${mem.length < slots ? `<p class="small warn">編成が ${slots - mem.length} 本足りません。足りない日は運休になります。</p>` : ''}
      ${rs.map((r) => `<div class="rot">
          <div class="rot-h"><b>${r.line}行目</b> <span class="muted">${OP_TYPE_NAME[r.type]}・${r.ops.length}日</span><span class="rot-seq">${stepsHtml(r)}<span class="arr">→</span><span class="muted small">次のローテーションへ(ランダム)</span></span></div>
          <table class="tbl"><thead><tr><th>日目</th><th>運用</th><th>区間</th><th>本日(${t.date.slice(5).replace('-', '/')})</th><th>明日(${tm.slice(5).replace('-', '/')})</th></tr></thead><tbody>
          ${r.ops.map((op, p) => { const id = at(asg, r, p + 1); const run = asg.opForm[op]; const e = opEnds(op);
            return `<tr class="${run ? '' : 'cx'}"><td>${p + 1}日目</td><td><a href="#/fleet/${op}">${op}</a></td><td class="small muted">${esc(e.from)}→${esc(e.to)}</td>
            <td>${fl(id)}${id && wd[id] ? ` <span class="pill ${wd[id].kind === 'accident' ? 'stop' : 'delay'}">${esc(wd[id].name)}</span>` : ''}${run && run !== id ? ` <small>→ ${fl(run)} が代走</small>` : ''}${!run ? ' <span class="pill stop">運休</span>' : ''}</td>
            <td>${fl(at(asg2, r, p + 1))}${p === 0 ? ' <small class="muted">(ランダム)</small>' : ''}</td></tr>`; }).join('')}
          </tbody></table></div>`).join('')}
      ${idle.length ? `<p class="small"><b>予備:</b> ${idle.map((f) => `${fl(f.id)}${asg.formOp[f.id] ? `(本日 ${asg.formOp[f.id]} に代走)` : wd[f.id] ? `(${esc(wd[f.id].name)})` : ''}`).join('、')}</p>` : ''}
      </section>`;
    }).join('')}
    ${R.rotations.length || R.invalid.length ? `<details class="card"><summary><b>運休になる運用(ローテーション外・無効) ${D.ops.filter((o) => !inRot.has(o.id)).length}</b></summary><div class="stchips">${D.ops.filter((o) => !inRot.has(o.id)).map((o) => `<a href="#/fleet/${o.id}">${o.id}</a>`).join('')}</div></details>` : ''}
  </div>`;
}

function legsTable(o, date) {
  const t = now(); const st = opNow(o, t.min);
  return `<table class="tbl"><thead><tr><th>#</th><th>列車</th><th>種別</th><th>発</th><th>着</th><th>備考</th></tr></thead><tbody>${o.legs.map((leg, i) => {
    const nums = leg[0].split('→');
    const on = date === t.date && st.leg === leg;
    return `<tr class="${on ? 'here' : ''}"><td>${i + 1}</td><td>${nums.map((n) => D.trainByN[n] ? `<a href="#/train/${encodeURIComponent(n)}">${esc(n)}</a>` : esc(n)).join(' → ')}${on ? ' <span class="nowtag">走行中</span>' : ''}</td>
      <td>${typeBadge(String(leg[1]))}</td><td>${esc(leg[2])} ${esc(leg[3])}</td><td>${esc(leg[4])} ${esc(leg[5])}</td><td class="small muted">${esc(leg[6])}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function opDetail(el, id) {
  const o = D.opById[id]; const t = now(); const asg = assignment(t.date);
  const form = asg.opForm[id]; const f = asg.formById[form];
  el.innerHTML = `<div class="wrap">
    <p class="crumb"><a href="#/fleet?type=${o.type}">車両・運用</a> › 運用 ${esc(id)}</p>
    <h1 class="ph">運用 ${esc(id)} <small class="muted">${OP_TYPE_NAME[o.type]}</small></h1>
    ${rotationMode() ? (() => { const r = rotations().rotations.find((x) => x.ops.includes(id)); return r ? `<p class="small">ローテーション: <b>${esc(r.depot)}</b> ${r.line}行目 ${r.ops.map((x) => x === id ? `<b>${x}</b>` : `<a href="#/fleet/${x}">${x}</a>`).join('→')}</p>` : '<div class="alert stop small">この運用はどのローテーションにも入っていないため運休です。</div>'; })() : ''}
    ${form ? `<div class="card"><b>本日の充当編成:</b> ${form.split('+').map((x) => `<a href="#/fleet/${encodeURIComponent(x)}">${esc(x)}</a>`).join(' + ')} (${esc(f.series)} ${f.cars}両${f.pair ? '・2両編成を2本つないで代走' : ''})</div>`
      : `<div class="alert stop">本日はこの運用に充当できる編成がないため、以下の列車は運休です(他の編成と併結している列車は減車で運転)。</div>`}
    <div class="card">${legsTable(o, t.date)}</div></div>`;
}

function formDetail(el, id) {
  const t = now(); const asg = assignment(t.date);
  const f = asg.formById[id];
  if (!f) { el.innerHTML = `<div class="wrap"><h1>編成が見つかりません</h1><p>「${esc(id)}」は登録されていません。</p></div>`; return; }
  const op = asg.formOp[id];
  const wdNow = withdrawals(t.date)[id];
  el.innerHTML = `<div class="wrap">
    <p class="crumb"><a href="#/fleet?type=${f.type}">車両・運用</a> › 編成 ${esc(id)}</p>
    <h1 class="ph">${esc(id)} <small class="muted">${esc(f.series)}</small></h1>
    ${wdNow ? `<div class="alert ${wdNow.kind === 'accident' ? 'stop' : 'delay'}"><b>${esc(wdNow.name)}で離脱中</b>:${esc(wdNow.reason)}(${wdNow.from} 〜 ${wdNow.to} 復帰予定)</div>` : ''}
    <div class="card"><dl class="kv"><dt>車種</dt><dd>${OP_TYPE_NAME[f.type]}</dd><dt>両数</dt><dd>${f.cars}両</dd>
      <dt>製造年</dt><dd>${f.built ? `${f.built}年 <small class="muted">(車齢 ${Number(t.date.slice(0, 4)) - f.built}年)</small>` : '<span class="muted">未登録</span>'}</dd>
      <dt>所属車庫</dt><dd>${f.depot ? esc(f.depot) : '<span class="muted">未登録</span>'}</dd>
      ${asg.formRot?.[id] ? `<dt>ローテーション</dt><dd>${esc(asg.formRot[id].rot.depot)} ${asg.formRot[id].rot.line}行目の <b>${asg.formRot[id].day}日目</b> / ${asg.formRot[id].rot.ops.length}日(${asg.formRot[id].rot.ops.map((o, k) => k + 1 === asg.formRot[id].day ? `<b>${o}</b>` : o).join('→')})<br><small class="muted">終了後は次のローテーションをランダムに決定</small></dd>` : rotationMode() && !f.pair ? '<dt>ローテーション</dt><dd class="muted">本日は入っていません(予備・または車庫未登録)</dd>' : ''}
      <dt>状態</dt><dd>${esc(f.status || '在籍')}</dd>
      ${f.pair ? '' : `<dt>次回検査</dt><dd>${nextInspection(t.date, f, D.sim.withdrawal).map((x) => `${esc(x.name)} ${x.date}`).join(' / ') || '-'}</dd>`}
      ${f.pin ? `<dt>固定運用</dt><dd>${esc(f.pin)}</dd>` : ''}${f.note ? `<dt>備考</dt><dd>${esc(f.note)}</dd>` : ''}
      <dt>本日の運用</dt><dd>${op ? `<a href="#/fleet/${op}">${op}</a>` : wdNow ? '離脱中' : isActiveFormation(f) ? '予備(運用なし)' : '使用停止中'}</dd></dl></div>
    ${f.pair ? '' : `<div class="card"><h3>今後7日間の運用</h3><div class="sched">${formationSchedule(id, t.date, 7).map((x) => `<div><small>${x.date.slice(5).replace('-', '/')}</small>${x.wd ? `<span class="pill ${x.wd.kind === 'accident' ? 'stop' : 'delay'}">${esc(x.wd.name)}</span>` : x.op ? `<a href="#/fleet/${x.op}">${x.op}</a>` : '<span class="muted">予備</span>'}</div>`).join('')}</div></div>`}
    ${op ? `<div class="card"><h3>本日の行路 (${esc(op)})</h3>${legsTable(D.opById[op], t.date)}</div>` : ''}</div>`;
}
