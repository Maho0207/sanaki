#!/usr/bin/env python3
"""キロ程・駅名読み・座席配列 → JSON

使い方:
  python3 tools/build_extra.py --km tools/kilometers.xlsx --seats tools/seatmaps.xlsx [--formations]
出力:
  data/distances.json  路線ごとの累積キロ(下り順)
  data/stations.json   駅名 → 読み
  data/seatmaps.json   形式ごとの座席配列
  data/formations.json (--formations 指定時のみ作り直し)
"""
import argparse, json, os, re
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--km'); ap.add_argument('--seats'); ap.add_argument('--formations', action='store_true')
args = ap.parse_args()
net = json.load(open(os.path.join(ROOT, 'data', 'network.json'), encoding='utf-8'))
dump = lambda name, obj: json.dump(obj, open(os.path.join(ROOT, 'data', name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------ Apps Script 用の路線一覧
dump('lines.json', [{'id': l['id'], 'name': l['name'], 'sub': l['sub'], 'n': len(l['stations']),
                     'stations': [net['stations'][x] for x in l['stations']]} for l in net['lines']])

# ------------------------------------------------------------ キロ程・読み
if args.km:
    wb = openpyxl.load_workbook(args.km, data_only=True, read_only=True)
    dist, yomi = {}, {}
    for l in net['lines']:
        ws = next(w for w in wb.worksheets if w.title.startswith(f"{l['id']}号線"))
        rows = []
        for r in ws.iter_rows(min_row=2, max_col=4, values_only=True):
            if r[1] is None:
                if rows: break
                continue
            rows.append(r)
        names = [r[1] for r in rows]
        ours = [net['stations'][s] for s in l['stations']]
        if names != ours:
            raise SystemExit(f"{l['id']}号線の駅名・駅順がダイヤと一致しません")
        dist[str(l['id'])] = [float(r[3]) for r in rows]
        for r in rows:
            if r[2]: yomi[r[1]] = r[2]
    dump('distances.json', dist); dump('stations.json', yomi)
    print('distances / stations OK')

# ------------------------------------------------------------ 座席配列
SEAT = re.compile(r'^\d+[A-Z]$')
ROOM = re.compile(r'^(個室\d+|展望個室)$')

def parse_rooms(text):
    """'個室料金=1と4(4人用)→\\2500、2と3(6人用)→\\3000' → {'個室1': {cap, fee, premium}}"""
    out = {}
    for m in re.finditer(r'([^()→]*?)\((\d+)人用\)→\\?(\d+)', text):
        pre, cap, fee = m.group(1), int(m.group(2)), int(m.group(3))
        ids = []
        if '展望個室' in pre: ids = ['展望個室']
        else:
            for a, b in re.findall(r'(\d+)(?:[~～](\d+))?', pre):
                ids += [f'個室{i}' for i in range(int(a), int(b or a) + 1)]
        for i in ids:
            out[i] = {'cap': cap, 'fee': fee, 'premium': 'プレミアム' in pre}
    return out

if args.seats:
    wb = openpyxl.load_workbook(args.seats, data_only=True)
    maps = {}
    for ws in wb.worksheets:
        m = re.match(r'(\d+型)(?:特急車)?\s*[\(（](.+?)[\)）]', ws.title)
        key, nick = (m.group(1), m.group(2)) if m else (ws.title, '')
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        heads = [i for i, r in enumerate(rows) if isinstance(r[0], str) and re.match(r'^\d+号車$', r[0].strip())]
        cars, notes_all, special_fee = [], [], None
        for k, h in enumerate(heads):
            block = rows[h + 1:(heads[k + 1] if k + 1 < len(heads) else len(rows))]
            label = str(rows[h][1] or '')
            layout, notes = [], []
            for r in block:
                cells = [(j, str(v).strip()) for j, v in enumerate(r) if v is not None and str(v).strip()]
                ids = [(j, v) for j, v in cells if SEAT.match(v) or ROOM.match(v)]
                txt = [v for j, v in cells if not (SEAT.match(v) or ROOM.match(v))]
                notes += txt
                layout.append({j: v for j, v in ids})
            # 座席のある最初〜最後の行の範囲(間の空行=通路)
            idx = [i for i, row in enumerate(layout) if row]
            if not idx: continue
            layout = layout[idx[0]:idx[-1] + 1]
            cols = sorted({j for row in layout for j in row})
            c0, c1 = cols[0], cols[-1]
            note_txt = ' '.join(notes)
            rooms = {}
            for n in notes:
                if '人用' in n: rooms.update(parse_rooms(n))
                fm = re.search(r'特別席料金\s*→\s*\\?(\d+)', n)
                if fm: special_fee = int(fm.group(1))
            views = set()
            for a, b in re.findall(r'※\s*(\d+)\s*[~～]\s*(\d+)\s*は展望席', note_txt):
                views.update(range(int(a), int(b) + 1))
            special = '特別席' in label or 'First Class' in label
            grid = []
            for row in layout:
                line = []
                for j in range(c0, c1 + 1):
                    v = row.get(j)
                    if not v: line.append(0); continue
                    if ROOM.match(v):
                        rm = rooms.get(v, {'cap': 4, 'fee': 0, 'premium': False})
                        line.append({'id': v, 'k': 'r', 'cap': rm['cap'], 'fee': rm['fee'], **({'pr': 1} if rm['premium'] else {})})
                    else:
                        cell = {'id': v, 'k': 's'}
                        if int(re.match(r'\d+', v).group()) in views: cell['view'] = 1
                        line.append(cell)
                grid.append(line)
            cars.append({'no': int(re.match(r'\d+', rows[h][0]).group()), 'label': label, 'special': special,
                         'notes': [n for n in notes if '※' in n], 'grid': grid})
        for c in cars:
            if c['special']:
                c['fee'] = special_fee if special_fee is not None else 500
                for row in c['grid']:
                    for cell in row:
                        if cell and cell['k'] == 's': cell['fee'] = c['fee']
        maps[key] = {'name': key, 'nick': nick, 'cars': cars}
        seats = sum(1 for c in cars for row in c['grid'] for x in row if x and x['k'] == 's')
        rooms_n = sum(1 for c in cars for row in c['grid'] for x in row if x and x['k'] == 'r')
        print(f'{key} {nick}: {len(cars)}両 座席{seats} 個室{rooms_n}')
    dump('seatmaps.json', maps)

# ------------------------------------------------------------ 既定の編成
if args.formations:
    ops = json.load(open(os.path.join(ROOT, 'data', 'operations.json'), encoding='utf-8'))
    maps = json.load(open(os.path.join(ROOT, 'data', 'seatmaps.json'), encoding='utf-8'))
    need = {t: sum(1 for o in ops if o['type'] == t) for t in 'TBCL'}
    series = list(maps)
    per = [need['T'] // len(series) + (1 if i < need['T'] % len(series) else 0) for i in range(len(series))]
    # 予備編成(検査・事故で離脱しても運休しにくくするため)
    SPARE_T = {'1000型': 1, '1500型': 1, '2000型': 1, '3000型': 1, '5000型': 1, '6000型': 1}
    SPARE = {'B': 40, 'C': 4, 'L': 1}
    BUILT_T = {'1000型': 1992, '1500型': 1998, '2000型': 2004, '3000型': 2009, '4000型': 2014, '5000型': 2018, '5500型': 2021, '6000型': 2024}
    forms = []
    for s_, n in zip(series, per):
        base = int(re.match(r'\d+', s_).group())
        cars = len(maps[s_]['cars'])
        n += SPARE_T.get(s_, 0)
        for i in range(1, n + 1):
            forms.append({'id': f'{base + i}F', 'type': 'T', 'series': s_, 'cars': cars, 'built': BUILT_T.get(s_, 2000) + (i - 1) // 4,
                          'status': '在籍', 'pin': '', 'note': maps[s_]['nick']})
    for t, (sname, base, cars, y0, span, step) in {'B': ('7000系', 7000, 4, 1986, 40, 7), 'C': ('9000系', 9000, 2, 1990, 26, 5), 'L': ('ED50形', 0, 2, 1978, 6, 3)}.items():
        for i in range(1, need[t] + SPARE[t] + 1):
            forms.append({'id': f'{base + i}F' if t != 'L' else f'ED50-{i}', 'type': t, 'series': sname, 'cars': cars,
                          'built': y0 + ((i - 1) * step) % span, 'status': '在籍', 'pin': '', 'note': ''})
    with open(os.path.join(ROOT, 'data', 'formations.json'), 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join(json.dumps(x, ensure_ascii=False) for x in forms) + '\n]\n')
    print('formations', len(forms), dict(zip(series, per)))
