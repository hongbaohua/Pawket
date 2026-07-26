-- 對帳模組第一批可用切片：merchant_aliases 改成「候選清單」結構，取代舊的
-- 「一個代碼對一個固定商家」假設（實測驗證過近2成真實代碼其實對應過2種以上
-- 不同商家/用途，例如Google Play代碼背後可能是好幾款不同遊戲）。
-- merchant_aliases 這張表目前是空的（seed_merchant_aliases.sql 從沒真的執行過），
-- 直接改結構不用搬資料。
--
-- posting_delay_min/max（accounts表）跟 reconcile_status（transactions表）
-- schema.sql 已經有了，這裡不用重複加。
--
-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可。

alter table merchant_aliases drop column if exists user_merchant;
alter table merchant_aliases add column if not exists candidates jsonb not null default '[]';
comment on column merchant_aliases.candidates is
  '這個代碼歷史上對應過的商家清單 [{userMerchant,count}]。只有1筆時才能自動帶入，2筆以上必須讓使用者從候選清單選，不能自動猜。';

-- 方便「對帳」畫面查詢某帳戶待處理/已處理狀態
create index if not exists idx_transactions_reconcile
  on transactions(user_id, account_id, reconcile_status) where reconcile_status is not null;
