# -*- coding: utf-8 -*-
# 2026-07-23 全面資料查核 Phase 2 準備工作：抓出不重複商家清單，分三類：
# A) Ivy自己在4-9.json標過分類的(視為已確認，不用查證)
# B) categorize_rules.py關鍵字規則猜的(有一定根據，但不是Ivy親自確認，值得查證)
# C) 兩者都不是(完全靠AI猜測/其他來源，最需要優先網路查證)
# 依出現次數+總金額排序，輸出成人類可讀的review清單，供Phase 2逐一查證用。
import json, sys, io
sys.path.insert(0, '.')
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = r'C:\Users\Master\Projects\Pawket'
UNIFIED_PATH = ROOT + r'\Pawket\匯入_統整全部.json'
OLD_JSON_PATH = ROOT + r'\對帳資料\Ivy手標歷史分類參考\4-9.json'

FULLWIDTH_OPEN = chr(0xFF08)
FULLWIDTH_CLOSE = chr(0xFF09)


def norm(s):
    if not s or not isinstance(s, str):
        return ''
    chars_to_strip = ' \t-()_.' + FULLWIDTH_OPEN + FULLWIDTH_CLOSE
    return ''.join(c for c in s if c not in chars_to_strip).lower()


with open(OLD_JSON_PATH, encoding='utf-8') as f:
    old_data = json.load(f)
old_merchants = set(norm(t['merchant']) for t in old_data['transactions'] if t.get('merchant'))

from categorize_rules import RULES, apply_rules

with open(UNIFIED_PATH, encoding='utf-8') as f:
    data = json.load(f)
txs = data['transactions'] if isinstance(data, dict) else data
non_transfer = [t for t in txs if t['type'] != 'transfer']

stats = {}
for t in non_transfer:
    m = t['merchant']
    if m not in stats:
        stats[m] = {'count': 0, 'total': 0.0, 'cats': Counter(), 'sample_id': t['id']}
    stats[m]['count'] += 1
    stats[m]['total'] += t['amount']
    cat = (t['category']['l1'], t['category']['l2'], t['category'].get('l3', ''))
    stats[m]['cats'][cat] += 1

groups = {'A_ivy_confirmed': [], 'B_keyword_rule': [], 'C_needs_verification': []}
for m, s in stats.items():
    top_cat = s['cats'].most_common(1)[0][0]
    entry = (m, s['count'], round(s['total'], 0), top_cat)
    nm = norm(m)
    if nm in old_merchants:
        groups['A_ivy_confirmed'].append(entry)
    elif apply_rules(m):
        groups['B_keyword_rule'].append(entry)
    else:
        groups['C_needs_verification'].append(entry)

for g in groups:
    groups[g].sort(key=lambda e: -e[1] * 1 - e[2] * 0.001)  # 主要依出現次數排序，次要金額

print(f'總不重複商家數: {len(stats)}')
print(f'A) Ivy自己標過分類(4-9.json)，不用查證: {len(groups["A_ivy_confirmed"])}')
print(f'B) categorize_rules.py關鍵字規則猜的: {len(groups["B_keyword_rule"])}')
print(f'C) 完全沒有確認來源，優先查證: {len(groups["C_needs_verification"])}')
print()
print('=== C組(優先查證)，依出現次數排序 ===')
for m, cnt, total, cat in groups['C_needs_verification']:
    print(f'{cnt:>4}筆 ${total:>8.0f}  {cat}  {m}')
print()
print('=== B組(關鍵字規則猜的，次優先)，依出現次數排序 ===')
for m, cnt, total, cat in groups['B_keyword_rule']:
    print(f'{cnt:>4}筆 ${total:>8.0f}  {cat}  {m}')

with open(ROOT + r'\Pawket\data-import\merchant_audit_list.json', 'w', encoding='utf-8') as f:
    json.dump(groups, f, ensure_ascii=False, indent=1)
