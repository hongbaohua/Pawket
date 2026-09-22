import React, { useState } from 'react';
import { Cat, Mail, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// 登入畫面：一般帳號密碼登入。第一次用「註冊」建立帳號，之後直接用「登入」，
// 不用每次都收信點連結。登入狀態會存在瀏覽器裡，重新整理頁面不會登出。

// Supabase 回傳的錯誤訊息全部是英文原文，直接丟到畫面上對使用者沒有意義
// （例如「Invalid login credentials」），常見的幾種翻成看得懂的說法。
// 沒對應到的還是照原文顯示，至少不會把真正的錯誤吃掉。
const AUTH_ERROR_MESSAGES: { match: string; message: string }[] = [
  { match: 'Invalid login credentials', message: 'Email 或密碼不正確' },
  { match: 'Email not confirmed', message: '這個 Email 還沒完成驗證，請先去信箱點確認連結' },
  { match: 'User already registered', message: '這個 Email 已經註冊過了，直接用「登入」就可以' },
  { match: 'Password should be at least', message: '密碼太短了，至少要 6 碼' },
  { match: 'Unable to validate email address', message: 'Email 格式看起來不太對，請再確認一次' },
  { match: 'For security purposes', message: '剛剛嘗試太多次了，請等幾秒再試一次' },
  { match: 'Failed to fetch', message: '連不上伺服器，請確認網路連線後再試一次' },
];

const translateAuthError = (raw: string): string =>
  AUTH_ERROR_MESSAGES.find(e => raw.includes(e.match))?.message || raw;
const Auth: React.FC = () => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'signedUpPendingConfirm' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus('loading');
    setErrorMsg('');

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) {
        setStatus('error');
        setErrorMsg(translateAuthError(error.message));
      } else if (!data.session) {
        // 專案有開「Email 確認」的話，註冊後不會立刻拿到 session，要先去信箱確認一次。
        setStatus('signedUpPendingConfirm');
      }
      // 有 session 的話代表已經直接登入，App.tsx 的 onAuthStateChange 會自動接手切換畫面。
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setStatus('error');
        setErrorMsg(translateAuthError(error.message));
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 p-10 flex flex-col items-center text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-amber-300 to-orange-400 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100 text-white mb-6">
          <Cat className="w-9 h-9" />
        </div>
        <h1 className="text-2xl font-extrabold text-slate-700 mb-1">Paw<span className="text-amber-500">ket</span> 喵喵財庫</h1>
        <p className="text-xs font-bold text-slate-300 mb-2">讓每一分錢都變成可愛的形狀 ✨</p>

        {status === 'signedUpPendingConfirm' ? (
          <div className="flex flex-col items-center gap-3 text-emerald-600 mt-4">
            <CheckCircle2 className="w-10 h-10" />
            <p className="font-bold">註冊成功！</p>
            <p className="text-sm text-slate-400">去 {email} 的信箱點一次確認連結，之後就能直接用密碼登入。</p>
          </div>
        ) : (
          <>
            <div className="flex p-1.5 bg-[#FFFBF5] rounded-2xl border border-slate-100 mb-6 w-full">
              <button
                type="button"
                onClick={() => { setMode('signin'); setStatus('idle'); setErrorMsg(''); }}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${mode === 'signin' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400'}`}
              >
                登入
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setStatus('idle'); setErrorMsg(''); }}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${mode === 'signup' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400'}`}
              >
                註冊
              </button>
            </div>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-12 pr-4 py-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl text-slate-700 font-bold outline-none focus:border-amber-300"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="密碼（至少 6 碼）"
                  className="w-full pl-12 pr-4 py-3 bg-[#FFFBF5] border border-slate-100 rounded-2xl text-slate-700 font-bold outline-none focus:border-amber-300"
                />
              </div>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full py-3 bg-amber-400 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-lg shadow-amber-100 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : (mode === 'signup' ? '註冊' : '登入')}
              </button>
              {status === 'error' && <p className="text-rose-500 text-sm font-bold">{errorMsg}</p>}
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default Auth;
