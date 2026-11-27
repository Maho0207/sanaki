#!/usr/bin/env python3
"""ワンマン区間の整理券・運賃データ

使い方: python3 tools/build_oneman.py tools/oneman.xlsx
入力:  整理券データ(シートごとに 整理券番号・駅名・駅員・備考)、data/network.json・distances.json・stations.json・fare.csv
出力:  data/oneman.json                         サイト用(整理券番号・駅員・運賃)
       downloads/運賃表_<地区>.xlsx              お客さま向け運賃表(三角表)
       downloads/整理券対照表_業務用.xlsx          業務用(整理券番号↔乗車駅、運賃表示器の表)
"""
import json, os, re, sys, heapq, math
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'oneman.xlsx')
J = lambda n: json.load(open(os.path.join(ROOT, 'data', n), encoding='utf-8'))
net, dist, yomi = J('network.json'), J('distances.json'), J('stations.json')
S = net['stations']
LS = {l['id']: [S[x] for x in l['stations']] for l in net['lines']}
fare_tbl = []
for ln in open(os.path.join(ROOT, 'data', 'fare.csv'), encoding='utf-8-sig'):
    c = ln.strip().split(',')
    if len(c) >= 2 and re.fullmatch(r'\d+(\.\d+)?', c[0]) and re.fullmatch(r'\d+', c[1]): fare_tbl.append((float(c[0]), int(c[1])))
fare_tbl.sort()
def fare(km):
    k = max(1, math.ceil(km - 1e-9))
    for lim, yen in fare_tbl:
        if k <= lim: return yen
    return fare_tbl[-1][1]

# 地区の設定(シート名 → 路線と区間)
AREAS = [
    {'sheet': '桜川東越地区', 'id': 'sakura', 'name': '桜川・東越地区', 'lines': [3, 4],
     'sections': ['3号線 増森〜桜川口〜雲平', '4号線 桜川口〜菜川']},
    # 天連湖〜夜越温泉は機関車けん引の客車列車で必ず車掌が乗務するため対象外
    {'sheet': '8号線', 'id': 'amazura', 'name': '8号線 天連峡谷線', 'lines': [8], 'sections': ['8号線 天連町〜天連湖(天連湖〜夜越温泉は客車列車・車掌乗務のため対象外)']},
]
STAFF = {'〇': '終日有人', '○': '終日有人', '△': '一部時間帯のみ駅員在中', '×': '終日無人', '?': '情報なし'}

def graph(lines):
    g = {}
    for L in lines:
        sts, km = LS[L], dist[str(L)]
        for i in range(len(sts) - 1):
            d = abs(km[i + 1] - km[i])
            g.setdefault(sts[i], {})[sts[i + 1]] = d; g.setdefault(sts[i + 1], {})[sts[i]] = d
    return g
def dijkstra(g, s):
    D = {s: 0.0}; q = [(0.0, s)]
    while q:
        d, u = heapq.heappop(q)
        if d > D[u]: continue
        for v, w in g[u].items():
            if d + w < D.get(v, 1e9): D[v] = d + w; heapq.heappush(q, (d + w, v))
    return D

wb = openpyxl.load_workbook(SRC, data_only=True)
out = {'legend': STAFF, 'areas': []}
for A in AREAS:
    rows = [r for r in wb[A['sheet']].iter_rows(min_row=2, values_only=True) if r[1]]
    given = {str(r[1]).strip(): (int(r[0]), str(r[2] or '').strip(), str(r[3] or '').strip()) for r in rows}
    # 整理券データにある駅だけが対象(データに無い駅はワンマン区間外)
    bad = [x for x in given if not any(x in LS[L] for L in A['lines'])]
    if bad: raise SystemExit(f"{A['name']}: 路線に無い駅があります {bad}")
    order = sorted(given, key=lambda x: given[x][0])
    g = graph(A['lines'])
    stations, missing, nxt = [], [], max(v[0] for v in given.values()) + 1
    for x in order:
        no, staff, note = given[x]
        staff = '〇' if staff == '○' else staff
        line = next(L for L in A['lines'] if x in LS[L])
        stations.append({'no': no, 'name': x, 'yomi': yomi.get(x, ''), 'line': line, 'staff': staff, 'staffNote': note})
    stations.sort(key=lambda s: s['no'])
    base = dijkstra(g, stations[0]['name'])
    for s in stations: s['km'] = round(base[s['name']], 1)
    names = [s['name'] for s in stations]
    kmm = [[round(dijkstra(g, a)[b], 1) for b in names] for a in names]
    fares = [[0 if i == j else fare(kmm[i][j]) for j in range(len(names))] for i in range(len(names))]
    out['areas'].append({'id': A['id'], 'name': A['name'], 'lines': A['lines'], 'sections': A['sections'],
                         'stations': stations, 'km': kmm, 'fares': fares, 'missing': missing})
    print(A['name'], len(stations), '駅')
with open(os.path.join(ROOT, 'data', 'oneman.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------ Excel
thin = Side(style='thin', color='999999'); B = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD = PatternFill('solid', fgColor='0E2A47'); SUB = PatternFill('solid', fgColor='E7EEF5'); ALT = PatternFill('solid', fgColor='F7F5F0')
WHITE = Font(color='FFFFFF', bold=True); BOLD = Font(bold=True)
FONT = 'Meiryo'

def setup_print(ws, landscape=True):
    ws.page_setup.orientation = 'landscape' if landscape else 'portrait'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4 if hasattr(ws, 'PAPERSIZE_A4') else 9
    ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True

for area in out['areas']:
    st = area['stations']; n = len(st)
    wbo = openpyxl.Workbook(); ws = wbo.active; ws.title = '運賃表'
    ws['A1'] = f"早菜島軌道 {area['name']} 運賃表(大人・普通運賃)"; ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = f"対象区間: {' / '.join(area['sections'])}  ※ ワンマン列車をご利用の際は、乗車時に整理券をお取りください。"
    ws['A3'] = '※ 早菜島軌道は架空の鉄道です。この運賃表は創作物で、実際に運賃が請求されることはありません。'
    ws['A3'].font = Font(color='C92A2A')
    # 三角表: 対角線に駅名、左下に運賃
    r0 = 5
    for i, s in enumerate(st):
        c = ws.cell(r0 + i, 1 + i, s['name']); c.font = WHITE; c.fill = HEAD; c.border = B
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True, shrink_to_fit=True)
        for j in range(i):
            v = ws.cell(r0 + i, 1 + j, area['fares'][i][j]); v.border = B; v.alignment = Alignment(horizontal='center')
            v.number_format = '#,##0'
            if (i + j) % 2: v.fill = ALT
    for j in range(n): ws.column_dimensions[get_column_letter(1 + j)].width = 6.2
    for i in range(n): ws.row_dimensions[r0 + i].height = 30
    ws.cell(r0 + n + 1, 1, '見方: 乗車駅と降車駅の名前から、それぞれ斜め下・左へたどって交わるところが運賃です(円)。')
    setup_print(ws, False)
    ws2 = wbo.create_sheet('駅一覧')
    hdr = ['整理券番号', '駅名', '読み', '路線', f"{st[0]['name']}からのキロ", '駅員', '駅員在中時間']
    for j, h in enumerate(hdr): c = ws2.cell(1, 1 + j, h); c.font = WHITE; c.fill = HEAD; c.border = B
    for i, s in enumerate(st):
        vals = [s['no'], s['name'], s['yomi'], f"{s['line']}号線", s['km'], STAFF.get(s['staff'], s['staff']), s['staffNote']]
        for j, v in enumerate(vals): c = ws2.cell(2 + i, 1 + j, v); c.border = B
    for j, w in enumerate([10, 14, 18, 8, 14, 22, 40]): ws2.column_dimensions[get_column_letter(1 + j)].width = w
    ws2.freeze_panes = 'A2'; setup_print(ws2, False)
    wbo.save(os.path.join(ROOT, 'downloads', f"運賃表_{area['name'].split()[0]}.xlsx"))

# 業務用
wbs = openpyxl.Workbook(); first = True
for area in out['areas']:
    st = area['stations']; n = len(st)
    ws = wbs.active if first else wbs.create_sheet(); first = False
    ws.title = f"{area['name'].split()[0]}_対照表"[:31]
    ws['A1'] = f"【業務用】{area['name']} 整理券番号 対照表"; ws['A1'].font = Font(bold=True, size=13)
    ws['A2'] = '駅員: 〇=終日有人 △=一部時間帯のみ在中(在中時間参照) ×=終日無人 ?=データなし'
    hdr = ['整理券番号', '乗車駅', '読み', '路線', 'キロ程', '駅員', '駅員在中時間・備考']
    for j, h in enumerate(hdr): c = ws.cell(4, 1 + j, h); c.font = WHITE; c.fill = HEAD; c.border = B
    for i, s in enumerate(st):
        vals = [s['no'], s['name'], s['yomi'], f"{s['line']}号線", s['km'], s['staff'], s['staffNote']]
        for j, v in enumerate(vals):
            c = ws.cell(5 + i, 1 + j, v); c.border = B
            if s['staff'] == '?': c.fill = PatternFill('solid', fgColor='FFF3BF')
    for j, w in enumerate([11, 14, 24, 8, 8, 6, 44]): ws.column_dimensions[get_column_letter(1 + j)].width = w
    ws.freeze_panes = 'A5'; setup_print(ws, False)
    # 運賃表示器: 行=降車駅、列=整理券番号
    wm = wbs.create_sheet(f"{area['name'].split()[0]}_運賃表示"[:31])
    wm['A1'] = f"【業務用】{area['name']} 運賃表示器 対照表(行: 降車駅 / 列: 整理券番号 → 運賃)"; wm['A1'].font = Font(bold=True, size=13)
    c = wm.cell(3, 1, '降車駅 \\ 整理券'); c.font = WHITE; c.fill = HEAD; c.border = B
    for j, s in enumerate(st):
        c = wm.cell(3, 2 + j, s['no']); c.font = WHITE; c.fill = HEAD; c.border = B; c.alignment = Alignment(horizontal='center')
    for i, s in enumerate(st):
        c = wm.cell(4 + i, 1, s['name']); c.font = BOLD; c.fill = SUB; c.border = B
        for j in range(n):
            v = wm.cell(4 + i, 2 + j, '−' if i == j else area['fares'][j][i]); v.border = B; v.alignment = Alignment(horizontal='center')
            v.number_format = '#,##0'
            if i % 2: v.fill = ALT
    wm.column_dimensions['A'].width = 14
    for j in range(n): wm.column_dimensions[get_column_letter(2 + j)].width = 6
    wm.freeze_panes = 'B4'; setup_print(wm)
wbs.save(os.path.join(ROOT, 'downloads', '整理券対照表_業務用.xlsx'))
print('downloads:', os.listdir(os.path.join(ROOT, 'downloads')))
