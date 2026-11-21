// 管理ページ(テスト用:変更はこの端末のブラウザだけに保存されます)
import { CONFIG } from './config.js';
import { D, now, fmt, stName, LS, invalidate, setSim, clearSim, incidentsAll, incidentSection, formations, OP_TYPE_NAME, assignment, parseHM, withdrawals } from './core.js';
import { esc, $, $$, lineBadge, toast } from './ui.js';

export function pageAdmin(el) {
  const t = now();
  el.innerHTML = `
  <div class="wrap">
    <h1 class="ph">管理・テスト</h1>
    <div class="alert info small">このページでの操作は<b>このブラウザにだけ</b>反映されます(動作確認用)。全利用者に公開するには、スプレッドシートの「運行情報」「編成」シート、またはリポジトリの <code>data/incidents.json</code>・<code>data/formations.json</code> を更新してください。</div>

    <section class="card"><h3>表示時刻のシミュレーション</h3>
      <p class="small muted">深夜でもラッシュ時の様子を確認できます。現在: ${t.sim ? '<b>シミュレーション中</b>' : '実時刻'} ${t.date} ${fmt(t.min)}</p>
      <div class="row"><input type="date" id="sdate" class="inp" value="${t.date}"><input type="time" id="stime" class="inp" value="${fmt(t.min).padStart(5, '0')}">
      <label class="chk"><input type="checkbox" id="sfreeze">時計を止める</label>
      <button class="btn primary" id="sset">設定</button><button class="btn" id="sclr">実時刻に戻す</button></div>
    </section>

    <section class="card"><h3>運転見合わせを発生させる</h3>
      <div class="formgrid">
        <label>路線<select id="iline" class="inp">${D.lines.map((l) => `<option value="${l.id}">${l.name} ${esc(l.sub)}</option>`).join('')}</select></label>
        <label>区間(から)<select id="ifrom" class="inp"></select></label>
        <label>区間(まで)<select id="ito" class="inp"></select></label>
        <label>開始時刻<input type="time" id="istart" class="inp" value="${fmt(t.min).padStart(5, '0')}"></label>
        <label>再開見込み<select id="idur" class="inp"><option value="30">30分後</option><option value="60" selected>60分後</option><option value="90">90分後</option><option value="120">2時間後</option><option value="">未定</option></select></label>
        <label>理由<input id="ireason" class="inp" value="車両点検"></label>
      </div>
      <div class="row"><button class="btn primary" id="iadd">この端末で発生させる</button><button class="btn" id="icopy">公開用データをコピー</button></div>
      <p class="small muted">「公開用データをコピー」は <code>data/incidents.json</code> に追記するJSONと、スプレッドシート「運行情報」シートに貼り付ける行(タブ区切り)をコピーします。</p>
      <h4>本日の見合わせ一覧</h4><div id="inclist"></div>
      <h4>ランダム見合わせの発生確率</h4>
      <div class="row"><input id="iprob" class="inp" type="number" step="0.005" min="0" max="1" style="max-width:120px" value="${LS.get('sj.prob', null) ?? D.sim.randomIncident?.probabilityPerHour}"><span class="small muted">1路線・1時間あたり(既定 ${D.sim.randomIncident?.probabilityPerHour}・data/sim.json)</span><button class="btn" id="iprobset">この端末に適用</button></div>
    </section>

    <section class="card"><h3>編成の登録・管理</h3>
      <p class="small muted">状態を「検査」「休車」「廃車」にした編成は運用に入りません(手動の長期離脱)。このほか data/sim.json の設定で、定期検査・全般検査・事故による離脱が自動で発生します(古い編成ほど事故・故障が起きやすくなります)。「固定運用」に運用番号を入れるとその運用に優先して充当します。${LS.get('sj.formLocal', null) ? '<b class="warn">この端末ではローカル編集中の編成データを使用しています。</b>' : ''}</p>
      <div class="row">
        <select id="ftype" class="inp" style="max-width:180px">${['T', 'B', 'C', 'L'].map((ty) => `<option value="${ty}">${OP_TYPE_NAME[ty]}</option>`).join('')}</select>
        <input id="fq" class="inp" placeholder="編成番号で絞り込み" style="max-width:200px">
        <span class="spacer"></span>
        <button class="btn" id="fadd">＋ 編成を追加</button>
      </div>
      <div id="ftable" class="scrollbox"></div>
      <div class="row"><button class="btn primary" id="fapply">変更をこの端末に適用</button><button class="btn" id="fdl">formations.json をダウンロード</button><button class="btn" id="ftsv">スプレッドシート用にコピー</button><button class="btn danger" id="freset">ローカル変更を破棄</button></div>
    </section>
  </div>`;

  // --- sim
  $('#sset').onclick = () => { const m = parseHM($('#stime').value); setSim($('#sdate').value, m, $('#sfreeze').checked); toast('シミュレーション時刻を設定しました'); location.reload(); };
  $('#sclr').onclick = () => { clearSim(); location.reload(); };

  // --- incidents
  const fillSt = () => {
    const l = D.lineById[+$('#iline').value];
    const opts = l.stations.map((s, i) => `<option value="${esc(stName(s))}">${esc(stName(s))}</option>`).join('');
    $('#ifrom').innerHTML = opts; $('#ito').innerHTML = opts; $('#ito').selectedIndex = Math.min(3, l.stations.length - 1);
  };
  $('#iline').onchange = fillSt; fillSt();
  const build = () => {
    const start = $('#istart').value; const dur = $('#idur').value;
    const sm = parseHM(start);
    return { date: now().date, line: +$('#iline').value, from: $('#ifrom').value, to: $('#ito').value, start,
      end: dur ? fmt(sm + +dur).padStart(5, '0') : '', reason: $('#ireason').value || '運転見合わせ' };
  };
  $('#iadd').onclick = () => { const all = LS.get('sj.localInc', []); all.push({ ...build(), id: 'L' + Date.now() }); LS.set('sj.localInc', all); invalidate(); drawInc(); toast('見合わせを発生させました'); };
  $('#icopy').onclick = async () => {
    const x = build();
    const txt = `// data/incidents.json に追記\n${JSON.stringify(x)}\n\n// スプレッドシート「運行情報」に貼り付け\n${[x.date, x.line, x.from, x.to, x.start, x.end, x.reason, 'TRUE'].join('\t')}`;
    try { await navigator.clipboard.writeText(txt); toast('コピーしました'); } catch { prompt('コピーしてください', txt); }
  };
  $('#iprobset').onclick = () => { LS.set('sj.prob', +$('#iprob').value); invalidate(); drawInc(); toast('確率を変更しました'); };
  const drawInc = () => {
    const tt = now(); const all = incidentsAll(tt.date);
    $('#inclist').innerHTML = all.length ? `<table class="tbl"><thead><tr><th>路線</th><th>区間</th><th>時間</th><th>理由</th><th>種類</th><th></th></tr></thead><tbody>${all.map((i) => {
      const [a, b] = incidentSection(i);
      const state = i.start > tt.min ? '<span class="muted">未発生</span>' : i.end > tt.min ? '<span class="pill stop">発生中</span>' : '<span class="muted">終了</span>';
      return `<tr><td>${lineBadge(i.line)}</td><td>${esc(a)}〜${esc(b)}</td><td>${fmt(i.start)}〜${isFinite(i.end) ? fmt(i.end) : '未定'} ${state}</td><td>${esc(i.reason)}</td><td>${{ random: 'ランダム', manual: '公開データ', local: 'この端末' }[i.source]}</td>
        <td>${i.source === 'local' ? `<button class="btn small" data-del="${esc(i.id)}">削除</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="muted small">本日の見合わせはありません。</p>';
    $$('[data-del]').forEach((b) => (b.onclick = () => { LS.set('sj.localInc', LS.get('sj.localInc', []).filter((x) => x.id !== b.dataset.del)); invalidate(); drawInc(); }));
  };
  drawInc();

  // --- formations
  let forms = JSON.parse(JSON.stringify(formations()));
  const asg = assignment(t.date);
  const wd = withdrawals(t.date);
  const drawF = () => {
    const ty = $('#ftype').value; const q = $('#fq').value.trim().toUpperCase();
    const list = forms.map((f, i) => ({ f, i })).filter(({ f }) => f.type === ty && (!q || String(f.id).toUpperCase().includes(q)));
    $('#ftable').innerHTML = `<table class="tbl"><thead><tr><th>編成番号</th><th>形式</th><th>両数</th><th>製造年</th><th>状態</th><th>固定運用</th><th>本日</th><th></th></tr></thead><tbody>${list.map(({ f, i }) => `<tr>
      <td><b>${esc(f.id)}</b></td><td>${esc(f.series)}</td><td>${f.cars}</td>
      <td><input class="inp sm" type="number" min="1900" max="2100" data-i="${i}" data-k="built" value="${esc(f.built || '')}" style="width:76px"></td>
      <td><select class="inp sm" data-i="${i}" data-k="status">${['在籍', '検査', '休車', '廃車'].map((s) => `<option ${(f.status || '在籍') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input class="inp sm" data-i="${i}" data-k="pin" value="${esc(f.pin || '')}" placeholder="例 ${ty}001" style="width:90px"></td>
      <td class="small">${wd[f.id] ? `<span class="pill ${wd[f.id].kind === 'accident' ? 'stop' : 'delay'}">${esc(wd[f.id].name)}</span>` : asg.formOp[f.id] ? `<a href="#/fleet/${asg.formOp[f.id]}">${asg.formOp[f.id]}</a>` : '<span class="muted">予備</span>'}</td>
      <td><button class="btn small" data-rm="${i}">削除</button></td></tr>`).join('')}</tbody></table><p class="small muted">${list.length}編成</p>`;
    $$('#ftable [data-k]').forEach((inp) => (inp.onchange = () => { const v = inp.value.trim(); forms[+inp.dataset.i][inp.dataset.k] = inp.dataset.k === 'built' ? (v ? Number(v) : '') : v; }));
    $$('#ftable [data-rm]').forEach((b) => (b.onclick = () => { forms.splice(+b.dataset.rm, 1); drawF(); }));
  };
  $('#ftype').onchange = drawF; $('#fq').oninput = drawF; drawF();
  $('#fadd').onclick = () => {
    const ty = $('#ftype').value;
    const id = prompt('新しい編成番号', ''); if (!id) return;
    if (forms.some((f) => f.id === id)) return toast('同じ編成番号があります', 'err');
    const sample = forms.find((f) => f.type === ty) || { series: '', cars: ty === 'C' || ty === 'L' ? 2 : 4 };
    forms.push({ id, type: ty, series: sample.series, cars: sample.cars, built: Number(t.date.slice(0, 4)), status: '在籍', pin: '', note: '' }); drawF();
  };
  $('#fapply').onclick = () => { LS.set('sj.formLocal', forms); invalidate(); toast('この端末に適用しました'); };
  $('#freset').onclick = () => { LS.del('sj.formLocal'); invalidate(); location.reload(); };
  $('#fdl').onclick = () => {
    const blob = new Blob([JSON.stringify(forms, null, 0).replace(/},{/g, '},\n{')], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'formations.json'; a.click();
  };
  $('#ftsv').onclick = async () => {
    const tsv = ['編成番号\t車種\t形式\t両数\t状態\t固定運用\t備考\t製造年', ...forms.map((f) => [f.id, f.type, f.series, f.cars, f.status || '在籍', f.pin || '', f.note || '', f.built || ''].join('\t'))].join('\n');
    try { await navigator.clipboard.writeText(tsv); toast(`${forms.length}行をコピーしました。「編成」シートのA1に貼り付けてください`); } catch { toast('コピーできませんでした', 'err'); }
  };
}
