# -*- coding: utf-8 -*-
"""
2026-09-21：產生一份「喵喵銀行」的假月結單 HTML，給示範帳號跑餵食核對（對帳）用。

為什麼需要：
  作品集要展示對帳模組真正跑完的「比對結果」畫面（哪幾筆對上、哪幾筆銀行有你沒記、
  哪幾筆你記了銀行還沒入帳），不能只放一張空白的上傳畫面。這支腳本從示範帳號的
  真實資料反推出一份對得起來的月結單，並刻意留下幾筆差異，讓比對結果三種狀態
  都看得到。

  銀行名稱是虛構的「喵喵銀行」，不掛任何真實金融機構的名字。

輸出：
  demo_statement.html（再用 Chrome 轉成 PDF，見 capture_demo_screenshots.mjs）

刻意製造的三種差異：
  1. 銀行有、Pawket 沒有 → 對帳結果會標成「該補記」（missing_manual）
  2. Pawket 有、銀行這期還沒出現，而且已經超過入帳延遲天數 → 「可能記錯了」
  3. Pawket 有、還在入帳延遲區間內 → 「正常等待入帳」
"""
import io
import os
from datetime import date, timedelta

from query_supabase import fetch_all

DEMO_USER = '55024f5d-9a43-468e-a43e-4c24e86990ad'
ACCOUNT_NAME = '喵喵銀行簽帳卡'
PERIOD = ('2026-09-01', '2026-09-19')   # 結單日刻意停在 9/19，之後的交易就不在這份對帳單的範圍內
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'demo_statement.html')

# 銀行有、Pawket 沒記到的那幾筆（對帳結果會標成「官方有紀錄，你可能忘了記」）
BANK_ONLY_ROWS = [
    ('2026-09-12', '悠遊卡自動加值 EASYCARD', 500),
    ('2026-09-16', 'APPLE.COM/BILL ITUNES', 90),
]

# Pawket 有記、但刻意不印進這份對帳單的那幾筆，用來讓另外兩種狀態也出現在畫面上：
#   ・9/19 那筆：距離今天還在入帳延遲天數內 → 「🟡 正常等待入帳」（正常，不用管）
#   ・9/08 那筆：早就超過延遲天數了還沒出現 → 「你記了，但官方紀錄一直沒出現」（要查）
SKIP_ROWS = [
    ('2026-09-19', '兩廳院售票'),
    ('2026-09-08', '燒肉眾'),
]


def main():
    accounts = fetch_all('accounts', f'user_id=eq.{DEMO_USER}&select=id,name')
    acc = next(a for a in accounts if a['name'] == ACCOUNT_NAME)
    txs = fetch_all('transactions',
                    f'user_id=eq.{DEMO_USER}&select=date,merchant,net_amount,type,account_id,'
                    f'from_account_id,to_account_id,deleted_at&order=date.asc')

    rows = []
    for t in txs:
        if t['deleted_at']:
            continue
        if not (PERIOD[0] <= t['date'] <= PERIOD[1]):
            continue
        if (t['date'], t['merchant']) in SKIP_ROWS:
            continue
        amount = float(t['net_amount'])
        if t['type'] == 'expense' and t['account_id'] == acc['id']:
            rows.append((t['date'], t['merchant'], amount, '支出'))
        elif t['type'] == 'income' and t['account_id'] == acc['id']:
            rows.append((t['date'], t['merchant'], amount, '存入'))
        elif t['type'] == 'transfer' and t['from_account_id'] == acc['id']:
            rows.append((t['date'], f"轉出 {t['merchant']}", amount, '支出'))
        elif t['type'] == 'transfer' and t['to_account_id'] == acc['id']:
            rows.append((t['date'], f"轉入 {t['merchant']}", amount, '存入'))

    for d, desc, amt in BANK_ONLY_ROWS:
        rows.append((d, desc, float(amt), '支出'))

    # 銀行入帳日通常比消費日晚一點，這裡統一延後 1 天，剛好落在帳戶設定的 1~3 天延遲區間內，
    # 順便驗證對帳模組「不是比對同一天，而是比對延遲區間」這個設計真的有效。
    def posted(d: str) -> str:
        return (date.fromisoformat(d) + timedelta(days=1)).isoformat()

    rows.sort(key=lambda r: r[0])
    # 只印「入帳日期」一欄：原本同時印入帳日與交易日兩欄，AI 抽取時會挑到交易日那一欄，
    # 日期差變成 0 天、落在帳戶設定的 1~3 天入帳延遲之外，整份對帳單就會比對不上
    # （實測 27 列只對到 2 列）。月結單本來就是以入帳日為準，留一欄最不會誤會。
    body = '\n'.join(
        f'<tr><td>{posted(d)}</td><td>{desc}</td>'
        f'<td class="num">{amt:,.0f}</td><td>{kind}</td></tr>'
        for d, desc, amt, kind in rows)
    total_out = sum(a for _, _, a, k in rows if k == '支出')
    total_in = sum(a for _, _, a, k in rows if k == '存入')

    html = f"""<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap" rel="stylesheet">
<style>
  @page {{ size: A4; margin: 16mm; }}
  body {{ font-family: "Noto Sans TC", sans-serif; color: #111; font-size: 11pt; }}
  h1 {{ font-size: 16pt; margin: 0 0 2mm; letter-spacing: 2px; }}
  .sub {{ color: #555; font-size: 10pt; margin-bottom: 6mm; }}
  .meta {{ border: 1px solid #999; padding: 3mm 4mm; margin-bottom: 5mm; font-size: 10pt; }}
  .meta div {{ margin: 1mm 0; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th, td {{ border-bottom: 1px solid #ccc; padding: 2mm 2mm; text-align: left; font-size: 10pt; }}
  th {{ background: #f2f2f2; border-bottom: 1.5px solid #666; }}
  .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .foot {{ margin-top: 5mm; font-size: 10pt; }}
  .note {{ margin-top: 8mm; color: #777; font-size: 9pt; line-height: 1.6; }}
</style></head><body>
  <h1>喵喵銀行　簽帳金融卡　消費明細月結單</h1>
  <div class="sub">MEOW BANK — DEBIT CARD STATEMENT（本文件為示範用途之虛構樣本）</div>
  <div class="meta">
    <div>戶名：示範喵　　卡號末四碼：8462</div>
    <div>結帳期間：{PERIOD[0].replace('-', '/')} ～ {PERIOD[1].replace('-', '/')}</div>
    <div>本期筆數：{len(rows)} 筆</div>
  </div>
  <table>
    <thead><tr><th>入帳日期</th><th>交易說明</th><th class="num">金額(TWD)</th><th>別</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
  <div class="foot">本期支出合計：{total_out:,.0f} 元　　本期存入合計：{total_in:,.0f} 元</div>
  <div class="note">
    本文件為 Pawket 喵喵財庫作品集展示用的虛構月結單樣本，所載之銀行名稱、戶名、卡號與交易均為虛構，
    與任何真實金融機構或個人無關。
  </div>
</body></html>"""
    io.open(OUT, 'w', encoding='utf-8').write(html)
    print(f'產生 {OUT}，共 {len(rows)} 列（其中 {len(BANK_ONLY_ROWS)} 列是故意只有銀行有的）')


if __name__ == '__main__':
    main()
