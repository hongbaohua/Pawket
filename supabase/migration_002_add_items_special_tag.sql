-- 一次性修正：transactions 表補上 items（品項清單）跟 special_tag（代購/工作代墊標記）欄位。
-- 原因：這兩個欄位是這次「商家/品項二次重整」新增到 types.ts 的，但當時漏了同步更新
-- Supabase schema 跟 lib/db.ts 的讀寫層，導致「套用商家品項重新解析」按鈕雖然顯示成功，
-- 但 items/specialTag 資料其實沒有真的存進資料庫（lib/db.ts 已經在程式碼那邊修好了，
-- 這份 SQL 負責補資料庫欄位本身）。
-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可，跟 schema.sql／migration_001 是分開的。

alter table transactions add column if not exists items jsonb not null default '[]';
alter table transactions add column if not exists special_tag jsonb;

comment on column transactions.items is '品項清單 [{name, unitPrice?, quantity?, note?}]，一筆交易買多樣商品時用';
comment on column transactions.special_tag is '代購/工作代墊等輕量標記 {type, counterparty, note?}，不是完整分帳計算';
