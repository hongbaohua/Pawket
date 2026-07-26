# -*- coding: utf-8 -*-
# 2026-07-27：Ivy逐筆核對查核表時發現，2023-2024現金支出日記帳那批889筆資料，
# 折扣資訊很多只寫在note備註文字裡（例如「環保杯-$5」「學生證-$5」），從沒被拆進
# grossAmount/discounts結構化欄位——之前的「折扣格式回填」(parse_discounts.py)只處理過
# 中信775筆，這批日記帳資料從一開始就沒做過同樣的處理，不是這次才壞掉。
#
# 邏輯沿用parse_discounts.py同樣保守的做法：note裡用頓號/逗號分隔的每一段，
# 一定要「全部」符合「標籤-$金額」格式才自動拆，只要有一段不符合(例如百分比折扣
# 「9折」、或看起來是跟朋友分攤金額而不是折扣)，整筆都不自動處理、列進review檔
# 讓Ivy自己看，不硬套。
#
# 使用方式：
#   python parse_cash_journal_discounts.py
# 產出：
#   fix_013_cash_journal_discounts.sql（可直接執行的SQL，只有能安全自動解析的部分）
#   cash_journal_discounts_review.txt（人類可讀，含review區塊列出不自動處理的筆數+原因）

import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from query_supabase import fetch_all

IVY_USER_ID = '56dd1f4e-32c5-41ba-8da4-7eabce8b7b70'

# 一定要有$符號，避免日期(2026-07-21)/商家名稱(7-11)裡的連字號被誤判
ITEM_RE = re.compile(r'^(.*?)-\$(\d+(?:\.\d+)?)$')


def try_parse_discounts(note: str):
    """note裡用頓號/逗號分隔的每一段都要符合「標籤-$金額」才回傳折扣清單，
    否則回傳None代表這筆不自動處理。

    重要防呆：有些note把多個項目直接黏在一起、中間沒有頓號/逗號分隔
    （例如「學生證-$5環保杯-$5」，其實是兩個各$5的項目，不是一個$5的項目），
    這種情況下沒有分隔符可以切，會被非貪婪regex誤判成一整段是一個標籤+金額，
    label裡還殘留著「-$數字」——這是判斷失敗的訊號，一旦label本身還包含
    金額格式，代表這段沒辦法安全切開，整筆都不自動處理，避免金額算錯。
    """
    if not note:
        return None
    parts = re.split(r'[、,，]', note.strip())
    discounts = []
    for p in parts:
        p = p.strip()
        m = ITEM_RE.match(p)
        if not m:
            return None
        label, amt = m.group(1).strip(), float(m.group(2))
        if not label or '$' in label:
            return None
        discounts.append({'label': label, 'amount': amt})
    return discounts if discounts else None


def main():
    print('查詢現金支出日記帳批次的交易資料...')
    rows = fetch_all('transactions', f"select=id,merchant,net_amount,note,original_text,gross_amount,discounts&user_id=eq.{IVY_USER_ID}")
    cash_rows = [r for r in rows if r.get('original_text') and '現金支出日記帳匯入' in r['original_text']]
    print(f'現金支出日記帳批次共 {len(cash_rows)} 筆')

    auto_fix = []
    review = []

    for row in cash_rows:
        note = row.get('note') or ''
        amount = row.get('net_amount')
        gross = row.get('gross_amount')
        existing_discounts = row.get('discounts')
        already_has_discounts = existing_discounts and str(existing_discounts) not in ('[]', 'None', '')
        if already_has_discounts:
            continue
        # 沒有折扣線索的note(例如None、或跟折扣無關的一般描述)直接跳過，不算問題
        if not note or '$' not in note:
            continue

        discounts = try_parse_discounts(note)
        if discounts is None:
            review.append((row, 'note格式不是單純的「標籤-$金額」列表，可能是百分比折扣/分攤金額/其他情況，人工判斷比較安全'))
            continue

        discount_sum = sum(d['amount'] for d in discounts)
        new_gross = round(amount + discount_sum, 2)
        auto_fix.append((row, new_gross, discounts))

    print(f'可以安全自動拆解: {len(auto_fix)} 筆')
    print(f'需要人工判斷: {len(review)} 筆')

    sql_lines = [
        '-- 一次性資料修正：2023-2024現金支出日記帳批次，note備註裡的折扣文字',
        '-- (例如「環保杯-$5」)拆進grossAmount/discounts結構化欄位，跟中信775筆當初',
        '-- 「折扣格式回填」做的事一樣，只是這批資料當初漏做。',
        '-- 只包含note格式單純(全部都是「標籤-$金額」)的筆數，其餘列在',
        '-- cash_journal_discounts_review.txt讓Ivy自己判斷，不硬套。',
        '-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可。',
        '',
    ]
    for row, new_gross, discounts in auto_fix:
        discounts_json = '[' + ','.join(
            '{"label":"%s","amount":%s}' % (d['label'].replace('"', '\\"'), d['amount']) for d in discounts
        ) + ']'
        sql_lines.append(
            f"update transactions set gross_amount={new_gross}, discounts='{discounts_json}'::jsonb where id='{row['id']}';"
        )

    sql_path = os.path.join(os.path.dirname(HERE := os.path.dirname(os.path.abspath(__file__))), 'supabase', 'fix_013_cash_journal_discounts.sql')
    with open(sql_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql_lines) + '\n')
    print(f'已寫入: {sql_path}')

    review_path = os.path.join(HERE, 'cash_journal_discounts_review.txt')
    with open(review_path, 'w', encoding='utf-8') as f:
        f.write(f'需要Ivy人工判斷的 {len(review)} 筆（note格式不單純，不自動處理）：\n\n')
        for row, reason in review:
            f.write(f"id={row['id']} merchant={row.get('merchant')!r} amount={row.get('net_amount')} note={row.get('note')!r}\n")
            f.write(f"  原因: {reason}\n")
            f.write(f"  原始文字: {row.get('original_text')!r}\n\n")
        f.write(f'\n已自動拆解的 {len(auto_fix)} 筆，供覆核：\n\n')
        for row, new_gross, discounts in auto_fix:
            f.write(f"id={row['id']} merchant={row.get('merchant')!r} amount={row.get('net_amount')} -> grossAmount={new_gross}, discounts={discounts}\n")
    print(f'已寫入: {review_path}')


if __name__ == '__main__':
    main()
