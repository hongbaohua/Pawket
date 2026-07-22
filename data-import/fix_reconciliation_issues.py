# -*- coding: utf-8 -*-
# 2026-07-21 逐一比對四批真實資料 vs 原始xlsx/csv/pdf 後，修正抓到的3個真的錯誤：
# 1. cash_2023_2024_records.json row571(全家)：價錢欄是文字公式"59+35"，原本沒被計算，amount誤存成0，應為94
# 2. cash_2023_2024_records.json row680(七盞茶)：原始表格該列從「地點」欄開始整體多一欄空白，
#    造成解析對齊錯位，amount誤存成0（真正金額50跑進note欄位），品項「香蕉凍奶茶」跟折扣備註
#    「環保杯-$5、學生證-$5」都遺失，這裡救回來
# 3. 匯入_中華郵政_對帳.json 漏了115/05/28「卡片存款」$5,000 這筆(用餘額欄位逐列驗證過，
#    這筆存在且金額正確，只是完全沒被納入25筆最終匯入檔)，商家名稱不確定(不像2月那筆有跟Ivy
#    確認過是「過年紅包」)，先用低信心度佔位，等Ivy確認
import json, uuid

ROOT = r'C:\Users\Master\Projects\Pawket\Pawket'

# --- 修正1+2: 現金支出2024 ---
path = ROOT + r'\data-import\cash_2023_2024_records.json'
with open(path, encoding='utf-8') as f:
    cash = json.load(f)

fixed = 0
for r in cash:
    if r['originalText'] == '現金支出日記帳匯入 sheet2024 row571':
        assert r['amount'] == 0
        r['amount'] = 94  # 59+35，原始價錢欄公式沒被計算
        fixed += 1
    if r['originalText'] == '現金支出日記帳匯入 sheet2024 row680':
        assert r['amount'] == 0
        r['amount'] = 50
        r['items'] = [{'name': '香蕉凍奶茶'}]
        r['note'] = '環保杯-$5、學生證-$5'
        fixed += 1
assert fixed == 2, f'預期修正2筆，實際{fixed}筆'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(cash, f, ensure_ascii=False, indent=1)
print('現金支出2024修正完成:', fixed, '筆')

# --- 修正3: 中華郵政補漏 ---
path2 = ROOT + r'\匯入_中華郵政_對帳.json'
with open(path2, encoding='utf-8') as f:
    postal = json.load(f)

new_record = {
    'id': str(uuid.uuid4()),
    'date': '2026-05-28',
    'merchant': '存款(待確認用途)',
    'originalText': '中華郵政對帳單匯入 | 115/05/28 卡片存款 (比對CSV餘額欄位時發現原本25筆漏了這筆，用途不確定，需Ivy確認)',
    'amount': 5000,
    'type': 'income',
    'category': {'l1': 'Income', 'l2': '其他', 'l3': ''},
    'confidence': 0.3,
    'isVerified': False,
    'isSplit': False,
}
# 避免重複補漏(如果之前跑過這個腳本)
if not any(t.get('date') == '2026-05-28' and t.get('amount') == 5000 for t in postal['transactions']):
    postal['transactions'].append(new_record)
    with open(path2, 'w', encoding='utf-8') as f:
        json.dump(postal, f, ensure_ascii=False, indent=1)
    print('中華郵政補上1筆漏匯入的存款，現在共', len(postal['transactions']), '筆')
else:
    print('中華郵政那筆補漏記錄已存在，跳過')
