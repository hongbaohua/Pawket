import React, { useState } from 'react';
import { Cat, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// 登入畫面：用 Email 收「登入連結」(Magic Link)，不用另外設密碼。
// 點連結後 Supabase 會建立登入狀態，App.tsx 偵測到有登入狀態就會放行進主畫面。
const Auth: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
    } else {
      setStatus('sent');
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-[40px] shadow-xl shadow-orange-50/50 border border-orange-50 p-10 flex flex-col items-center text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-amber-300 to-orange-400 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100 text-white mb-6">
          <Cat className="w-9 h-9" />
        </div>
        <h1 className="text-2xl font-extrabold text-slate-700 mb-2">Paw<span className="text-amber-500">ket</span></h1>
        <p className="text-slate-400 font-medium mb-8">輸入 Email，我們會寄一個登入連結給你</p>

        {status === 'sent' ? (
          <div className="flex flex-col items-center gap-3 text-emerald-600">
            <CheckCircle2 className="w-10 h-10" />
            <p className="font-bold">連結已寄出！</p>
            <p className="text-sm text-slate-400">去 {email} 的信箱點連結，就會自動登入。</p>
          </div>
        ) : (
          <form onSubmit={handleSendLink} className="w-full flex flex-col gap-4">
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
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-3 bg-amber-400 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-lg shadow-amber-100 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {status === 'sending' ? <Loader2 className="w-5 h-5 animate-spin" /> : '傳送登入連結'}
            </button>
            {status === 'error' && <p className="text-rose-500 text-sm font-bold">{errorMsg}</p>}
          </form>
        )}
      </div>
    </div>
  );
};

export default Auth;
