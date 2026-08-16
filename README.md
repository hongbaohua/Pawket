# Pawket（喵喵財庫）

個人記帳 App。原本是用 Google AI Studio 生成的 React + TypeScript 原型（純前端、
沒有資料持久化），2026-07-17 起由 [Claude Code](https://claude.com/claude-code)
接手正式重啟：資料庫化（Supabase）、多帳戶模型、對帳、真實財務資料匯入、
喵喵心願罐（願望清單）、共同支出/代墊分帳等。

專案脈絡跟每個階段的詳細現況記錄在專案根目錄外層的 `CLAUDE.md` /
`專案文件/PROJECT_STATUS.md`（這兩份是給接手開發的 Claude Code session 看的
技術文件，不在這個資料夾裡）。

## 技術棧

- React + TypeScript + Vite
- Tailwind CSS
- Supabase（Postgres + Auth，Email/密碼登入）
- Google Gemini API（收據/對帳單 OCR 結構化辨識）
- Vercel（部署）

## 本機開發

**前置需求：** Node.js

1. 安裝套件：`npm install`
2. 在 `.env.local` 設定：
   - `GEMINI_API_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. 啟動開發伺服器：`npm run dev`
4. 型別檢查：`npx tsc --noEmit`

## 資料庫

Schema 定義跟一次性資料修正腳本在 `supabase/` 資料夾（`schema.sql` 是完整結構，
`migration_*.sql` 是後續 schema 異動，`fix_*.sql` 是真實資料的一次性修正，
不進版本控管，含真實個人財務資料）。
