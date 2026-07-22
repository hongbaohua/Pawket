-- ============================================================
-- Pawket 資料庫結構
-- ============================================================
-- 使用方式：登入 Supabase 專案後台 → 左側選單「SQL Editor」→ 新增查詢 →
-- 把這整份檔案貼進去 → 執行 (Run)。只需要做一次。
--
-- 設計原則：
--   - 每一張表都有 user_id，並開啟 Row Level Security（列層級安全），
--     確保「你只能看到/修改自己的資料」，就算資料庫本身是共用的雲端服務也一樣。
--   - 目前只有你一個使用者，但這樣設計之後如果要開放給家人朋友用也不用重建。

-- ── 1. 帳戶（銀行卡、現金、電子支付、儲值卡） ──
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                    -- 你自訂的顯示名稱，如「中國信託簽帳卡」
  institution text,                      -- 自由文字，如「中國信託」「中華郵政」，非固定清單
  type text not null check (type in ('cash', 'bank_debit', 'bank_credit', 'e_wallet', 'stored_value')),
  -- 沒有「固定連結來源帳戶」欄位：電子支付錢包(LINE Pay Money/全支付/悠遊付)實際上能綁多家銀行/多張卡儲值，
  -- 不是固定綁一個來源，儲值/加值一律用 transactions.type='transfer' 記錄，可以每次選不同來源帳戶。
  posting_delay_min int,                 -- 對帳用：預期入帳延遲最短天數
  posting_delay_max int,                 -- 對帳用：預期入帳延遲最長天數
  currency text not null default 'TWD',
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── 2. 交易紀錄 ──
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  date date not null,
  merchant text not null default '',
  note text,                             -- 備註/品項細節，跟商家名稱分開存
  original_text text,                    -- OCR或匯入時的原始文字，供稽核用
  gross_amount numeric not null default 0,  -- 原始金額（折扣前）
  discounts jsonb not null default '[]',    -- 折扣明細陣列 [{type,label,amount}]
  items jsonb not null default '[]',        -- 結構化品項清單 [{name,unitPrice?,quantity?,note?}]
  special_tag jsonb,                        -- 代購/工作代墊輕量標記 {type,counterparty,note?}
  payment_channel text,                     -- 同一帳戶底下的實際付款通道（選填），例如 VISA/方便付/LINE Pay
  net_amount numeric not null default 0,    -- 實付金額 = gross_amount - Σdiscounts
  type text not null check (type in ('income', 'expense', 'transfer')),
  from_account_id uuid references accounts(id),  -- 僅 type='transfer' 使用
  to_account_id uuid references accounts(id),    -- 僅 type='transfer' 使用
  l1 text,                               -- 分類大類 (Fixed/Variable/Investment/Income)
  l2 text,                               -- 分類次類
  l3 text,                               -- 分類細項
  confidence numeric default 1.0,
  is_verified boolean not null default true,
  is_split boolean not null default false,
  parent_id uuid references transactions(id) on delete set null, -- 拆分群組的母項目 id
  reconcile_status text check (reconcile_status in ('matched', 'pending_settlement', 'missing_manual', 'missing_official')),
  created_at timestamptz not null default now()
);

-- ── 3. 商家別名對照表 ──
create table if not exists merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  official_pattern text not null,        -- 銀行/OCR原始顯示的商家代碼，如「連支＊樂樂早餐」
  user_merchant text not null,           -- 你慣用的名稱，如「樂樂早餐店」
  account_id uuid references accounts(id) on delete cascade, -- 選填：限定某帳戶才套用
  default_l1 text,                       -- 選填：自動建議分類大類
  default_l2 text,                       -- 選填：自動建議分類次類
  created_at timestamptz not null default now()
);

-- ── 4. 願望清單 ──
-- 不是「存錢進度」：這個App本質是記帳，錢就是帳戶餘額本身，沒有另外撥一筆去「存」。
-- 願望清單只是「排隊克制自己不要花掉」的優先順序清單，可動用餘額扣掉排在前面還沒買的項目才知道
-- 排後面的項目還差多少——沒有 initial_amount/start_date 這種「存了多少進度」的欄位。
create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  target_date date,                      -- 選填：有填＝這天前要準備好；沒填＝錢夠了才買，不趕時間
  is_purchased boolean not null default false,
  purchased_date date,
  sort_order int not null default 0,     -- 優先順序＝排列順序（上移/下移調整），不是額外的權重數字
  created_at timestamptz not null default now()
);

-- ── 5. 共同支出／代墊分帳 ──
create table if not exists shared_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  total_amount numeric not null,
  my_share numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists shared_expense_participants (
  id uuid primary key default gen_random_uuid(),
  shared_expense_id uuid not null references shared_expenses(id) on delete cascade,
  name text not null,
  owed_amount numeric not null,
  direction text not null check (direction in ('they_owe_me', 'i_owe_them')),
  settled boolean not null default false,
  settle_method text check (settle_method in ('現金', '轉帳', 'LINE Pay Money', '其他')),
  settled_date date
);

-- ============================================================
-- Row Level Security：確保每個使用者只能存取自己的資料
-- ============================================================
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table merchant_aliases enable row level security;
alter table wishlist_items enable row level security;
alter table shared_expenses enable row level security;
alter table shared_expense_participants enable row level security;

create policy "只能存取自己的帳戶" on accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "只能存取自己的交易" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "只能存取自己的商家別名" on merchant_aliases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "只能存取自己的願望清單" on wishlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "只能存取自己的分帳紀錄" on shared_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- shared_expense_participants 沒有 user_id，透過關聯的 shared_expenses 來檢查權限
create policy "只能存取自己分帳紀錄底下的分帳對象" on shared_expense_participants
  for all using (
    exists (
      select 1 from shared_expenses
      where shared_expenses.id = shared_expense_participants.shared_expense_id
      and shared_expenses.user_id = auth.uid()
    )
  );

-- ── 索引：加速常用查詢 ──
create index if not exists idx_transactions_user_date on transactions(user_id, date desc);
create index if not exists idx_transactions_account on transactions(account_id);
create index if not exists idx_accounts_user on accounts(user_id);
create index if not exists idx_wishlist_items_user_order on wishlist_items(user_id, sort_order);
