-- 一次性修正：願望清單項目沒有存進資料庫的bug。
-- 原因：願望清單全面重新設計時（見PROJECT_STATUS.md 5.9節），types.ts/UI都改完了，
-- 但 wishlistItems 清單本身一直是純前端state，重新整理頁面或換裝置就會不見。
-- 舊的 savings_goals 表是更早之前「夢想目標」設計留下的死表（存錢進度模型，從來沒有
-- 程式碼實際寫入過），願望清單的心智模型完全不同（優先順序清單，不是存錢進度），
-- 直接换成新表，不跟舊表並存。
-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可，跟 schema.sql／其他 migration 是分開的。

drop table if exists savings_goals cascade;

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  target_date date,
  is_purchased boolean not null default false,
  purchased_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table wishlist_items enable row level security;

create policy "只能存取自己的願望清單" on wishlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_wishlist_items_user_order on wishlist_items(user_id, sort_order);
