# -*- coding: utf-8 -*-
# 商家名稱去重：Ivy 指出「同一個商家常常寫法不一樣（例如 mamamiya / Mamamiya、
# 戀與製作人 / 《戀與製作人》），系統要自己檢查出來、列給她確認合併，不要放著
# 一堆別名不管」。這支腳本對 reparse_merchant_items.py 重新解析後的商家名單
# （加上沒被改到的既有商家）做一次正規化模糊比對聚類，只負責「找出疑似同一商家的
# 不同寫法」，實際要合併成哪個寫法由 Ivy 自己在 merchant_dedup_map.json 裡確認、
# 填寫 canonical 欄位，這支腳本不會自己猜一個就直接套用。
#
# 這是這次775筆資料的一次性去重，不是路線圖階段5/6要做的「新交易進來時即時模糊
# 比對」完整系統——那個之後跟對帳模組一起做，範圍更大（要處理銀行截斷代碼、
# 完全沒看過的新商家等等）。
#
# 產出：
#   merchant_dedup_review.txt — 人類可讀的疑似同商家群組列表
#   merchant_dedup_map.json   — 給 Ivy 填寫用的模板，canonical 預設是空字串，
#                                不會自動套用；Ivy 看過某群組確實是同一商家，把
#                                canonical 填成她想統一的寫法之後，才會被
#                                App.tsx 的「套用商家別名合併(一次性)」按鈕套用。
#
# 使用方式：
#   1. 先跑過 reparse_merchant_items.py，產生 reparse_corrections.json
#   2. python merchant_dedup.py
#   3. Ivy 看 merchant_dedup_review.txt，覺得是同一商家的群組，去
#      merchant_dedup_map.json 把該群組的 canonical 填上統一寫法（不確定的群組
#      canonical 留空，那組就不會被套用）
#   4. 存檔後，去 App「罐罐明細本」按「套用商家別名合併(一次性)」

import json, os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IMPORTED_PATH = os.path.join(ROOT, '匯入_中信對帳_775筆.json')
DISCOUNT_CORRECTIONS_PATH = os.path.join(HERE, 'discount_corrections.json')
REPARSE_CORRECTIONS_PATH = os.path.join(HERE, 'reparse_corrections.json')
REVIEW_PATH = os.path.join(HERE, 'merchant_dedup_review.txt')
MAP_PATH = os.path.join(HERE, 'merchant_dedup_map.json')

FULLWIDTH_OPEN = chr(0xFF08)
FULLWIDTH_CLOSE = chr(0xFF09)


def norm(s):
    """跟 build_import2.py 裡同一套正規化邏輯：去空白/括號/連字號、轉小寫，
    用來判斷「寫法不同但可能是同一個商家」。"""
    if not s or not isinstance(s, str):
        return ''
    chars_to_strip = ' \t-()_.《》「」' + FULLWIDTH_OPEN + FULLWIDTH_CLOSE
    result = ''.join(c for c in s if c not in chars_to_strip)
    return result.lower()


with open(IMPORTED_PATH, encoding='utf-8') as f:
    imported = json.load(f)['transactions']

with open(DISCOUNT_CORRECTIONS_PATH, encoding='utf-8') as f:
    discount_corrections = {c['id']: c for c in json.load(f)}

reparse_corrections = {}
if os.path.exists(REPARSE_CORRECTIONS_PATH):
    with open(REPARSE_CORRECTIONS_PATH, encoding='utf-8') as f:
        reparse_corrections = {c['id']: c for c in json.load(f)}

# 算出「目前最新」的商家名稱：reparse > discount correction > 原始匯入文字
merchant_counter = Counter()
for tx in imported:
    rc = reparse_corrections.get(tx['id'])
    dc = discount_corrections.get(tx['id'])
    if rc:
        merchant = rc['merchant']
    elif dc:
        merchant = dc['merchant']
    else:
        merchant = tx['merchant']
    merchant = (merchant or '').strip()
    if merchant:
        merchant_counter[merchant] += 1

merchants = list(merchant_counter.keys())
normed = {m: norm(m) for m in merchants}

# Union-Find 聚類：正規化後完全相同、或其中一個字串包含另一個（長度至少2才比對，
# 避免短字串誤判），視為同一群。
parent = {m: m for m in merchants}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb


by_norm = {}
for m in merchants:
    by_norm.setdefault(normed[m], []).append(m)
for group in by_norm.values():
    for i in range(1, len(group)):
        union(group[0], group[i])

for i, m1 in enumerate(merchants):
    n1 = normed[m1]
    if len(n1) < 2:
        continue
    for m2 in merchants[i + 1:]:
        n2 = normed[m2]
        if len(n2) < 2:
            continue
        if n1 != n2 and (n1 in n2 or n2 in n1):
            union(m1, m2)

clusters = {}
for m in merchants:
    clusters.setdefault(find(m), []).append(m)

groups = [sorted(v, key=lambda m: -merchant_counter[m]) for v in clusters.values() if len(v) > 1]
groups.sort(key=lambda g: -sum(merchant_counter[m] for m in g))

with open(REVIEW_PATH, 'w', encoding='utf-8') as f:
    f.write(f'疑似同一商家、寫法不同的群組數: {len(groups)}\n')
    f.write('（只是「疑似」，可能誤判成群組的不同商家，Ivy 自己判斷要不要合併）\n\n')
    for g in groups:
        f.write(' / '.join(f"{m}({merchant_counter[m]}筆)" for m in g) + '\n')

dedup_map = [{'canonical': '', 'suggested': g[0], 'variants': g} for g in groups]
with open(MAP_PATH, 'w', encoding='utf-8') as f:
    json.dump(dedup_map, f, ensure_ascii=False, indent=2)

print(f'done. {len(groups)} groups found, written to {REVIEW_PATH} / {MAP_PATH}')
