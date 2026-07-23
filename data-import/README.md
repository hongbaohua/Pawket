# 中信對帳單匯入 — 分析腳本與待處理資料

這個資料夾記錄 2026-07-19 那次「把 `對帳資料/中國信託/中信餘額_正確答案.xlsx` 轉成
系統格式並匯入」的過程，供之後接手的 session（或人）參考/重跑。

## 檔案說明

- `build_import2.py` / `categorize_rules.py` — 分析腳本本體。讀取 xlsx（775筆，
  路徑寫在腳本裡是 `對帳資料/中國信託/中信餘額_正確答案.xlsx`）+
  `對帳資料/Ivy手標歷史分類參考/4-9.json`（155筆歷史分類），做商家比對＋分類，Ivy 確認過的個別修正
  寫死在 `ROW_OVERRIDES`（7-11被Excel誤判成日期、Relove=除毛膏、蒔初=餐廳等）。
  跑法：`python build_import2.py`（需要先跑通這個才能跑 export_final.py）。
- `export_final.py` — 把分析結果轉成 App 用的 Transaction JSON 格式。
- `final_records.json` — 775筆全部的分析結果（含分類來源標記，方便追溯是
  4-9.json比對到的、關鍵字規則猜的、還是Ivy親自確認的）。
- `pending_transfers.json` — **還沒匯入**的 25 筆轉帳（提款/存款轉現金）。
  每筆只有 `transferDirection`（'CTBC->CASH' 或 'CASH->CTBC'）、日期、金額，
  沒有真正的帳戶 ID，因為帳戶要 Ivy 登入後在資料庫裡建立才有 ID。

## 下一步要做的事（轉帳匯入小工具）

`../匯入_中信對帳_775筆.json`（750筆收支，已可直接用App現有的「匯入」按鈕匯入）
跟這 25 筆轉帳是分開處理的。要讓這 25 筆能匯入，需要：

1. 確認 Ivy 已經在「帳戶管理」建好「中國信託」帳戶（現金應該登入時就有預設）。
2. 寫一個小工具（可以是暫時性的瀏覽器 console script，或正式功能）：
   讀 `pending_transfers.json`，把 `transferDirection` 換成真正的
   `fromAccountId`/`toAccountId`（比對 Ivy 目前 accounts 清單裡
   `name === '中國信託'` 跟 `name === '現金'` 的帳戶 id），
   組成 `type: 'transfer'` 的 Transaction，透過 `lib/db.ts` 的
   `upsertTransactions` 寫進資料庫。
3. 這 25 筆的 `originalText` 已經帶有原始列號跟類型，方便核對。
