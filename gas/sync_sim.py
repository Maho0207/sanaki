#!/usr/bin/env python3
"""js/sim.js を変更したら実行: gas/Code.gs 末尾の同じ計算部分を最新にする"""
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mark = "// ================================================================== js/sim.js と同じ計算(変更するときは両方を揃える)"
code = open(os.path.join(root, 'gas', 'Code.gs'), encoding='utf-8').read()
sim = open(os.path.join(root, 'js', 'sim.js'), encoding='utf-8').read()
sim = sim[sim.index('export function hashStr'):].replace('export function', 'function')
code = code[:code.index(mark)] + mark + "\n// (gas/sync_sim.py で js/sim.js から自動コピー)\n" + sim
open(os.path.join(root, 'gas', 'Code.gs'), 'w', encoding='utf-8').write(code)
print('Code.gs を更新しました')
