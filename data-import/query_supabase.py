# -*- coding: utf-8 -*-
# 2026-07-24：Ivy提供了SUPABASE_SERVICE_ROLE_KEY(存在.env.local，不進git)，
# 讓Claude Code可以直接查詢她Supabase裡的真實資料做核對，不用每次都要她手動匯出。
# service_role金鑰會跳過RLS(Row Level Security)保護，直接讀寫整個資料庫，
# 這支腳本只做讀取查詢，不要用來寫入/刪除資料。
#
# 用法：
#   python query_supabase.py <table> ["<PostgREST查詢字串>"]
# 範例：
#   python query_supabase.py accounts
#   python query_supabase.py transactions "select=date,merchant,amount&order=date.desc&limit=10"
#   python query_supabase.py transactions "select=*&category->>l2=eq.電信網路&order=date.desc"
#
# 也可以當模組匯入用：from query_supabase import fetch
import sys, os, json, urllib.request, urllib.parse

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')


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


def fetch(table, query=''):
    env = load_env()
    url = env['VITE_SUPABASE_URL'].rstrip('/')
    key = env.get('SUPABASE_SERVICE_ROLE_KEY')
    if not key:
        raise RuntimeError('SUPABASE_SERVICE_ROLE_KEY 不存在，去.env.local確認Ivy有沒有貼')
    full_url = f"{url}/rest/v1/{table}"
    if query:
        full_url += f"?{query}"
    req = urllib.request.Request(full_url, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


# PostgREST(Supabase)預設一次最多回傳1000筆(App的lib/db.ts之前就踩過這個坑，
# fetchTransactions已經改成分頁抓取)，這裡也要分頁，避免筆數多的表(例如transactions)
# 只拿到前1000筆。
def fetch_all(table, query='', page_size=1000):
    all_rows = []
    offset = 0
    while True:
        sep = '&' if query else ''
        page_query = f"{query}{sep}limit={page_size}&offset={offset}"
        rows = fetch(table, page_query)
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python query_supabase.py <table> ["<PostgREST查詢字串>"]')
        sys.exit(1)
    table = sys.argv[1]
    query = sys.argv[2] if len(sys.argv) > 2 else ''
    rows = fetch(table, query)
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(rows, ensure_ascii=False, indent=2))
