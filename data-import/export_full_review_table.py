# -*- coding: utf-8 -*-
# 2026-07-23 全面資料查核 Phase 2：把全部1735筆交易依照系統的完整欄位匯出成Excel，
# 給Ivy逐筆審核。這次查證後「確定要改」的直接在表格裡改好(同時在AI查核備註欄寫清楚
# 改了什麼、為什麼)，「不確定/需要Ivy補充」的維持原樣但在備註欄提出問題。
# Ivy確認過表格沒問題後，才會依照這份表格產生fix_009.sql實際套用到Supabase。
import json, sys, io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = r'C:\Users\Master\Projects\Pawket'
UNIFIED_PATH = ROOT + r'\Pawket\匯入_統整全部.json'
OUT_PATH = ROOT + r'\Pawket\data-import\全面資料查核表_2026-07-23.xlsx'

with open(UNIFIED_PATH, encoding='utf-8') as f:
    data = json.load(f)
txs = data['transactions'] if isinstance(data, dict) else data

# ============ 這次Phase 2查證後，確定要改的欄位修正 ============
# key = id, value = 要覆蓋的欄位 + 備註說明
CONFIRMED_FIXES = {
    # 波妮國際：WebSearch查證公司登記資料，確認是內衣零售業(台中北區登記)，
    # 不是「其他雜項」。
    None: None,  # placeholder，實際用merchant+date+amount比對找id，見下方
}

# 用商家+日期+金額組合定位到id(比直接寫死id更不容易對錯，因為這幾筆是這次現場查出來的)
def find_one(merchant, date, amount):
    matches = [t for t in txs if t['merchant'] == merchant and t['date'] == date and abs(t['amount'] - amount) < 0.01]
    if len(matches) != 1:
        print(f'WARNING: {merchant} {date} {amount} 找到{len(matches)}筆，預期1筆', file=sys.stderr)
        return None
    return matches[0]['id']

fixes_applied = {}

t = find_one('波妮國際', '2023-10-23', 1161)
if t:
    fixes_applied[t] = {
        'l1': 'Variable', 'l2': '服飾美妝', 'l3': '',
        '備註': 'WebSearch查證「波妮國際有限公司」是登記在台中北區的內衣零售業公司，原分類「其他雜項」改成「服飾美妝」。'
    }

t = find_one('樂士Luxe3C', '2026-05-21', 390)
if t:
    fixes_applied[t] = {
        'l1': 'Variable', 'l2': '3C電子', 'l3': '',
        '備註': '品項是「Type-C轉接線」，明顯是3C電子配件，原分類「服飾美妝」看起來是誤植，改成「3C電子」。'
    }

t = find_one('中友', '2025-09-25', 580)
if t:
    fixes_applied[t] = {
        'l1': 'Variable', 'l2': '休閒娛樂', 'l3': '玩具',
        '備註': '品項是「柯南盲盒×2」，跟同一個商家「中友」其他7筆柯南盲盒紀錄都歸「休閒娛樂/玩具」不一致，這筆原本是「生活日用/百貨公司」，改成跟其他7筆一致。'
    }

t = find_one('先喝道', '2026-03-26', 65)
if t:
    fixes_applied[t] = {
        'l1': 'Variable', 'l2': '餐飲食品', 'l3': '飲料',
        '備註': 'WebSearch查證「先喝道(TAOTAOTEA)」是古典玫瑰園集團旗下的手搖飲品牌，不是電影票，原分類「休閒娛樂/電影票」改成「餐飲食品/飲料」。'
    }

for merchant, date, amount in [('速風達', '2026-07-03', 774), ('速風達', '2026-07-05', 142)]:
    t = find_one(merchant, date, amount)
    if t:
        fixes_applied[t] = {
            'specialTag': {'type': 'proxy_purchase', 'counterparty': '(待Ivy補充代購對象)', 'note': None},
            '備註': '備註欄寫「代購」/「代購運費」但沒有設定代購性質標記(specialTag)，補上——代購對象欄位需要Ivy補充是誰代購的。'
        }

# ============ 軟性建議/需要Ivy補充資訊的項目，只加備註不改欄位 ============
SOFT_NOTES = {}

t = find_one('知翎文化', '2024-11-30', 957)
if t:
    SOFT_NOTES[t] = '品項是《時光代理人》美術設定集+運費，性質比較像收藏品，軟性建議「其他雜項」改成「休閒娛樂」，但不確定，請Ivy自己判斷。'

t = find_one('高鐵', '2020-07-24', 500)
if t:
    SOFT_NOTES[t] = 'originalText顯示「高鐵智慧型手機Android」，商家/描述混雜不清楚，懷疑是原始PDF對帳單解析時把兩筆資訊黏在一起，Claude Code查不出這筆實際上是什麼消費，請Ivy自己回憶或查證。'

t = find_one('匯款', '2024-03-16', 500)
if t:
    SOFT_NOTES[t] = '品項是PLAVE迷你二輯空專×5，分類「休閒娛樂/專輯」是對的，但商家欄位填的是付款方式「匯款」不是真正商家，建議改成代購/團購主揪的名字或平台名稱，請Ivy補充實際是跟誰/哪個平台買的。'

t = find_one('郵局', '2024-07-15', 216)
if t:
    SOFT_NOTES[t] = '品項是《戀與製作人》珍藏卡×2件，分類「休閒娛樂/收藏卡」是對的，但商家欄位填的是取貨地點「郵局」不是真正商家，建議改成實際購買的商家/代購對象，請Ivy補充。'

t = find_one('統一超商', '2024-11-06', 182)
if t:
    SOFT_NOTES[t] = '同樣是超商消費，這筆分類「生活日用」，但其他7-11/全家的紀錄多半分類「餐飲食品」，可能只是這筆買的東西剛好不是吃的，不確定，列出來供參考，不算錯誤。'

# ============ 套用確定的修正到記憶體中的資料(還沒寫回json，等Ivy看過表格確認) ============
for tx in txs:
    if tx['id'] in fixes_applied:
        fx = fixes_applied[tx['id']]
        if 'l1' in fx:
            tx['category'] = {'l1': fx['l1'], 'l2': fx['l2'], 'l3': fx['l3']}
        if 'specialTag' in fx:
            tx['specialTag'] = fx['specialTag']

print(f'套用了 {len(fixes_applied)} 筆確定修正')
print(f'加了 {len(SOFT_NOTES)} 筆軟性建議備註')

# ============ 匯出Excel ============
def fmt_items(items):
    if not items:
        return ''
    parts = []
    for it in items:
        s = it.get('name', '')
        if it.get('unitPrice') is not None:
            s += f"(${it['unitPrice']}"
            if it.get('quantity') and it['quantity'] != 1:
                s += f"×{it['quantity']}"
            s += ')'
        elif it.get('quantity') and it['quantity'] != 1:
            s += f"×{it['quantity']}"
        if it.get('note'):
            s += f"[{it['note']}]"
        parts.append(s)
    return '; '.join(parts)


def fmt_discounts(discounts):
    if not discounts:
        return ''
    return '; '.join(f"{d['label']}:-${d['amount']}" for d in discounts)


COLUMNS = ['id', 'date', 'merchant', 'type', 'amount', 'grossAmount', 'discounts',
           'l1', 'l2', 'l3', 'paymentChannel', 'items', 'note',
           'specialTag_type', 'specialTag_counterparty', 'specialTag_note',
           'fromAccountId', 'toAccountId', 'originalText', 'AI查核備註']

wb = openpyxl.Workbook()
ws = wb.active
ws.title = '全面資料查核'

header_font = Font(name='Arial', bold=True, color='FFFFFF')
header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
normal_font = Font(name='Arial', size=10)
remark_fill = PatternFill(start_color='FFF2CC', end_color='FFF2CC', fill_type='solid')

for ci, col in enumerate(COLUMNS, start=1):
    cell = ws.cell(row=1, column=ci, value=col)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal='center')

L1_LABEL = {'Fixed': '固定支出', 'Variable': '變動支出', 'Investment': '投資儲蓄', 'Income': '收入帳戶'}

row_i = 2
for tx in sorted(txs, key=lambda t: (t['date'], t['id'])):
    st = tx.get('specialTag') or {}
    remark = ''
    if tx['id'] in fixes_applied:
        remark = '[已修正] ' + fixes_applied[tx['id']]['備註']
    elif tx['id'] in SOFT_NOTES:
        remark = '[請Ivy確認] ' + SOFT_NOTES[tx['id']]

    values = [
        tx['id'], tx['date'], tx['merchant'], tx['type'], tx['amount'],
        tx.get('grossAmount', ''), fmt_discounts(tx.get('discounts')),
        L1_LABEL.get(tx['category']['l1'], tx['category']['l1']), tx['category']['l2'], tx['category'].get('l3', ''),
        tx.get('paymentChannel', ''), fmt_items(tx.get('items')), tx.get('note', ''),
        st.get('type', ''), st.get('counterparty', ''), st.get('note', ''),
        tx.get('fromAccountId', ''), tx.get('toAccountId', ''),
        tx.get('originalText', ''), remark,
    ]
    for ci, v in enumerate(values, start=1):
        cell = ws.cell(row=row_i, column=ci, value=v)
        cell.font = normal_font
        if ci == len(COLUMNS) and remark:
            cell.fill = remark_fill
    row_i += 1

widths = [10, 11, 18, 9, 8, 10, 16, 10, 10, 10, 12, 30, 20, 12, 14, 14, 10, 10, 40, 55]
for ci, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(ci)].width = w

ws.freeze_panes = 'A2'
ws.auto_filter.ref = f'A1:{get_column_letter(len(COLUMNS))}{row_i-1}'

wb.save(OUT_PATH)
print('已輸出:', OUT_PATH)
print('共', row_i - 2, '筆')
