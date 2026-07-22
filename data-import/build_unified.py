# -*- coding: utf-8 -*-
import json, os

ROOT = r'C:\Users\Master\Projects\Pawket\Pawket'
HERE = os.path.join(ROOT, 'data-import')

with open(os.path.join(HERE, 'ctbc_final_merged.json'), encoding='utf-8') as f:
    ctbc = json.load(f)
with open(os.path.join(ROOT, '匯入_中華郵政_對帳.json'), encoding='utf-8') as f:
    postal = json.load(f)['transactions']
with open(os.path.join(HERE, 'cash_2023_2024_records.json'), encoding='utf-8') as f:
    cash = json.load(f)
with open(os.path.join(HERE, 'easycard_records.json'), encoding='utf-8') as f:
    easycard = json.load(f)['transactions']
adjustments_path = os.path.join(HERE, 'opening_balance_adjustments.json')
adjustments = []
if os.path.exists(adjustments_path):
    with open(adjustments_path, encoding='utf-8') as f:
        adjustments = json.load(f)

all_txs = ctbc + postal + cash + easycard + adjustments

# id 不能重複，確認一下
ids = [t['id'] for t in all_txs]
assert len(ids) == len(set(ids)), f'重複id! {len(ids)} vs {len(set(ids))}'

OUT = os.path.join(ROOT, '匯入_統整全部.json')
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump({'transactions': all_txs, 'goals': []}, f, ensure_ascii=False, indent=1)

def summarize(name, txs):
    exp = sum(t['amount'] for t in txs if t['type'] == 'expense')
    inc = sum(t['amount'] for t in txs if t['type'] == 'income')
    trf = sum(t['amount'] for t in txs if t['type'] == 'transfer')
    dates = sorted(t['date'] for t in txs)
    print(f'{name}: {len(txs)}筆 (expense={exp:.0f} income={inc:.0f} transfer={trf:.0f}) 日期範圍 {dates[0]}~{dates[-1]}')

print('=== 統整結果 ===')
summarize('中信', ctbc)
summarize('中華郵政', postal)
summarize('現金支出', cash)
summarize('悠遊卡', easycard)
if adjustments:
    summarize('期初餘額調整', adjustments)
summarize('全部合計', all_txs)
print('總筆數:', len(all_txs))
