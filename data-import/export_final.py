import json, uuid, os

HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(HERE, 'final_records.json'), 'r', encoding='utf-8') as f:
    records = json.load(f)

income_expense_txs = []
transfer_txs = []
type_label = {'LINE PAY': 'LINE PAY', 'VISA': 'VISA', '方便付': '方便付', '轉入': '轉入', '轉出': '轉出', '利息': '利息', '提款': '提款', '存款': '存款'}

for r in records:
    cat = r['category']
    note = r.get('note')
    original_text_parts = [f"中信對帳單匯入 row{r['row']}", f"type={r['type']}"]
    if note:
        original_text_parts.append(f"備註:{note}")
    original_text = ' | '.join(original_text_parts)

    if r['nature'] in ('income', 'expense'):
        tx = {
            'id': str(uuid.uuid4()),
            'date': r['date'],
            'merchant': r['merchant'] or '(無商家名稱)',
            'originalText': original_text,
            'amount': abs(r['amount']),
            'type': r['nature'],
            'category': {'l1': cat['l1'], 'l2': cat['l2'], 'l3': cat['l3']},
            'confidence': 1,
            'isVerified': True,
            'isSplit': False,
        }
        income_expense_txs.append(tx)
    else:  # transfer
        tx = {
            'id': str(uuid.uuid4()),
            'date': r['date'],
            'amount': abs(r['amount']),
            'transferDirection': r['transfer_dir'],  # 'CTBC->CASH' or 'CASH->CTBC'
            'originalText': original_text,
        }
        transfer_txs.append(tx)

out = {'transactions': income_expense_txs, 'goals': []}
with open(os.path.join(os.path.dirname(HERE), '匯入_中信對帳_775筆.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

with open(os.path.join(HERE, 'pending_transfers.json'), 'w', encoding='utf-8') as f:
    json.dump(transfer_txs, f, ensure_ascii=False, indent=2)

print('income/expense:', len(income_expense_txs), 'transfers pending:', len(transfer_txs))

# sanity totals
total_income = sum(t['amount'] for t in income_expense_txs if t['type']=='income')
total_expense = sum(t['amount'] for t in income_expense_txs if t['type']=='expense')
print('total income:', total_income, 'total expense:', total_expense)
