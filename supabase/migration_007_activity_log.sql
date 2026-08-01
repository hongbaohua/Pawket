-- migration_007：編輯歷程紀錄表
-- Ivy 2026-08-02反應：批次修正誤觸後完全查不出「當時到底改了什麼」，光靠交易本身的
-- 文字標記(originalText裡的"(Batch Updated)")當鑑識依據太薄弱——沒有時間戳記、沒有記錄
-- 改之前的值，同一個標記可能是好幾次不同事件疊加造成的，事後根本分不清楚。
-- 這張表記錄「大動作編輯」(目前先只有批次修正)事件本身，包含改之前的完整快照，
-- 之後才能真的回答「這筆是什麼時候、被什麼操作、從什麼值改成什麼值」。
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,              -- 目前只有 'batch_correction'，用text留之後擴充其他大動作編輯類型的空間
  description text not null,              -- 人類可讀說明，例如「已把3筆交易改成「肚肉刈包 → 變動支出/餐飲食品/晚餐」」
  affected_transaction_ids uuid[] not null,
  before_snapshot jsonb not null,         -- 受影響交易「改之前」的完整資料(TransactionRow格式陣列)，復原時直接整批upsert回去
  restored_at timestamptz,                -- 有值代表這筆事件已經被復原過，畫面上不再顯示「復原」按鈕避免重複復原
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;

create policy "只能存取自己的編輯歷程" on activity_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_activity_log_user_created on activity_log(user_id, created_at desc);
