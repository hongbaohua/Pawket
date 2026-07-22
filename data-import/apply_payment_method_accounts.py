# -*- coding: utf-8 -*-
# 2026-07-21 Ivy確認的支付方式歸戶方案：
# - 「儲值」類別、地點=MyCard/點點卡、且支付欄空白(現金付的) -> 這是「用現金買點數」，
#   改成轉帳(現金->MyCard/點點卡)，不要再算一般支出(避免跟下面的花費列雙重計算)
# - 支付欄=悠遊卡 -> 這筆花費是用悠遊卡點數付的，標記歸「二技悠遊卡」
# - 支付欄=MYCARD/My Card/Mycard/MyCard(大小寫不一) -> 標記歸「MyCard」(新帳戶,Ivy要自己建)
# - 支付欄=點點卡 -> 標記歸「點點卡」(新帳戶,Ivy要自己建)
# - 支付欄=全支付/街口支付/LINE PAY/VISA/郵局轉帳 -> 低信心度標記歸「中華郵政」
#   (VISA/郵局轉帳有實際對帳單交叉核對過是這張卡；全支付/街口支付/LINE PAY是猜的，
#   因為專案裡目前只查得到這一張卡，Ivy說要再自己核對明細)
# - 支付欄=文化幣/文化幣、現金/姊VISA -> 標記「不指定」，配對帳戶時要跳過、不要落到預設的現金
#
# 標記方式：不直接寫accountId(帳戶還沒建立、不知道真實UUID)，而是在originalText後面加
# 一段可被handleMatchAllAccounts解析的標籤，例如"(支付:MyCard)"、"(支付:不指定)"。
import json, re, openpyxl

ROOT = r'C:\Users\Master\Projects\Pawket\Pawket'
XLSX = r'C:\Users\Master\Projects\Pawket\對帳資料\新增\2023-2024現金支出.xlsx'

PAY_TO_ACCOUNT = {
    '悠遊卡': '二技悠遊卡',
    'mycard': 'MyCard', 'my card': 'MyCard',
    '點點卡': '麥當勞點點卡',
    '全支付': '中華郵政低信心', '街口支付': '中華郵政低信心',
    'line pay': '中華郵政低信心',
    'visa': '中華郵政', '郵局轉帳': '中華郵政',
    '文化幣': '不指定', '文化幣、現金': '不指定', '姊visa': '不指定',
}

wb = openpyxl.load_workbook(XLSX, data_only=True)
markers = {}  # (sheet, row) -> marker string
mycard_funding_rows = []  # (sheet, row, amount, place) for pattern-A -> 轉帳

for sheet in ('2023', '2024'):
    ws = wb[sheet]
    for r in range(2, ws.max_row + 1):
        pay = ws.cell(row=r, column=2).value
        cat = ws.cell(row=r, column=3).value
        place = ws.cell(row=r, column=4).value
        price = ws.cell(row=r, column=6).value
        if cat == '儲值' and pay is None and isinstance(place, str) and place.strip().lower() in ('mycard', 'my card', '點點卡'):
            target = 'MyCard' if 'card' in place.strip().lower() else '麥當勞點點卡'
            amt = None
            if isinstance(price, str):
                m = re.match(r'^#(\d+)$', price.strip())
                if m:
                    amt = float(m.group(1))
            elif isinstance(price, (int, float)):
                amt = float(price)
            if amt is None:
                item = ws.cell(row=r, column=5).value
                if isinstance(item, (int, float)):
                    amt = float(item)
            mycard_funding_rows.append((sheet, r, amt, target))
            continue
        if isinstance(pay, str) and pay.strip().lower() in PAY_TO_ACCOUNT:
            markers[(sheet, r)] = PAY_TO_ACCOUNT[pay.strip().lower()]

print('pattern-A(儲值funding)列數:', len(mycard_funding_rows))
for x in mycard_funding_rows:
    print('  ', x)
print('pattern-B(支付方式標記)列數:', len(markers))

path = ROOT + r'\data-import\cash_2023_2024_records.json'
with open(path, encoding='utf-8') as f:
    cash = json.load(f)

row_re = re.compile(r'sheet(\d{4}) row(\d+)')
by_row = {}
for rec in cash:
    m = row_re.search(rec['originalText'])
    if m:
        by_row[(m.group(1), int(m.group(2)))] = rec

converted = 0
for sheet, r, amt, target in mycard_funding_rows:
    rec = by_row.get((sheet, r))
    if rec is None:
        print('!! 找不到記錄:', sheet, r)
        continue
    rec['type'] = 'transfer'
    rec['merchant'] = f'帳戶互轉：現金 → {target}'
    rec['category'] = {'l1': 'Variable', 'l2': '轉帳', 'l3': ''}
    rec.pop('items', None)
    rec.pop('note', None)
    if amt is not None:
        rec['amount'] = amt
    converted += 1
print('轉帳轉換完成:', converted, '筆')

tagged = 0
for (sheet, r), target in markers.items():
    rec = by_row.get((sheet, r))
    if rec is None:
        print('!! 找不到記錄:', sheet, r)
        continue
    if '(支付:' in rec['originalText']:
        continue  # 已經標記過，避免重跑重複加
    rec['originalText'] = rec['originalText'] + f'(支付:{target})'
    tagged += 1
print('支付方式標記完成:', tagged, '筆')

with open(path, 'w', encoding='utf-8') as f:
    json.dump(cash, f, ensure_ascii=False, indent=1)
print('已寫回', path)
