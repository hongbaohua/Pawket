// Supabase 連線設定。
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 這兩個值要放在 .env.local（本機開發用）
// 以及 Vercel 專案的環境變數設定（正式網站用），兩邊都要設定才能連得上。
// 這兩個值本身不是密碼，資料安全是靠 supabase/schema.sql 裡的 Row Level Security 規則保護。

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// 還沒設定時，記得要不要顯示「尚未設定 Supabase」畫面而不是整頁空白（見 App.tsx）
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    '尚未設定 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請在 .env.local 加入這兩個環境變數。'
  );
}

// createClient 遇到空字串網址會直接拋錯讓整個 App 崩潰，所以沒設定時給一個格式正確的假網址頂著，
// 讓畫面至少能正常渲染出「尚未設定」的提示，而不是白屏。
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);
