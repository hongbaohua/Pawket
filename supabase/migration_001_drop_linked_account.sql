-- 一次性修正：拿掉 accounts.linked_account_id 這個欄位。
-- 原因：電子支付錢包(LINE Pay Money/全支付/悠遊付)實際上能綁多家銀行/多張卡儲值，
-- 不是固定綁死一個來源帳戶，所以這個欄位的假設是錯的，之後儲值/加值一律用「轉帳」交易記錄，可以每次選不同來源。
-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可，跟主要的 schema.sql 是分開的兩份，不用重跑 schema.sql。

alter table accounts drop column if exists linked_account_id;
