# -*- coding: utf-8 -*-
"""
2026-09-21：建立「作品集截圖專用」的示範帳號，並灌入完全虛構的假資料。

為什麼需要這支腳本：
  作品集頁面 ai-pawket.html 的「重啟版 App 截圖」區，明確要求用「測試帳號
  （非真實記帳資料）」的畫面，不能拿 Ivy 本人的真實財務資料去截圖。這支腳本
  就是用來一鍵重建那個示範帳號的資料，之後 App 有新功能、需要重拍截圖時，
  改這支腳本再跑一次就好，不用手動一筆筆補。

重要：
  - 這裡面所有人名／商家／金額都是編出來的，跟 Ivy 的真實資料完全無關。
  - 腳本會用 SUPABASE_SERVICE_ROLE_KEY（跳過 RLS）寫入，但**只會動示範帳號
    自己的 user_id**，每一個 insert 都帶著那個 user_id，碰不到 Ivy 的資料。
  - 重跑時會先把示範帳號名下的資料清乾淨再重灌（只刪該 user_id 的列）。

用法：
    python seed_demo_account.py            # 建立/重建示範帳號 + 假資料
    python seed_demo_account.py --info     # 只印出示範帳號現況，不改任何資料
"""
import json
import os
import random
import secrets
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, '.env.local')
# 帳密另外存在 git repo 外面（C:\Users\user\Projects\Pawket\），不進版本控管
CRED_PATH = os.path.join(os.path.dirname(ROOT), '示範帳號_作品集截圖用.txt')

DEMO_EMAIL = 'pawket.demo@example.com'
DEMO_NICKNAME = '示範喵'
TODAY = date(2026, 9, 21)


# ── 基礎工具 ──────────────────────────────────────────────
def load_env():
    env = {}
    with open(ENV_PATH, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()
BASE = ENV['VITE_SUPABASE_URL'].rstrip('/')
KEY = ENV['SUPABASE_SERVICE_ROLE_KEY']
HEADERS = {
    'apikey': KEY,
    'Authorization': f'Bearer {KEY}',
    'Content-Type': 'application/json',
}


def call(method, path, payload=None, extra_headers=None):
    url = f'{BASE}{path}'
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            body = resp.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method} {path} -> {e.code}: {e.read().decode("utf-8", "replace")}') from None


def insert(table, rows, chunk=500):
    for i in range(0, len(rows), chunk):
        call('POST', f'/rest/v1/{table}', rows[i:i + chunk],
             {'Prefer': 'return=minimal'})


def new_id():
    return str(uuid.uuid4())


# ── 1. 示範帳號本身 ────────────────────────────────────────
def find_demo_user():
    users = call('GET', '/auth/v1/admin/users?per_page=200')
    for u in (users.get('users') if isinstance(users, dict) else users) or []:
        if u.get('email') == DEMO_EMAIL:
            return u
    return None


def ensure_demo_user(metadata):
    """示範帳號不存在就建立；已存在就更新 metadata 並重設一組新密碼。
    重設密碼是刻意的：這是純展示用的拋棄式帳號，沒有記住舊密碼的價值，
    每次重建資料時順便換一組新的，帳密檔案永遠跟資料庫現況一致。"""
    password = 'Demo-' + secrets.token_urlsafe(12)
    existing = find_demo_user()
    if existing:
        call('PUT', f'/auth/v1/admin/users/{existing["id"]}',
             {'user_metadata': metadata, 'password': password})
        return existing['id'], password
    created = call('POST', '/auth/v1/admin/users', {
        'email': DEMO_EMAIL,
        'password': password,
        'email_confirm': True,
        'user_metadata': metadata,
    })
    return created['id'], password


def wipe(user_id):
    """只清掉示範帳號名下的資料。順序照外鍵相依性由內而外。"""
    ses = call('GET', f'/rest/v1/shared_expenses?user_id=eq.{user_id}&select=id')
    for se in ses:
        call('DELETE', f'/rest/v1/shared_expense_participants?shared_expense_id=eq.{se["id"]}')
    for table in ('shared_expenses', 'ai_reports', 'activity_log',
                  'wishlist_items', 'merchant_aliases', 'transactions', 'accounts'):
        call('DELETE', f'/rest/v1/{table}?user_id=eq.{user_id}')


# ── 2. 假資料內容 ──────────────────────────────────────────
FIXED, VARIABLE, INVESTMENT, INCOME = 'Fixed', 'Variable', 'Investment', 'Income'

ACCOUNTS = [
    # name, institution, type, posting_delay, 期初餘額
    ('玉山銀行簽帳卡', '玉山銀行', 'bank_debit', (1, 3), 28500),
    ('中華郵政存簿', '中華郵政', 'bank_debit', (1, 2), 46000),
    ('現金錢包', None, 'cash', None, 3200),
    ('悠遊卡', None, 'stored_value', None, 420),
    ('LINE Pay Money', None, 'e_wallet', None, 860),
]

BREAKFAST = [('晨光早餐店', ['起司蛋餅', '奶茶']), ('美而美', ['鮪魚三明治', '紅茶']),
             ('全家超商', ['御飯糰', '拿鐵']), ('豆漿大王', ['鹹豆漿', '燒餅'])]
LUNCH = [('阿姨自助餐', ['三菜一肉']), ('麵屋小林', ['豚骨拉麵']), ('八方雲集', ['鍋貼10顆', '酸辣湯']),
         ('Subway', ['潛艇堡'])]
DINNER = [('小南門火鍋', ['番茄鍋']), ('路邊滷味攤', ['滷味一份']), ('café 日安', ['義大利麵']),
          ('7-ELEVEN', ['微波便當', '關東煮'])]
DRINKS = [('可不可熟成紅茶', ['熟成紅茶大']), ('五十嵐', ['四季春微糖少冰']), ('星巴克', ['那堤中杯'])]
DAILY = [('全聯福利中心', ['衛生紙', '洗髮精']), ('寶雅', ['沐浴乳', '棉花棒']),
         ('家樂福', ['洗衣精', '垃圾袋'])]
PET = [('喵星人寵物店', ['豆腐砂 2 包']), ('蝦皮購物', ['主食罐 24 罐']), ('好朋友動物醫院', ['結紮後回診'])]


def build_dataset(user_id):
    rng = random.Random(20260921)
    accounts, acc_id = [], {}
    for name, inst, atype, delay, _ in ACCOUNTS:
        aid = new_id()
        acc_id[name] = aid
        accounts.append({
            'id': aid, 'user_id': user_id, 'name': name, 'institution': inst,
            'type': atype, 'currency': 'TWD', 'is_archived': False,
            'posting_delay_min': delay[0] if delay else None,
            'posting_delay_max': delay[1] if delay else None,
            'created_at': '2026-03-30T09:00:00+08:00',
        })

    txs = []
    seq = {'n': 0}
    # 每月的「領現金」「LINE Pay 儲值」先用預設金額記著，等所有消費都生成完之後，
    # 再照「這個月實際從現金/LINE Pay 花掉多少」回填，不然餘額會變成負數（真實
    # 生活裡錢不夠本來就會再去領/再儲值，假資料也要符合這個常識）。
    topups, withdrawals = {}, {}

    def add(d, merchant, amount, ttype, l1, l2, l3='', account=None, note=None,
            items=None, discounts=None, gross=None, special=None, channel=None,
            from_acc=None, to_acc=None, parent=None, is_split=False, tx_id=None,
            reconcile=None, hour=12):
        if d > TODAY:
            return None  # 未來日期不該出現在假資料裡，看起來會像 bug
        seq['n'] += 1
        row = {
            'id': tx_id or new_id(), 'user_id': user_id,
            'account_id': acc_id[account] if account else None,
            'from_account_id': acc_id[from_acc] if from_acc else None,
            'to_account_id': acc_id[to_acc] if to_acc else None,
            'payment_channel': channel,
            'date': d.isoformat(), 'merchant': merchant, 'note': note,
            'original_text': '',
            'gross_amount': gross if gross is not None else amount,
            'discounts': discounts or [], 'items': items or [],
            'special_tag': special, 'net_amount': amount, 'type': ttype,
            'l1': l1, 'l2': l2, 'l3': l3, 'confidence': 1, 'is_verified': True,
            'is_split': is_split, 'parent_id': parent,
            'reconcile_status': reconcile,
            'deleted_at': None,  # PostgREST 批次 insert 要求每一列的欄位完全一致，所以一律帶上
            'created_at': f'{d.isoformat()}T{hour:02d}:{seq["n"] % 60:02d}:00+08:00',
        }
        txs.append(row)
        return row['id']

    # ── 期初餘額 ──
    for name, _, _, _, opening in ACCOUNTS:
        add(date(2026, 3, 31), '期初餘額', opening, 'income', INCOME, '活簿存款',
            '期初調整', account=name, note='開始使用 Pawket 當天的帳戶餘額', hour=9)

    months = [(2026, m) for m in range(4, 10)]

    for y, m in months:
        last_day = (date(y, m + 1, 1) - timedelta(days=1)).day if m < 12 else 31

        # ── 收入 ──
        add(date(y, m, 5), '沐光設計工作室', 38000, 'income', INCOME, '薪資收入', '月薪',
            account='玉山銀行簽帳卡', note=f'{m}月薪資', hour=10)
        if m in (5, 7, 9):
            add(date(y, m, 18), '接案 - 品牌識別設計', 6000, 'income', INCOME, '兼職收入', '接案',
                account='中華郵政存簿', hour=17)
        if m == 7:
            add(date(y, m, 10), '沐光設計工作室', 12000, 'income', INCOME, '獎金紅利', '年中獎金',
                account='玉山銀行簽帳卡', hour=10)

        # ── 固定支出 ──
        add(date(y, m, 1), '房東 - 民生東路套房', 11500, 'expense', FIXED, '居住房租', '月租',
            account='玉山銀行簽帳卡', hour=9)
        add(date(y, m, 8), '中華電信', 599, 'expense', FIXED, '電信網路', '手機月租',
            account='玉山銀行簽帳卡', hour=9)
        add(date(y, m, 12), 'Netflix', 270, 'expense', FIXED, '訂閱服務', '影音',
            account='玉山銀行簽帳卡', channel='VISA', hour=9)
        add(date(y, m, 15), 'Spotify', 149, 'expense', FIXED, '訂閱服務', '音樂',
            account='玉山銀行簽帳卡', channel='VISA', hour=9)
        if m in (4, 6, 8):
            add(date(y, m, 20), '台電 / 台水', rng.choice([874, 1103, 962]), 'expense', FIXED,
                '水電瓦斯', '雙月帳單', account='中華郵政存簿', hour=11)
        if m == 5:
            add(date(y, m, 20), '富邦產物保險', 8400, 'expense', FIXED, '保險費用', '年繳機車險＋意外險',
                account='中華郵政存簿', note='一年一次，已登記在長期預留支出', hour=11)

        # ── 投資儲蓄 ──
        add(date(y, m, 10), '定期定額 - 全球股票 ETF', 3000, 'expense', INVESTMENT, '定期定額', 'ETF',
            account='中華郵政存簿', hour=9)
        add(date(y, m, 6), '存進緊急預備金', 5000, 'transfer', INVESTMENT, '緊急預備金', '每月轉存',
            from_acc='玉山銀行簽帳卡', to_acc='中華郵政存簿', hour=10)

        # ── 儲值 / 轉帳 ──
        add(date(y, m, 3), '悠遊卡加值', 500, 'transfer', VARIABLE, '轉帳', '加值',
            from_acc='現金錢包', to_acc='悠遊卡', hour=8)
        add(date(y, m, 14), 'LINE Pay Money 儲值', 1000, 'transfer', VARIABLE, '轉帳', '儲值',
            from_acc='玉山銀行簽帳卡', to_acc='LINE Pay Money', hour=20)
        topups[(y, m)] = txs[-1]
        add(date(y, m, 2), '領現金', 3000, 'transfer', VARIABLE, '轉帳', '提款',
            from_acc='玉山銀行簽帳卡', to_acc='現金錢包', hour=8)
        withdrawals[(y, m)] = txs[-1]

        # ── 變動支出：日常 ──
        for day in range(1, last_day + 1):
            d = date(y, m, day)
            if d > TODAY:
                break
            wd = d.weekday()

            if rng.random() < 0.75:
                shop, its = rng.choice(BREAKFAST)
                amt = rng.choice([55, 60, 65, 70, 75, 85])
                add(d, shop, amt, 'expense', VARIABLE, '餐飲食品', '早餐',
                    account=rng.choice(['現金錢包', 'LINE Pay Money']),
                    items=[{'name': n} for n in its], hour=8)

            if rng.random() < 0.8:
                shop, its = rng.choice(LUNCH)
                amt = rng.choice([90, 100, 110, 120, 135, 150])
                add(d, shop, amt, 'expense', VARIABLE, '餐飲食品', '午餐',
                    account=rng.choice(['現金錢包', 'LINE Pay Money', '玉山銀行簽帳卡']),
                    items=[{'name': n} for n in its], hour=12)

            if rng.random() < 0.55:
                shop, its = rng.choice(DINNER)
                amt = rng.choice([120, 140, 160, 180, 210])
                add(d, shop, amt, 'expense', VARIABLE, '餐飲食品', '晚餐',
                    account=rng.choice(['現金錢包', '玉山銀行簽帳卡']),
                    items=[{'name': n} for n in its], hour=19)

            if rng.random() < 0.45:
                shop, its = rng.choice(DRINKS)
                amt = rng.choice([45, 55, 60, 65, 75, 120])
                add(d, shop, amt, 'expense', VARIABLE, '餐飲食品', '飲料',
                    account=rng.choice(['現金錢包', 'LINE Pay Money']),
                    items=[{'name': n} for n in its], hour=15)

            if wd < 5 and rng.random() < 0.85:
                add(d, '台北捷運', rng.choice([20, 25, 30, 35, 40]), 'expense', VARIABLE,
                    '交通通勤', '捷運', account='悠遊卡', hour=8)

            if wd == 5 and rng.random() < 0.8:
                shop, its = rng.choice(DAILY)
                add(d, shop, rng.choice([236, 318, 425, 512, 640]), 'expense', VARIABLE,
                    '生活日用', '日用品', account='玉山銀行簽帳卡',
                    items=[{'name': n} for n in its], hour=16)

        # ── 變動支出：每月幾筆比較大的 ──
        add(date(y, m, 9), rng.choice([p[0] for p in PET]), rng.choice([680, 790, 880]),
            'expense', VARIABLE, '寵物花費', '貓咪用品', account='玉山銀行簽帳卡',
            items=[{'name': '豆腐砂 2 包', 'unitPrice': 245, 'quantity': 2},
                   {'name': '主食罐', 'unitPrice': 39, 'quantity': 6}], hour=20)
        add(date(y, m, 22), '威秀影城', 330, 'expense', VARIABLE, '休閒娛樂', '電影',
            account='玉山銀行簽帳卡', channel='VISA', hour=19)
        if m % 2 == 0:
            add(date(y, m, 26), 'UNIQLO', rng.choice([790, 1290, 990]), 'expense', VARIABLE,
                '服飾美妝', '衣物', account='玉山銀行簽帳卡', hour=15)
        if m in (4, 7, 9):
            add(date(y, m, 17), '好朋友動物醫院', rng.choice([450, 680]), 'expense', VARIABLE,
                '醫療保健', '看診', account='現金錢包', hour=11)

    # ── 特別安排：能展示功能的幾筆（集中在 8～9 月，截圖看得到） ──
    # (1) 折扣拆分：原始金額 / 折扣 / 實付
    add(date(2026, 9, 10), '蝦皮購物', 789, 'expense', VARIABLE, '網路購物', '生活用品',
        account='LINE Pay Money', gross=899,
        discounts=[{'label': '蝦幣折抵', 'amount': 50}, {'label': '免運券', 'amount': 60}],
        items=[{'name': '矽膠收納袋', 'unitPrice': 299, 'quantity': 1},
               {'name': '貓咪造型杯墊', 'unitPrice': 300, 'quantity': 2}],
        note='蝦幣 + 免運券一起折', hour=21)

    # (2) 套餐子品項
    add(date(2026, 9, 5), '麥當勞', 179, 'expense', VARIABLE, '餐飲食品', '午餐',
        account='LINE Pay Money',
        items=[{'name': '1 + 1 隨選單點', 'subItems': [
            {'name': '大麥克', 'unitPrice': 79},
            {'name': '中杯可樂', 'unitPrice': 35}]},
            {'name': '勁辣雞腿堡', 'unitPrice': 65}], hour=12)
    add(date(2026, 9, 19), '兩廳院售票', 1480, 'expense', VARIABLE, '休閒娛樂', '展演',
        account='玉山銀行簽帳卡', channel='VISA',
        items=[{'name': '爵士音樂會票券', 'subItems': [
            {'name': '票價', 'unitPrice': 1400},
            {'name': '系統手續費', 'unitPrice': 50},
            {'name': '超商取票費', 'unitPrice': 30}]}], hour=22)

    # (3) 特殊性質標記：代購 / 工作代墊 / 借貸
    add(date(2026, 9, 6), '日本零食代購', 1280, 'expense', VARIABLE, '其他雜項', '代購',
        account='玉山銀行簽帳卡',
        special={'type': 'proxy_purchase', 'counterparty': '小美', 'note': '0906 批次'},
        items=[{'name': '抹茶生巧克力', 'unitPrice': 356, 'quantity': 2, 'note': '日幣 1,180 × 匯率 0.302'},
               {'name': '柚子軟糖', 'unitPrice': 284, 'quantity': 2}], hour=14)
    add(date(2026, 9, 11), '文具倉庫', 2450, 'expense', VARIABLE, '其他雜項', '工作代墊',
        account='玉山銀行簽帳卡',
        special={'type': 'work_advance', 'counterparty': '工作室', 'note': '已開統編，月底報帳'},
        note='部門文具採購，公司之後匯款', hour=16)
    add(date(2026, 9, 13), '借給阿哲', 500, 'expense', INVESTMENT, '借貸往來', '借出',
        account='現金錢包',
        special={'type': 'personal_loan', 'counterparty': '阿哲'},
        note='臨時周轉，說下週還', hour=18)

    # (4) 分裝盤：一張發票拆成三種分類（原始那筆照 App 邏輯不留，只留子項目）
    split_parent = new_id()
    # App 拆分時是把原始那筆「軟刪除」(進垃圾桶)，不是真的刪掉——子項目的
    # parent_id 外鍵指著它，所以這裡照樣留一列 deleted_at 有值的原始交易，
    # 順便讓垃圾桶畫面有東西可以看。
    add(date(2026, 9, 14), '全聯福利中心', 1246, 'expense', VARIABLE, '生活日用', '',
        account='玉山銀行簽帳卡', tx_id=split_parent, hour=17,
        note='這筆被分裝成三份，原始整筆保留在垃圾桶')
    txs[-1]['deleted_at'] = '2026-09-14T17:40:00+08:00'
    add(date(2026, 9, 14), '全聯福利中心', 546, 'expense', VARIABLE, '生活日用', '主項目',
        account='玉山銀行簽帳卡', parent=split_parent, is_split=True,
        note='週末採買一次結帳，事後分裝成三類', hour=17)
    add(date(2026, 9, 14), '週末食材', 420, 'expense', VARIABLE, '餐飲食品', '分裝項目',
        account='玉山銀行簽帳卡', parent=split_parent, is_split=True, hour=17)
    add(date(2026, 9, 14), '貓砂補貨', 280, 'expense', VARIABLE, '寵物花費', '分裝項目',
        account='玉山銀行簽帳卡', parent=split_parent, is_split=True, hour=17)

    # (5) 共同支出／分帳
    dinner_id = add(date(2026, 9, 8), '燒肉眾', 1860, 'expense', VARIABLE, '社交人情', '聚餐',
                    account='玉山銀行簽帳卡', channel='VISA',
                    special={'type': 'proxy_purchase', 'counterparty': '小美、阿哲'},
                    note='三人平分，我先付', hour=20)
    settle_id = add(date(2026, 9, 9), '小美還款', 620, 'income', INCOME, '退款', '分帳結清',
                    account='玉山銀行簽帳卡', note='燒肉眾分帳結清', hour=10)
    movie_id = add(date(2026, 8, 22), '威秀影城 - 小美代買', 640, 'expense', VARIABLE, '休閒娛樂', '電影',
                   account='現金錢包',
                   special={'type': 'proxy_purchase', 'counterparty': '小美'},
                   note='小美先幫我買票，我欠她一半', hour=19)

    # (6) 3C 大額支出（用來展示「日均燒錢速度排除極端值」的情境）
    add(date(2026, 6, 14), '燦坤 3C', 28900, 'expense', VARIABLE, '3C電子', '筆電',
        account='玉山銀行簽帳卡', channel='VISA',
        note='舊筆電陣亡，換新工作機', hour=15)
    add(date(2026, 7, 3), 'Hahow 線上課程', 1200, 'expense', VARIABLE, '學習進修', '線上課程',
        account='玉山銀行簽帳卡', hour=21)
    add(date(2026, 8, 16), '婚禮紅包 - 表姊', 3600, 'expense', VARIABLE, '社交人情', '禮金',
        account='現金錢包', hour=12)

    # ── 回填每月的領現金 / LINE Pay 儲值金額 ──
    def monthly_outflow(acc_name, y, m):
        """這個月從某個帳戶流出去多少（消費＋轉出，轉入不算）。"""
        total = 0
        for t in txs:
            if t.get('deleted_at') or not t['date'].startswith(f'{y}-{m:02d}'):
                continue
            if t['type'] == 'expense' and t['account_id'] == acc_id[acc_name]:
                total += t['net_amount']
            elif t['type'] == 'transfer' and t['from_account_id'] == acc_id[acc_name]:
                total += t['net_amount']
        return total

    def round_up(n, step):
        return int(-(-n // step) * step)

    for (y, m), row in withdrawals.items():
        row['net_amount'] = row['gross_amount'] = round_up(monthly_outflow('現金錢包', y, m) + 800, 500)
    for (y, m), row in topups.items():
        row['net_amount'] = row['gross_amount'] = round_up(monthly_outflow('LINE Pay Money', y, m) + 400, 100)

    # ── 對帳狀態：9 月玉山那批已經跑過餵食核對 ──
    sept_esun = [t for t in txs if t['date'].startswith('2026-09')
                 and t['account_id'] == acc_id['玉山銀行簽帳卡'] and t['type'] == 'expense'
                 and not t.get('deleted_at')]
    for t in sept_esun:
        t['reconcile_status'] = 'matched'
    if len(sept_esun) >= 3:
        sept_esun[-1]['reconcile_status'] = 'pending_settlement'
        sept_esun[-2]['reconcile_status'] = 'missing_official'

    shared = [
        {
            'se': {'id': new_id(), 'user_id': user_id, 'transaction_id': dinner_id,
                   'total_amount': 1860, 'my_share': 620},
            'parts': [
                {'name': '小美', 'owed_amount': 620, 'direction': 'they_owe_me',
                 'settled': True, 'settle_method': '轉帳', 'settled_date': '2026-09-09',
                 'settled_transaction_id': settle_id},
                {'name': '阿哲', 'owed_amount': 620, 'direction': 'they_owe_me',
                 'settled': False, 'settle_method': None, 'settled_date': None,
                 'settled_transaction_id': None},
            ],
        },
        {
            'se': {'id': new_id(), 'user_id': user_id, 'transaction_id': movie_id,
                   'total_amount': 640, 'my_share': 320},
            'parts': [
                {'name': '小美', 'owed_amount': 320, 'direction': 'i_owe_them',
                 'settled': True, 'settle_method': '現金', 'settled_date': '2026-08-23',
                 'settled_transaction_id': None},
            ],
        },
    ]

    wishlist = [
        {'id': new_id(), 'user_id': user_id, 'name': '人體工學椅', 'target_amount': 8900,
         'target_date': None, 'is_purchased': False, 'purchased_date': None, 'sort_order': 0},
        {'id': new_id(), 'user_id': user_id, 'name': '京都自由行', 'target_amount': 32000,
         'target_date': '2027-03-20', 'is_purchased': False, 'purchased_date': None, 'sort_order': 1},
        {'id': new_id(), 'user_id': user_id, 'name': '降噪藍牙耳機', 'target_amount': 3490,
         'target_date': None, 'is_purchased': False, 'purchased_date': None, 'sort_order': 2},
        {'id': new_id(), 'user_id': user_id, 'name': '無線鍵盤', 'target_amount': 1890,
         'target_date': None, 'is_purchased': True, 'purchased_date': '2026-07-28',
         'sort_order': 3},
    ]

    aliases = [
        {'id': new_id(), 'user_id': user_id, 'official_pattern': 'UBER *EATS TAIPEI',
         'candidates': [{'userMerchant': 'Uber Eats', 'count': 14}],
         'default_l1': VARIABLE, 'default_l2': '餐飲食品'},
        {'id': new_id(), 'user_id': user_id, 'official_pattern': '連支＊全家超商',
         'candidates': [{'userMerchant': '全家超商', 'count': 23}],
         'default_l1': VARIABLE, 'default_l2': '餐飲食品'},
        {'id': new_id(), 'user_id': user_id, 'official_pattern': 'GOOGLE *PLAY TW',
         'candidates': [{'userMerchant': 'YouTube Premium', 'count': 6},
                        {'userMerchant': '手遊月卡', 'count': 3}],
         'default_l1': FIXED, 'default_l2': '訂閱服務'},
        {'id': new_id(), 'user_id': user_id, 'official_pattern': 'PXMART 0932',
         'candidates': [{'userMerchant': '全聯福利中心', 'count': 11}],
         'default_l1': VARIABLE, 'default_l2': '生活日用'},
    ]

    ai_report = {
        'id': new_id(), 'user_id': user_id, 'scope': 'natural_month',
        'period_label': '2026/08/01 ~ 2026/08/31',
        'period_start': '2026-08-01', 'period_end': '2026-08-31',
        'content': {
            'overallAssessment': '這個月整體收支是健康的：收入 38,000 元、支出 27,140 元，結餘約 1.1 萬，'
                                 '固定支出佔收入 35%，還在可接受範圍，但已經接近你自己設定的警戒線。',
            'keyPoints': [
                '餐飲食品 7,180 元是本月最大的變動支出，比前三個月中位數高約 12%。',
                '社交人情因為婚禮紅包 3,600 元一次拉高，屬於一次性支出，不用當成常態。',
                '緊急預備金這個月照常轉存 5,000 元，連續 5 個月沒有中斷。',
            ],
            'anomalyFindings': [
                '飲料類單月出現 18 次，比最近三個月平均的 12 次高出 50%，值得留意。',
            ],
            'suggestions': [
                '餐飲食品下個月可以把月預算抓在 6,500 元，並優先從飲料次數著手。',
                '婚禮紅包這類人情支出建議登記到長期預留支出，避免單月被一次性金額嚇到。',
                '目前可動用餘額扣掉願望清單前兩項後仍為正數，人體工學椅可以考慮在下個月入手。',
            ],
        },
        'created_at': '2026-09-01T09:30:00+08:00',
    }

    return accounts, txs, shared, wishlist, aliases, ai_report


def build_activity_log(user_id, txs):
    """示範「重新裝碗紀錄」：一次批次分類修正。"""
    targets = [t for t in txs if t['l2'] == '餐飲食品' and t['l3'] == '飲料'][:8]
    return {
        'id': new_id(), 'user_id': user_id, 'action_type': 'batch_correction',
        'description': f'把 {len(targets)} 筆手搖飲從「其他雜項」批次改成「餐飲食品 / 飲料」',
        'affected_transaction_ids': [t['id'] for t in targets],
        'before_snapshot': [{'id': t['id'], 'merchant': t['merchant'],
                             'l1': VARIABLE, 'l2': '其他雜項', 'l3': ''} for t in targets],
        'created_at': '2026-09-15T21:12:00+08:00',
    }


def main():
    metadata = {
        'nickname': DEMO_NICKNAME,
        'similarTransactionAlertsEnabled': True,
        'categoryBudgets': {
            '餐飲食品': 6500, '生活日用': 2500, '交通通勤': 1200, '休閒娛樂': 1500,
            '寵物花費': 1000, '網路購物': 1200, '服飾美妝': 1000,
        },
        'longTermReserves': [
            {'id': new_id(), 'name': '機車強制險 + 意外險', 'l2': '保險費用',
             'amount': 8400, 'frequencyMonths': 12},
            {'id': new_id(), 'name': '綜合所得稅', 'l2': '稅務規費',
             'amount': 6000, 'frequencyMonths': 12},
            {'id': new_id(), 'name': '房屋火險', 'l2': '保險費用',
             'amount': 2400, 'frequencyMonths': 12},
        ],
    }

    if '--info' in sys.argv:
        u = find_demo_user()
        print(json.dumps(u, ensure_ascii=False, indent=2) if u else '示範帳號還不存在')
        return

    user_id, password = ensure_demo_user(metadata)
    print(f'示範帳號 user_id = {user_id}')
    wipe(user_id)

    accounts, txs, shared, wishlist, aliases, ai_report = build_dataset(user_id)
    insert('accounts', accounts)
    insert('transactions', txs)
    for block in shared:
        insert('shared_expenses', [block['se']])
        insert('shared_expense_participants',
               [dict(p, id=new_id(), shared_expense_id=block['se']['id']) for p in block['parts']])
    insert('wishlist_items', wishlist)
    insert('merchant_aliases', aliases)
    insert('ai_reports', [ai_report])
    insert('activity_log', [build_activity_log(user_id, txs)])

    print(f'帳戶 {len(accounts)} 個、交易 {len(txs)} 筆、分帳 {len(shared)} 組、'
          f'願望清單 {len(wishlist)} 項、商家別名 {len(aliases)} 筆、戰情報告 1 份寫入完成')

    if password:
        with open(CRED_PATH, 'w', encoding='utf-8') as f:
            f.write('Pawket 作品集截圖用示範帳號（假資料，不是 Ivy 的真實記帳資料）\n')
            f.write(f'建立時間：{datetime.now():%Y-%m-%d %H:%M}\n\n')
            f.write(f'帳號：{DEMO_EMAIL}\n密碼：{password}\n')
            f.write(f'user_id：{user_id}\n')
        print(f'帳密已寫入 {CRED_PATH}')
    else:
        print('示範帳號本來就存在，沿用原本的密碼（帳密檔案沒有變動）')


if __name__ == '__main__':
    main()
