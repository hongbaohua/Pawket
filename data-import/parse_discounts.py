# -*- coding: utf-8 -*-
# 從已匯入的 775 筆真實資料回頭解析：商家欄位裡夾帶的折扣/備註文字，
# 拆成乾淨的 merchant + note + grossAmount + discounts[]。
# 只在「商家文字裡有明確的 標籤-$金額 格式」時才拆折扣，
# 其餘（例如百分比折扣、匯率換算公式、巢狀括號）保守處理，不硬套，列出來讓 Ivy 自己看。
#
# 產出：
#   discount_corrections.json — 可自動套用的修正清單（含真實交易 id）
#   discount_review.txt       — 全部修正結果 + 不自動處理、需要人工看的清單
#
# 使用方式：跑完這支之後，去 App 的「罐罐明細本」點一次性按鈕套用修正
# （見 App.tsx 的 handleApplyDiscountCorrections，用完可以移除）。

import json, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
IMPORTED_PATH = os.path.join(os.path.dirname(HERE), '匯入_中信對帳_775筆.json')
FINAL_RECORDS_PATH = os.path.join(HERE, 'final_records.json')
OUT_PATH = os.path.join(HERE, 'discount_corrections.json')
REVIEW_PATH = os.path.join(HERE, 'discount_review.txt')

with open(IMPORTED_PATH, encoding='utf-8') as f:
    imported = json.load(f)['transactions']

with open(FINAL_RECORDS_PATH, encoding='utf-8') as f:
    final_records = json.load(f)
records_by_row = {r['row']: r for r in final_records}

# 從 originalText 抓出 rowN，對回 final_records.json 的分析資料（拿它的原始 merchant 文字，未被之後任何處理動過）
row_re = re.compile(r'row(\d+)')

# 抓 "(...)" 或「（...）」括號內容（非巢狀，簡單一層）
paren_re = re.compile(r'[(（]([^()（）]*)[)）]')
# 括號內用頓號/逗號分隔多個折扣項目，每項要嘛是 "標籤-$數字" 要嘛不是折扣（純描述）
item_re = re.compile(r'^(.*?)-\$(\d+(?:\.\d+)?)$')

def parse_discount_paren(content):
    """括號內每個以頓號/逗號分隔的項目，如果全部都符合「標籤-$數字」，回傳折扣清單；
    只要有一項不符合，回傳 None（代表整個括號是純描述，不拆折扣）。"""
    parts = re.split(r'[、,，]', content)
    discounts = []
    for p in parts:
        p = p.strip()
        m = item_re.match(p)
        if not m:
            return None
        label, amt = m.group(1).strip(), float(m.group(2))
        discounts.append({'label': label or '折扣', 'amount': amt})
    return discounts

def clean_merchant_base(text, paren_span):
    before = text[:paren_span[0]].rstrip('-－ 、,，')
    return before

results = []
review_lines = []

for tx in imported:
    m = row_re.search(tx.get('originalText', ''))
    if not m:
        continue
    row_num = int(m.group(1))
    rec = records_by_row.get(row_num)
    if not rec:
        continue
    raw_merchant = rec.get('merchant') or ''

    paren_matches = list(paren_re.finditer(raw_merchant))
    if not paren_matches:
        # 沒有括號的情況：檢查是不是「描述，標籤-$金額」這種逗號分隔、且折扣段落剛好在字串結尾的寫法
        # （用結尾錨點排除「-$65飲料×10」這種其實是單價×數量、不是折扣的假陽性）
        comma_m = re.match(r'^(.*)[，,]\s*(.+?-\$\d+(?:\.\d+)?)$', raw_merchant)
        if not comma_m:
            continue
        base_part, tail_part = comma_m.group(1), comma_m.group(2)
        d = parse_discount_paren(tail_part)
        if d is None:
            review_lines.append(f"[結尾逗號段落不是折扣格式，不拆] row{row_num} merchant={raw_merchant!r}")
            continue
        merchant_clean, note = base_part.strip(), ''
        if not merchant_clean:
            review_lines.append(f"[解析後商家為空，不拆] row{row_num} merchant={raw_merchant!r}")
            continue
        discount_sum = sum(x['amount'] for x in d)
        gross = abs(tx['amount']) + discount_sum
        results.append({
            'id': tx['id'], 'row': row_num, 'old_merchant': raw_merchant,
            'merchant': merchant_clean, 'note': note or None,
            'amount': tx['amount'], 'grossAmount': gross, 'discounts': d,
        })
        continue

    # 只處理最後一個括號，並要求括號後面沒有殘留文字（避免巢狀括號或格式更複雜的情況被錯誤切割）
    last = paren_matches[-1]
    trailing = raw_merchant[last.end():].strip()
    discounts = parse_discount_paren(last.group(1))

    if discounts is None:
        if trailing:
            review_lines.append(f"[括號後有殘留文字，不拆] row{row_num} merchant={raw_merchant!r} trailing={trailing!r}")
            continue
        base = clean_merchant_base(raw_merchant, last.span())
        dash_split = re.split(r'[-－]', base, maxsplit=1)
        paren_content = last.group(1).strip()
        if len(dash_split) == 2 and dash_split[0].strip():
            merchant_clean = dash_split[0].strip()
            note = (dash_split[1].strip() + '　' + paren_content).strip('　') if paren_content else dash_split[1].strip()
        else:
            merchant_clean, note = base.strip(), paren_content
        if not merchant_clean:
            review_lines.append(f"[解析後商家為空，不拆] row{row_num} merchant={raw_merchant!r}")
            continue
        results.append({
            'id': tx['id'], 'row': row_num, 'old_merchant': raw_merchant,
            'merchant': merchant_clean, 'note': note or None,
            'amount': tx['amount'], 'grossAmount': None, 'discounts': None,
        })
        continue

    if trailing:
        review_lines.append(f"[括號後有殘留文字，不拆] row{row_num} merchant={raw_merchant!r} trailing={trailing!r}")
        continue

    base = clean_merchant_base(raw_merchant, last.span())
    dash_split = re.split(r'[-－]', base, maxsplit=1)
    if len(dash_split) == 2 and dash_split[0].strip():
        merchant_clean, note = dash_split[0].strip(), dash_split[1].strip()
    else:
        merchant_clean, note = base.strip(), ''

    if not merchant_clean:
        review_lines.append(f"[解析後商家為空，不拆] row{row_num} merchant={raw_merchant!r}")
        continue

    discount_sum = sum(d['amount'] for d in discounts)
    gross = abs(tx['amount']) + discount_sum
    results.append({
        'id': tx['id'],
        'row': row_num,
        'old_merchant': raw_merchant,
        'merchant': merchant_clean,
        'note': note or None,
        'amount': tx['amount'],
        'grossAmount': gross,
        'discounts': discounts,
    })

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

with open(REVIEW_PATH, 'w', encoding='utf-8') as f:
    f.write(f'自動拆出的筆數: {len(results)}\n\n')
    for r in results:
        f.write(f"row{r['row']} | {r['old_merchant']!r}\n")
        f.write(f"  -> merchant={r['merchant']!r} note={r['note']!r} gross={r['grossAmount']} discounts={r['discounts']} (net={r['amount']})\n")
    f.write(f'\n\n未自動拆、需要人工看一下的 ({len(review_lines)}):\n')
    for line in review_lines:
        f.write(line + '\n')

print('corrections:', len(results), 'needs review:', len(review_lines))
