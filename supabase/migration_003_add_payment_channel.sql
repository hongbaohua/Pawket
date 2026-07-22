-- 一次性修正：transactions 表補上 payment_channel 欄位。
-- 原因：同一個帳戶底下實際刷的付款通道可能不只一種（例如「中國信託」底下可能是
-- VISA金融卡、方便付、LINE Pay，這幾個通道共用同一個銀行帳戶的錢，不該各自拆成獨立帳戶），
-- 新增交易時原本沒有地方可以記錄「這筆是透過哪個通道刷的」，Ivy指出這個缺口。
-- 使用方式：Supabase 後台 SQL Editor 貼上執行一次即可，跟 schema.sql／migration_001/002 是分開的。

alter table transactions add column if not exists payment_channel text;

comment on column transactions.payment_channel is '同一帳戶底下的實際付款通道（選填），例如 VISA/方便付/LINE Pay，不是獨立帳戶';
