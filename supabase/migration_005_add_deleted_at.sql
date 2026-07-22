-- 一次性修正：新增「垃圾桶」機制，避免手滑誤刪就真的救不回來。
-- 原因：Ivy誤刪一筆交易，發現原本的刪除是「畫面上3秒鐘可以復原、之後就從資料庫永久刪除」，
-- 沒看到那3秒的復原提示就真的沒救了。改成「軟刪除」：刪除只是標記deleted_at時間戳記，
-- 資料實際上還在資料庫裡，垃圾桶畫面可以看到、救回，或選擇永久刪除。
-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可，跟 schema.sql／其他 migration 是分開的。

alter table transactions add column if not exists deleted_at timestamptz;

comment on column transactions.deleted_at is '軟刪除時間戳記，非NULL代表在垃圾桶裡，NULL代表正常存在';

create index if not exists idx_transactions_deleted_at on transactions(user_id, deleted_at);
