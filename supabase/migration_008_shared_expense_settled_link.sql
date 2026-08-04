-- migration_008：分帳明細的「已結清」狀態可以直接連結一筆已經存在的交易
-- Ivy 2026-08-04反應：借出去的錢對方還錢時，她自己已經先手動記了一筆收入交易，
-- 標記已結清時卻只能選「順便記一筆新的」(會重複算)或什麼都不做(兩筆完全沒關聯)，
-- 中間缺一個「連結到已經記過的那一筆」的選項。
alter table shared_expense_participants
  add column if not exists settled_transaction_id uuid references transactions(id) on delete set null;
