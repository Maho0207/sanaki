#!/usr/bin/env python3
"""早菜島軌道: Excelダイヤ → サイト用JSON 変換スクリプト

使い方:  python3 tools/build_data.py ダイヤ.xlsx
出力:    data/network.json  (路線・駅・列車)
         data/operations.json (運用行路)
         data/formations.json (編成。既存ファイルがある場合は上書きしない)
"""
import json, re, sys, os
from collections import defaultdict, OrderedDict
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'diagram.xlsx')

LINE_COLORS = {1: '#d9480f', 2: '#1971c2', 3: '#2f9e44', 4: '#e64980', 5: '#7048e8',
               6: '#0c8599', 7: '#f08c00', 8: '#5c940d', 9: '#c2255c'}
TIME_RE = re.compile(r'^\(?(\d{1,2}):(\d\d)\)?$')


def parse_time(v):
    if v is None:
        return None
    s = str(v).strip()
    m = TIME_RE.match(s)
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2)), s.startswith('(')


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    sheets = [n for n in wb.sheetnames if re.match(r'^\d号線[上下]り$', n)]

    stations = []          # global station names
    sid = {}
    def station_id(name):
        if name not in sid:
            sid[name] = len(stations)
            stations.append(name)
        return sid[name]

    lines = {}
    segments = defaultdict(list)   # train number -> list of segments
    columns = []

    # 0) 路線の駅順(下りシート)と接続駅、キロ程(あれば通過駅の時刻推定に使う)
    line_st = {}
    for name in sheets:
        if not name.endswith('下り'): continue
        rows = list(wb[name].iter_rows(values_only=True))
        line_st[int(name[0])] = list(OrderedDict.fromkeys(r[0] for r in rows[7:] if r[0] is not None))
    st_lines = defaultdict(set)
    for L, sts in line_st.items():
        for x in sts: st_lines[x].add(L)
    junction = {x for x, ls in st_lines.items() if len(ls) > 1}
    km = {}
    kmx = os.path.join(ROOT, 'tools', 'kilometers.xlsx')
    if os.path.exists(kmx):
        kwb = openpyxl.load_workbook(kmx, data_only=True, read_only=True)
        for L in line_st:
            ws = next((w for w in kwb.worksheets if w.title.startswith(f'{L}号線')), None)
            if not ws: continue
            for r in ws.iter_rows(min_row=2, max_col=4, values_only=True):
                if isinstance(r[0], (int, float)) and r[1] and r[3] is not None:
                    km[(L, r[1])] = float(r[3])
    def dist(x, y):
        """隣り合う2駅(共通の路線上)の距離"""
        for L in st_lines[x] & st_lines[y]:
            if (L, x) in km and (L, y) in km: return abs(km[(L, x)] - km[(L, y)])
            return abs(line_st[L].index(x) - line_st[L].index(y))
        return 1.0

    for name in sheets:
        ws = wb[name]
        rows = list(ws.iter_rows(values_only=True))
        lno = int(name[0])
        down = name.endswith('下り')
        title = rows[0][0]
        m = re.match(r'(\d号線)\s+(\S+)', title)
        st_rows = [(r[0], r[1], i) for i, r in enumerate(rows) if i >= 7 and r[0] is not None]
        if down:
            lines[lno] = {'id': lno, 'name': m.group(1), 'sub': m.group(2), 'color': LINE_COLORS[lno],
                          'stations': [station_id(x) for x in line_st[lno]]}
        # 駅ごとに行をまとめる(着・発の2行がある駅)
        groups = []
        for st, kind, i in st_rows:
            if groups and groups[-1][0] == st: groups[-1][1].append((kind, i))
            else: groups.append((st, [(kind, i)]))
        for c in range(2, len(rows[1])):
            hdr = rows[1][c]
            if hdr is None:
                continue
            hdr = str(hdr)
            num = hdr.split('\n')[0].strip()
            partners = []
            pm = re.search(r'\(\+(.+?)\)', hdr)
            if pm:
                partners = pm.group(1).split('・')
            typ = str(rows[2][c] or '')
            fastest = '最速達' in typ
            typ = typ.split('\n')[0]
            cars = str(rows[5][c] or '')
            note = rows[6][c] or ''
            # 空欄の駅で区切って「走る区間」ごとに分ける(1列に離れた2区間が書かれている列車がある)
            runs, cur = [], []
            for st, rws in groups:
                vals = [(kind, rows[i][c]) for kind, i in rws]
                timed = [(kind, parse_time(v)) for kind, v in vals if parse_time(v)]
                passing = any(str(v).strip() == 'レ' for _, v in vals if v is not None)
                if timed:
                    e = {'st': st, 'a': None, 'd': None, 'op': False, 'pass': False}
                    for kind, (minute, op) in timed:
                        if kind == '着': e['a'] = minute
                        elif kind == '発': e['d'] = minute
                        else: e['a'] = e['d'] = minute
                        if op: e['op'] = True
                    if e['a'] is None: e['a'] = e['d']
                    if e['d'] is None: e['d'] = e['a']
                    cur.append(e)
                elif passing:
                    cur.append({'st': st, 'a': None, 'd': None, 'op': True, 'pass': True})
                else:
                    if any(not x['pass'] for x in cur): runs.append(cur)
                    cur = []
            if any(not x['pass'] for x in cur): runs.append(cur)
            col = {'line': lno, 'down': down, 'num': num, 'partners': partners, 'orig': rows[3][c], 'dest': rows[4][c],
                   'type': typ, 'fast': fastest, 'cars': cars, 'note': note}
            any_run = False
            for run in runs:
                # 通過駅は「接続駅」だけ残す(路線をまたぐ区間の境目)。区間の外側の通過駅は削る
                run = [x for x in run if not x['pass'] or x['st'] in junction]
                if len(run) < 2:
                    continue   # 接続駅だけの1駅の欄(他の区間と重複)
                for x in run: x['L'] = lno
                segments[num].append({'line': lno, 'stops': run, 'borrowed': False, 'col': col})
                any_run = True
            if any_run:
                columns.append(col)

    def seg_key(g):
        t = next((x['d'] for x in g['stops'] if x['d'] is not None), 0)
        return t

    def merge(segs):
        """区間をつなぐ: 時刻順に並べたうえで、前の区間の終点から始まる区間を優先してつなぐ"""
        segs_sorted = sorted(segs, key=seg_key)
        if len(segs_sorted) > 1:
            ts = [seg_key(g) for g in segs_sorted]
            gaps = [(ts[(i + 1) % len(ts)] - ts[i]) % 1440 for i in range(len(ts))]
            cut = max(range(len(ts)), key=lambda i: gaps[i])
            segs_sorted = segs_sorted[cut + 1:] + segs_sorted[:cut + 1]
        chain = []
        rest = list(segs_sorted)
        while rest:
            nxt = None
            if chain:
                last = chain[-1]['stops'][-1]['st']
                nxt = next((g for g in rest if g['stops'][0]['st'] == last), None)
            if nxt is None: nxt = rest[0]
            rest.remove(nxt); chain.append(nxt)
        it = []
        for seg in chain:
            for k, st in enumerate(seg['stops']):
                e = dict(st)
                e['L'] = st.get('L', seg['line'])
                e['b'] = seg['borrowed'] or st.get('b', False)
                e['th'] = seg.get('thru', False) or st.get('th', False)
                if it and it[-1]['st'] == e['st']:
                    p = it[-1]
                    if p['pass'] and not e['pass']:
                        p.update(a=e['a'], d=e['d'], op=e['op']); p['pass'] = False
                    elif not e['pass']:
                        # 着は先の区間(その列車が実際に着いた時刻)、発は遅い方(併結・分割の待ち合わせ)
                        if p['a'] is None: p['a'] = e['a']
                        p['d'] = max(x for x in (p['d'], e['d'], p['a']) if x is not None)
                        p['op'] = p['op'] and e['op']
                        if not e['b']: p['b'] = False
                        if not e['th']: p['th'] = False
                    continue
                it.append(e)
        # 先頭・末尾の通過駅は除く
        while it and it[0]['pass']: it.pop(0)
        while it and it[-1]['pass']: it.pop()
        # 通過した接続駅の時刻をキロ程で按分
        pos = [0.0]
        for x, y in zip(it, it[1:]): pos.append(pos[-1] + dist(x['st'], y['st']))
        for i, e in enumerate(it):
            if e['a'] is not None: continue
            j = i - 1
            while j >= 0 and it[j]['d'] is None: j -= 1
            k = i + 1
            while k < len(it) and it[k]['a'] is None: k += 1
            if j < 0 or k >= len(it): continue
            t0, t1 = it[j]['d'], it[k]['a']
            if t1 < t0 - 720: t1 += 1440
            f = (pos[i] - pos[j]) / ((pos[k] - pos[j]) or 1)
            e['a'] = e['d'] = round(t0 + (t1 - t0) * f)
        return it

    # 1) 各列車の自列車区間(複数路線にまたがる場合も1本につなぐ)
    own_it = {num: merge([g for g in segs if not g['borrowed']]) for num, segs in segments.items()}

    # 2) 併結区間: 備考「X～Y 相手(…)併結」の区間を、本務列車の全経路から切り出して相手列車に加える
    #    (併結区間が路線をまたぐ場合 — 例: 桜川口～浅山早菜口 — も正しく扱う)
    seg_re = re.compile(r'([^\s・～]+)～([^\s・～]+) ([^\s(]+)\(([^)]+?)[行発]\)併結')
    done_pairs = set()
    unresolved = []
    for col in columns:
        M = col['num']
        for m in seg_re.finditer(col['note']):
            x, y, nums = m.group(1), m.group(2), m.group(3)
            path = own_it.get(M, [])
            names = [e['st'] for e in path]
            for p in nums.split('・'):
                key = (M, p, x, y)
                if key in done_pairs:
                    continue
                if x not in names or y not in names:
                    continue   # この列車の自列車区間に併結区間が無い(相手側が本務)
                done_pairs.add(key)
                i, j = names.index(x), names.index(y)
                if i > j: i, j = j, i
                sec = [dict(e) for e in path[i:j + 1]]
                mine = {e['st'] for e in own_it.get(p, [])}
                # 相手列車の自区間と重なる駅(接続駅以外)は除く
                if all(e['st'] in mine for e in sec):
                    continue
                segments[p].append({'line': sec[0]['L'], 'stops': sec, 'borrowed': True, 'col': col, 'main': M})

    # 3) 列車番号が変わって直通する列車(例: みやこ335 → 桜川口から さくら471)
    #    Excel の始発・行先と運用行路の「A→B」から判定し、互いの区間を直通区間として加える
    ws_ops = wb['運用行路']
    chain_pairs = set()
    for r in ws_ops.iter_rows(min_row=2, values_only=True):
        if r[2]:
            ch = str(r[2]).split('→')
            chain_pairs.update(zip(ch, ch[1:]))
    info = {}
    for num, segs in segments.items():
        own = [g for g in segs if not g['borrowed']]
        if own:
            info[num] = ({g['col']['orig'] for g in own}, {g['col']['dest'] for g in own})
    first_at = defaultdict(list)
    for num, it in own_it.items():
        if it: first_at[it[0]['st']].append(num)
    thru = []
    for A, it in own_it.items():
        if not it or A not in info: continue
        J = it[-1]['st']; oa, da = info[A]
        if J in da: continue
        for B in first_at.get(J, []):
            if B == A or B not in info: continue
            ob, db = info[B]
            itb = own_it[B]
            gap = (itb[0]['d'] - it[-1]['a']) % 1440
            if gap > 90: continue
            if (da & db) and (oa & ob) or (A, B) in chain_pairs and (da & db):
                thru.append(((0 if (A, B) in chain_pairs else 1), gap, A, B))
    # 1対1に絞る(運用行路で A→B になっているもの、次に接続時間の短いものを優先)
    usedA, usedB, pairs = set(), set(), []
    for _, _, A, B in sorted(thru):
        if A in usedA or B in usedB: continue
        usedA.add(A); usedB.add(B); pairs.append((A, B))
    thru = pairs
    for A, B in thru:
        segments[A].append({'line': own_it[B][0]['L'], 'stops': [dict(e) for e in own_it[B]], 'borrowed': True, 'thru': True, 'col': None, 'main': B})
        segments[B].append({'line': own_it[A][0]['L'], 'stops': [dict(e) for e in own_it[A]], 'borrowed': True, 'thru': True, 'col': None, 'main': A})
    thru_next = dict(thru); thru_prev = {b: a for a, b in thru}
    print('番号が変わる直通:', len(thru), thru)

    trains = []
    report = []
    for num, segs in segments.items():
        own = [s for s in segs if not s['borrowed']]
        if not own:
            continue
        it = merge(segs)
        # time normalisation
        prev = None
        first = it[0]['d'] if it[0]['d'] is not None else it[0]['a']
        base = 1440 if first < 180 else 0
        for e in it:
            for f in ('a', 'd'):
                t = e[f] + base
                if prev is not None and t < prev - 720:
                    base += 1440
                    t += 1440
                e[f] = t
                prev = t
        main = own[0]['col']
        cars_vals = [int(x) for x in re.findall(r'\d+', main['cars'])] or [4]
        notes = []
        for s in own:
            if s['col']['note'] and s['col']['note'] not in notes:
                notes.append(s['col']['note'])
        partners = sorted(set(p for s in own for p in s['col']['partners']) |
                          set(s['main'] for s in segs if s['borrowed'] and not s.get('thru')))
        flat = []
        for e in it:
            flag = (1 if e['op'] else 0) | (2 if e['b'] else 0) | (4 if e.get('th') else 0) | (8 if e.get('pass') else 0)
            flat += [station_id(e['st']), e['a'], e['d'], e['L'] * 16 + flag]
        exp_dest = {g['col']['dest'] for g in own if g['col']['dest']}
        exp_orig = {g['col']['orig'] for g in own if g['col']['orig']}
        if it[-1]['st'] not in exp_dest or it[0]['st'] not in exp_orig:
            report.append((num, main['line'], it[0]['st'], it[-1]['st'], '/'.join(sorted(exp_orig)), '/'.join(sorted(exp_dest)), main['type']))
        trains.append({
            'n': num, 'k': main['type'], 'f': 1 if main['fast'] else 0,
            'dn': 1 if main['down'] else 0,
            'c': main['cars'], 'cr': min(cars_vals) if main['partners'] else cars_vals[0],
            'nt': '・'.join(notes), 'p': partners, 's': flat,
            **({'nx': thru_next[num]} if num in thru_next else {}), **({'pv': thru_prev[num]} if num in thru_prev else {}),
        })
    trains.sort(key=lambda t: t['s'][2])

    net = {'lines': [lines[k] for k in sorted(lines)], 'stations': stations, 'trains': trains}
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'network.json'), 'w', encoding='utf-8') as f:
        json.dump(net, f, ensure_ascii=False, separators=(',', ':'))

    # operations
    ws = wb['運用行路']
    ops = OrderedDict()
    cur = None
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0]:
            cur = r[0]
            ops[cur] = {'id': cur, 'type': cur[0], 'legs': []}
        if cur is None or not r[2]:
            continue
        ops[cur]['legs'].append([str(r[2]), r[3], r[4], str(r[5]), r[6], str(r[7]), r[9] or ''])
    with open(os.path.join(ROOT, 'data', 'operations.json'), 'w', encoding='utf-8') as f:
        json.dump(list(ops.values()), f, ensure_ascii=False, separators=(',', ':'))

    # default formations (only if absent)
    fpath = os.path.join(ROOT, 'data', 'formations.json')
    if not os.path.exists(fpath):
        counts = defaultdict(int)
        for o in ops.values():
            counts[o['type']] += 1
        spec = {'T': ('8000系', 8100, 4), 'B': ('3000系', 3000, 4), 'C': ('2000系', 2000, 2), 'L': ('ED50形', 50, 2)}
        forms = []
        for t in 'TBCL':
            series, base, cars = spec[t]
            for i in range(1, counts[t] + 1):
                fid = f'{base + i}F' if t != 'L' else f'ED50-{i}'
                forms.append({'id': fid, 'type': t, 'series': series, 'cars': cars, 'status': '在籍', 'pin': '', 'note': ''})
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(forms, f, ensure_ascii=False, indent=0)
    print('stations', len(stations), 'trains', len(trains), 'ops', len(ops))
    print('始発・行先がExcelの表示と一致しない列車:', len(report))
    for r in report[:40]:
        print('  {} ({}号線{}) 経路 {}→{} / Excel {}→{}'.format(r[0], r[1], r[6], r[2], r[3], r[4], r[5]))


if __name__ == '__main__':
    main()
