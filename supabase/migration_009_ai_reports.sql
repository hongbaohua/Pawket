-- migration_009：戰情報告（AI生成的財務解讀報告）
-- 2026-09-02 Ivy要求：原本「匯出戰情報告」是把畫面圖表截圖拼成PDF，改成AI真的讀資料
-- 寫一份解讀+建議的報告，PDF只是這份報告的其中一種輸出形式。每次生成都要存起來，
-- 之後使用者可以回頭看/重新下載，不用每次都重新生成（也省AI額度）。
create table if not exists ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,           -- TimeScope: all / natural_month / custom_cycle / custom_range
  period_label text not null,    -- 人類可讀期間文字，例如「2026/08/01 ~ 2026/08/31」
  period_start date not null,
  period_end date not null,
  content jsonb not null,        -- AiReportContent：{ overallAssessment, keyPoints[], anomalyFindings[], suggestions[] }
  created_at timestamptz not null default now()
);

alter table ai_reports enable row level security;

create policy "只能存取自己的戰情報告" on ai_reports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_ai_reports_user_created on ai_reports(user_id, created_at desc);
