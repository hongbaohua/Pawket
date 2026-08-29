import React, { useState, useEffect } from 'react';

// 2026-07-22 Ivy反應金額欄位太死板：原價/折扣/代購費/匯率/進位規則每家代購都不一樣，
// 原本用Excel試算表可以直接打公式，現在被拆成好幾個獨立欄位反而更亂。
// 讓金額欄位可以直接打算式(例如 280*0.93*0.85+50、ceil(280*0.93))，
// 失焦時自動算成數字，不用把每個計算因素都拆成單獨欄位——想怎麼算都可以，跟Excel一樣。
const evalMathExpression = (expr: string): number | null => {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  let jsExpr = trimmed;
  ['round', 'ceil', 'floor'].forEach(fn => {
    jsExpr = jsExpr.replace(new RegExp(`\\b${fn}\\s*\\(`, 'g'), `Math.${fn}(`);
  });
  // 白名單檢查：把允許的Math.xxx函式名拿掉之後，剩下的字元只能是數字/運算子/括號/逗號，
  // 防止使用者(或萬一被塞入的內容)夾帶任意程式碼。
  const stripped = jsExpr.replace(/Math\.(round|ceil|floor)/g, '');
  if (!/^[0-9+\-*/().,\s]+$/.test(stripped)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${jsExpr});`)();
    return typeof result === 'number' && isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

// 2026-08-29 從EditTransactionModal.tsx抽出來共用（TransferModal的「金額」欄位
// 在手機上完全點不了輸入，查證後發現是用了plain <input type="number"> 直接把
// React state綁在parseFloat(e.target.value)上，這是行動裝置上controlled number
// input常見的問題來源；CalcInput改用type="text"+本地draft state，只在blur時才
// 真正解析成數字，不會有這個問題，且已經在EditTransactionModal驗證過可以正常用。
export const CalcInput = React.forwardRef<HTMLInputElement, {
  value: number | undefined;
  onCommit: (n: number) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
}>(({ value, onCommit, className, placeholder, readOnly }, ref) => {
  // value是NaN代表「這欄位還沒填」的哨兵值(不是使用者真的打了NaN)，顯示空白
  // 而不是字面上的"0"——不然新增交易/新增折扣列時，輸入框會卡一個要先刪掉的"0"。
  const isBlank = (v: number | undefined) => v == null || isNaN(v);
  const [draft, setDraft] = useState(isBlank(value) ? '' : String(value));
  useEffect(() => { setDraft(isBlank(value) ? '' : String(value)); }, [value]);
  return (
    <input
      ref={ref}
      type="text"
      // 2026-07-24 修正：這裡故意不設inputMode="decimal"——手機上decimal模式只會跳出
      // 純數字鍵盤(沒有+-*/()跟英文字母)，讓Ivy根本打不了算式(這正是這個欄位存在的目的)。
      // 不設inputMode會用瀏覽器預設的完整鍵盤，才能真的打出 280*0.93+50 這種算式。
      readOnly={readOnly}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      // 2026-08-13：Ivy反應數字欄位裡常常已經有個預設值，要先手動刪掉才能打新的很麻煩——
      // 點進欄位時自動全選內容，直接打字就會整個覆蓋掉，不用自己刪。
      onFocus={e => e.target.select()}
      onBlur={() => {
        const result = evalMathExpression(draft);
        if (result != null) {
          const rounded = Math.round(result * 100) / 100;
          onCommit(rounded);
          setDraft(String(rounded));
        } else {
          setDraft(value != null ? String(value) : '');
        }
      }}
      className={className}
      placeholder={placeholder}
    />
  );
});
