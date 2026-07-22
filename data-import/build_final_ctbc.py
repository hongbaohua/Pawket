# -*- coding: utf-8 -*-
# 把中信775筆(750收支+25轉帳)的所有修正(折扣/重新解析/商家去重)合併成最終版，
# 供這次「清除重來、統一匯入」使用。
import json, uuid, os

ROOT = r'C:\Users\Master\Projects\Pawket\Pawket'
HERE = os.path.join(ROOT, 'data-import')

with open(os.path.join(ROOT, '匯入_中信對帳_775筆.json'), encoding='utf-8') as f:
    imported = json.load(f)['transactions']
with open(os.path.join(HERE, 'discount_corrections.json'), encoding='utf-8') as f:
    discount_corrections = {c['id']: c for c in json.load(f)}
with open(os.path.join(HERE, 'reparse_corrections.json'), encoding='utf-8') as f:
    reparse_corrections = {c['id']: c for c in json.load(f)}
with open(os.path.join(HERE, 'merchant_dedup_map.json'), encoding='utf-8') as f:
    dedup_groups = json.load(f)
with open(os.path.join(HERE, 'pending_transfers.json'), encoding='utf-8') as f:
    pending_transfers = json.load(f)

# 商家去重：用 suggested(出現次數最多的寫法)當 canonical，
# 但排除2組人工核對出來是誤判的(Qburgur/GU 不同商家；全家/鞋全家福 不同商家)
BAD_GROUPS = {frozenset(['Qburgur', 'GU']), frozenset(['全家', '鞋全家福'])}
rename_map = {}
for g in dedup_groups:
    if frozenset(g['variants']) in BAD_GROUPS:
        continue
    canonical = g['suggested']
    for v in g['variants']:
        if v != canonical:
            rename_map[v] = canonical

final_txs = []
for tx in imported:
    merged = dict(tx)
    dc = discount_corrections.get(tx['id'])
    if dc:
        merged['merchant'] = dc['merchant']
        merged['note'] = dc.get('note')
        merged['grossAmount'] = dc.get('grossAmount')
        merged['discounts'] = dc.get('discounts')
    rc = reparse_corrections.get(tx['id'])
    if rc:
        merged['merchant'] = rc['merchant']
        merged['items'] = rc.get('items')
        merged['note'] = rc.get('note')
        merged['specialTag'] = rc.get('specialTag')
    # 去除掉值是 None 的欄位，維持乾淨
    merged = {k: v for k, v in merged.items() if v is not None}
    # 商家去重
    if merged.get('merchant') in rename_map:
        merged['merchant'] = rename_map[merged['merchant']]
    final_txs.append(merged)

# 手動修正：蝦皮-手機 $26308 那筆原本分類不明，Ivy 確認是手機、要跟其他3C產品統一分類
for tx in final_txs:
    if tx.get('amount') == 26308 and any(it.get('name') == '手機' for it in (tx.get('items') or [])):
        tx['category'] = {'l1': 'Variable', 'l2': '3C電子', 'l3': ''}

# 25筆轉帳
for t in pending_transfers:
    direction = t['transferDirection']
    from_name, to_name = ('中國信託', '現金') if direction == 'CTBC->CASH' else ('現金', '中國信託')
    label = f"帳戶互轉：{from_name} → {to_name}"
    final_txs.append({
        'id': t['id'],
        'date': t['date'],
        'merchant': label,
        'originalText': t['originalText'],
        'amount': t['amount'],
        'type': 'transfer',
        'category': {'l1': 'Variable', 'l2': '轉帳', 'l3': ''},
        'confidence': 1,
        'isVerified': True,
        'isSplit': False,
    })

OUT = os.path.join(HERE, 'ctbc_final_merged.json')
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(final_txs, f, ensure_ascii=False, indent=1)

print('total CTBC final:', len(final_txs))
print('rename map size:', len(rename_map))
expense_sum = sum(t['amount'] for t in final_txs if t['type'] == 'expense')
income_sum = sum(t['amount'] for t in final_txs if t['type'] == 'income')
transfer_sum = sum(t['amount'] for t in final_txs if t['type'] == 'transfer')
print('expense:', expense_sum, 'income:', income_sum, 'transfer:', transfer_sum)
