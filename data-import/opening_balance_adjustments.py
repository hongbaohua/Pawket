# -*- coding: utf-8 -*-
# 2026-07-21 Ivy提供各帳戶目前的真實餘額，跟App算出來的餘額（沒有期初餘額欄位，
# 純粹加總所有交易）有落差，用「手動新增一筆最早日期的調整交易」來補這個落差，
# 不改資料結構（跟AccountBalances.tsx footer提示的邏輯一致）。
#
# 計算方式：用同一套 handleMatchAllAccounts 的規則（App.tsx）算出「這批1728筆資料
# 匯入後，這個帳戶會被算出多少錢」，Ivy給的實際餘額 - 這個算出來的餘額 = 調整金額。
# 中國信託 Ivy確認過算出來的就是對的，不用調整；現金一開始說之後才會告訴我，
# 2026-07-21稍晚補了現金目前實際持有金額，一併加進來。
import json, uuid

ROOT = r'C:\Users\Master\Projects\Pawket\Pawket'

# (帳戶名稱, 調整金額, 這筆資料計算後預期落在該帳戶的日期基準點——用比所有真實交易更早的日期)
ADJUSTMENTS = [
    ('中華郵政', 39602, '2020-07-01'),   # 算出-19692，Ivy說115/07/17實際是19910
    ('二技悠遊卡', 20, '2023-09-01'),     # 算出153，Ivy說實際是173
    ('五專悠遊卡', 16, '2020-01-01'),     # 這份資料完全沒有，Ivy說實際是16(全新帳戶)
    ('MyCard', 31, '2023-01-01'),         # 算出55，Ivy說實際是86
    ('麥當勞點點卡', -66, '2023-01-01'),  # 算出71，Ivy說實際是5（算出來比實際多，要扣66）
    ('悠遊付錢包', 969, '2020-01-01'),    # 這份資料完全沒有，Ivy說實際是969(全新帳戶)
    ('現金', 229775, '2023-01-01'),       # 算出-218399，Ivy說目前實際持有11376
]

# 現金沒有專屬的(支付:X)標籤規則，是靠 originalText 前綴「現金支出日記帳匯入」
# 落到 handleMatchAllAccounts 既有的預設規則，所以這筆要用那個前綴、不能用(支付:現金)標籤
# (App.tsx 的 paymentTagToAccountName 對照表裡沒有「現金」這個key，用了會變成「未知標籤」)。
CASH_PREFIX = '現金支出日記帳匯入'

records = []
for name, delta, date in ADJUSTMENTS:
    if delta == 0:
        continue
    is_income = delta > 0
    original_text = (
        f'{CASH_PREFIX} | 期初餘額調整(手動,依Ivy 2026-07-21提供的實際持有金額校正)'
        if name == '現金'
        else f'期初餘額調整(手動,依Ivy 2026-07-21提供的實際餘額校正)(支付:{name})'
    )
    records.append({
        'id': str(uuid.uuid4()),
        'date': date,
        'merchant': '期初餘額調整',
        'originalText': original_text,
        'amount': abs(delta),
        'type': 'income' if is_income else 'expense',
        'category': (
            {'l1': 'Income', 'l2': '其他', 'l3': ''} if is_income
            else {'l1': 'Variable', 'l2': '其他雜項', 'l3': ''}
        ),
        'confidence': 1,
        'isVerified': True,
        'isSplit': False,
        'note': f'App算出的{name}餘額 vs Ivy提供的實際餘額之間的落差，一次性補齊',
    })

OUT = ROOT + r'\data-import\opening_balance_adjustments.json'
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(records, f, ensure_ascii=False, indent=1)
print('產生', len(records), '筆期初餘額調整交易')
for r in records:
    print(' ', r['merchant'], r['type'], r['amount'], r['originalText'])
