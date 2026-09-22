// 作品集截圖腳本（2026-09-21 建立，2026-09-22 改成一功能一張的細分版）
//
// 用本機 Chrome（無頭模式）登入示範帳號，逐個功能截圖，給作品集 ai-pawket.html
// 的「重啟版 App 截圖」區用。搭配 seed_demo_account.py：那支負責建立示範帳號＋
// 灌假資料，這支負責拍照。App 之後改版要重拍截圖，先跑 seed 再跑這支。
//
// 事前準備（只有要跑這支時才需要，刻意不寫進 package.json，免得 Vercel 每次
// 建置都多裝一包用不到的東西）：
//   1. 另外開一個資料夾，npm init -y && npm i puppeteer-core
//   2. 把這支複製過去，並在 Pawket 資料夾跑 npm run dev（腳本固定連 localhost:3000）
//   3. node capture_demo_screenshots.mjs              ← 拍全部（約 45 張）
//      node capture_demo_screenshots.mjs 對帳結果 心願罐   ← 只拍指定幾張
//
// 「對帳結果」那張會真的跑一次完整比對流程（含呼叫 Gemini 解析 PDF），需要
// data-import/demo_statement.html 先用 build_demo_statement.py 產生好，腳本會
// 自己把它轉成 PDF 再上傳。
//
// 輸出：預設丟在 SHOT_OUT 指定的資料夾。拍出來是 2 倍解析度，交付給作品集前
// 縮成 1 倍（1440px 寬，跟原型版那批截圖同尺寸），縮圖指令（需 pip install pillow）：
//
//   python -c "import os;from PIL import Image;S=r'<拍出來的資料夾>';D=r'C:/Users/user/Projects/Portfolio/web/assets/images/Pawket/Claude Code重啟版截圖';[Image.open(os.path.join(S,f)).resize((Image.open(os.path.join(S,f)).width//2,Image.open(os.path.join(S,f)).height//2),Image.LANCZOS).save(os.path.join(D,f),optimize=True) for f in os.listdir(S) if f.endswith('.png')]"
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://localhost:3000';
const SUPA = 'https://fwiroptbupupkbfxmfqu.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3aXJvcHRidXB1cGtiZnhtZnF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNzI3NjMsImV4cCI6MjA5OTg0ODc2M30.NyYJsZEPwuPPKk9vy4M6IFf7mE-ExF43rl1S7GheF1Q';
const OUT = process.env.SHOT_OUT || 'C:/Users/user/AppData/Local/Temp/claude/C--Users-user-Projects-Pawket/a31efab8-287f-4a33-82d7-c2546715ccd9/scratchpad/shots/out';
const STATEMENT_PDF = 'C:/Users/user/Projects/Pawket/Pawket/data-import/demo_statement.pdf';

const W = 1440;          // 桌機版截圖寬度（CSS px）
const DSF = 2;           // 先用 2 倍解析度拍，之後再縮回 1 倍，字會比直接 1 倍拍銳利
const MOBILE = { width: 390, height: 844 };

const creds = fs.readFileSync('C:/Users/user/Projects/Pawket/示範帳號_作品集截圖用.txt', 'utf8');
const EMAIL = creds.match(/帳號：(.+)/)[1].trim();
const PASSWORD = creds.match(/密碼：(.+)/)[1].trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function session() {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('登入失敗：' + JSON.stringify(d).slice(0, 200));
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_in: d.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + d.expires_in, token_type: 'bearer', user: d.user };
}

// 用「看得到的文字」點畫面元素，挑符合的最內層那個，避免點到外層容器
async function click(page, text, opts = {}) {
  const { nth = 0, exact = false } = opts;
  const ok = await page.evaluate((t, nth, exact) => {
    const all = [...document.querySelectorAll('button, a, [role="button"], label, li, div, span, h2, h3')];
    let hits = all.filter(el => {
      const s = (el.innerText || '').trim();
      return s && (exact ? s === t : s.includes(t));
    });
    hits = hits.filter(el => !hits.some(o => o !== el && el.contains(o)));
    hits = hits.filter(el => el.getClientRects().length);
    const el = hits[nth];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    (el.closest('button, a, [role="button"], label') || el).click();
    return true;
  }, text, nth, exact);
  if (!ok) throw new Error(`找不到可點的「${text}」`);
  await sleep(800);
}

// 點某一列交易的操作按鈕（0=分裝盤 1=編輯 2=複製 3=刪除）
async function rowAction(page, merchant, btnIndex) {
  const ok = await page.evaluate((t, i) => {
    // 先找「第一行剛好就是這個商家名」的格子（列上的備註也可能提到同一個名字，
    // 例如「小美還款／燒肉眾分帳結清」，只用 includes 會開到錯的那一列）
    let hits = [...document.querySelectorAll('div, span, p, td')]
      .filter(e => ((e.innerText || '').trim().split(String.fromCharCode(10))[0] || '').trim() === t);
    if (!hits.length) {
      hits = [...document.querySelectorAll('div, span, p, td')]
        .filter(e => (e.innerText || '').trim().includes(t));
    }
    hits = hits.filter(e => !hits.some(o => o !== e && e.contains(o)));
    for (const hit of hits) {
      let p = hit;
      while (p && p.querySelectorAll('button').length < 3) p = p.parentElement;
      if (p) {
        const b = p.querySelectorAll('button')[i];
        if (b) { p.scrollIntoView({ block: 'center' }); b.click(); return true; }
      }
    }
    return false;
  }, merchant, btnIndex);
  if (!ok) throw new Error(`找不到「${merchant}」那一列的第 ${btnIndex} 個按鈕`);
  await sleep(900);
}

async function type(page, placeholder, text) {
  const el = await page.$(`input[placeholder*="${placeholder}"]`);
  if (!el) throw new Error(`找不到 placeholder 含「${placeholder}」的輸入框`);
  await el.click();
  await el.type(text, { delay: 25 });
  await sleep(900);
}

async function waitText(page, text, timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(t => document.body.innerText.includes(t), text)) return;
    await sleep(300);
  }
  throw new Error(`等不到畫面上出現「${text}」`);
}

// 把視窗高度調整到「整頁或整個彈窗剛好裝得下」
async function fitViewport(page, { maxH = 2600, width = W } = {}) {
  let h = 900;
  for (let i = 0; i < 4; i++) {
    const m = await page.evaluate(() => {
      // 只有「蓋滿整個畫面的那層」才算彈窗遮罩；側欄也是 fixed，但它只佔一小塊，
      // 誤判成彈窗會讓視窗高度被算得太矮，整頁截圖就被攔腰切掉。
      const overlays = [...document.querySelectorAll('.fixed')].filter(e => {
        if (!e.getClientRects().length || getComputedStyle(e).position !== 'fixed') return false;
        const r = e.getBoundingClientRect();
        return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      });
      const overlay = overlays[overlays.length - 1];
      let panel = 0;
      if (overlay) {
        for (const el of overlay.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width > 260 && r.height > 200) panel = Math.max(panel, el.scrollHeight);
        }
      }
      return { panel, doc: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) };
    });
    const target = m.panel ? Math.ceil(m.panel / 0.9) + 110 : m.doc;
    const next = Math.min(Math.max(target, 700), maxH);
    if (Math.abs(next - h) < 24) break;
    h = next;
    await page.setViewport({ width, height: Math.round(h), deviceScaleFactor: DSF });
    await sleep(700);
  }
  await page.setViewport({ width, height: Math.round(h), deviceScaleFactor: DSF });
  await sleep(800);
  return h;
}

async function shot(page, name, { maxH = 2600, mobile = false } = {}) {
  await sleep(600);
  const width = mobile ? MOBILE.width : W;
  const h = await fitViewport(page, { maxH, width });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  await page.setViewport({ width, height: mobile ? MOBILE.height : 900, deviceScaleFactor: DSF });
  console.log(`  OK ${name}.png (${Math.round(fs.statSync(file).size / 1024)} KB, ${width}x${Math.round(h)})`);
}

// 單張卡片特寫：找到含 anchor 文字、而且夠寬（minWidth）的那層容器，只裁它＋留白。
async function shotEl(page, name, anchor, { pad = 18, minWidth = 380, maxH = 3400, mobile = false, nth = 0 } = {}) {
  const width = mobile ? MOBILE.width : W;
  await fitViewport(page, { maxH, width });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  const box = await page.evaluate((anchor, minWidth, nth) => {
    let hits = [...document.querySelectorAll('div, section, table')]
      .filter(e => (e.innerText || '').trim().startsWith(anchor) && e.getClientRects().length);
    hits = hits.filter(e => !hits.some(o => o !== e && e.contains(o) && o.getBoundingClientRect().width >= minWidth));
    let el = hits[nth];
    if (!el) {
      // 退而求其次：文字含 anchor 就好（有些卡片標題前面還有 icon 的文字節點）
      let loose = [...document.querySelectorAll('div, section, table')]
        .filter(e => (e.innerText || '').includes(anchor) && e.getClientRects().length);
      loose.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
      el = loose.find(e => e.getBoundingClientRect().width >= minWidth);
    }
    if (!el) return null;
    // 往上爬到「看起來像一張卡片」的那層：有底色、有圓角、而且夠寬。
    // 只用寬度判斷會停在卡片內部的標題列，裁出來只有一條（實測 04/05/06 就是這樣）。
    const looksLikeCard = e => {
      const st = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const radius = parseFloat(st.borderTopLeftRadius) || 0;
      const hasBg = st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent';
      return hasBg && radius >= 14 && r.width >= minWidth && r.height >= 60;
    };
    let card = el;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      if (looksLikeCard(card)) break;
      card = card.parentElement;
    }
    el = looksLikeCard(card) ? card : el;
    while (el.parentElement && el.getBoundingClientRect().width < minWidth) el = el.parentElement;
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
  }, anchor, minWidth, nth);
  if (!box) throw new Error(`找不到含「${anchor}」的卡片`);
  const vp = page.viewport();
  const clip = {
    x: Math.max(box.x - pad, 0),
    y: Math.max(box.y - pad, 0),
    width: Math.min(box.width + pad * 2, vp.width - Math.max(box.x - pad, 0)),
    height: Math.min(box.height + pad * 2, vp.height - Math.max(box.y - pad, 0)),
  };
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, clip });
  await page.setViewport({ width, height: mobile ? MOBILE.height : 900, deviceScaleFactor: DSF });
  console.log(`  OK ${name}.png (${Math.round(fs.statSync(file).size / 1024)} KB, ${Math.round(clip.width)}x${Math.round(clip.height)} 特寫)`);
}

async function home(page, view = 'dashboard') {
  await page.evaluate(v => localStorage.setItem('pawket_view', v), view);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2600);
}

// ── 每一張圖只講一件事：檔名前面的編號＝作品集章節順序 ────────────────
const shots = {
  // ── 00 登入 ──
  async 登入畫面(page) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2200);
    await shot(page, '00_登入畫面', { maxH: 900 });
    // 拍完把登入狀態放回去
    await page.evaluate(s => {
      localStorage.setItem('sb-fwiroptbupupkbfxmfqu-auth-token', JSON.stringify(s));
      localStorage.setItem('pawket_view', 'dashboard');
    }, globalThis.__sess);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
  },

  // ── 01 首頁 貓咪指揮中心 ──
  async 首頁總覽(page) {
    await home(page);
    await waitText(page, '貓咪指揮中心');
    await shot(page, '01_首頁_全頁總覽', { maxH: 3400 });
  },
  async 情緒指標(page) {
    await home(page);
    await shotEl(page, '02_首頁_Meowney情緒指標', 'Meowney 情緒指標', { minWidth: 700 });
  },
  async 本期現金流(page) {
    await home(page);
    await shotEl(page, '03_首頁_本期現金流', '本期現金流', { minWidth: 700 });
  },
  async 帳戶餘額總覽(page) {
    await home(page);
    await click(page, '帳戶餘額總覽');
    await shotEl(page, '04_首頁_帳戶餘額總覽', '帳戶餘額總覽', { minWidth: 700 });
  },
  async 現金緩衝(page) {
    await home(page);
    await shotEl(page, '05_首頁_現金緩衝耗盡預警', '現金緩衝耗盡預警', { minWidth: 700 });
  },
  async 心願罐卡片(page) {
    await home(page);
    await shotEl(page, '06_首頁_最想買的心願卡', '人體工學椅', { minWidth: 380 });
  },
  async 消費分類比率(page) {
    await home(page);
    await shotEl(page, '07_首頁_本期消費分類比率', '本期消費分類比率', { minWidth: 380 });
  },
  async 糧食往來簿卡(page) {
    await home(page);
    await shotEl(page, '08_首頁_糧食往來簿摘要', '糧食往來簿', { minWidth: 700 });
  },
  async 分類洞察(page) {
    await home(page);
    await shotEl(page, '09_首頁_分類洞察三卡', '分類洞察', { minWidth: 700 });
  },
  async 配速警示(page) {
    await home(page);
    await shotEl(page, '10_首頁_需立即關注的項目', '需立即關注的項目', { minWidth: 700 });
  },
  async 財務結構(page) {
    await home(page);
    await shotEl(page, '11_首頁_財務結構分析', '財務結構分析', { minWidth: 700 });
  },
  async 固定週期性(page) {
    await home(page);
    await shotEl(page, '12_首頁_固定週期性支出', '固定週期性支出', { minWidth: 700 });
  },
  async 期間切換與設定(page) {
    await home(page);
    await page.evaluate(() => {
      const gear = [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-settings'));
      gear && gear.click();
    });
    await sleep(900);
    await shotEl(page, '13_首頁_期間切換與超支扣零食設定', '理財週期', { minWidth: 260, pad: 24 });
  },

  // ── 02 罐罐明細本 ──
  async 明細本(page) {
    await home(page, 'transactions');
    await waitText(page, '罐罐明細本');
    await shot(page, '20_明細本_全頁', { maxH: 2200 });
  },
  async 明細本列特寫(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '兩廳院');
    await shotEl(page, '21_明細本_一列裡有什麼', '日期', { minWidth: 700, pad: 12 });
  },
  async 明細本分類篩選(page) {
    await home(page, 'transactions');
    await click(page, '分類篩選');
    await shot(page, '22_明細本_分類階層篩選', { maxH: 1800 });
  },
  async 明細本搜尋(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '喵星人');
    await shot(page, '23_明細本_快速查找', { maxH: 1400 });
  },
  async 垃圾桶(page) {
    await home(page, 'transactions');
    await click(page, '垃圾桶');
    await shot(page, '24_明細本_垃圾桶', { maxH: 1200 });
  },

  // ── 03 新增/編輯交易 ──
  async 新增交易(page) {
    await home(page);
    await click(page, '新增收支');
    await shot(page, '30_新增交易_完整表單', { maxH: 2400 });
  },
  async 金額拆分(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '蝦皮');
    await rowAction(page, '蝦皮購物', 1);
    await click(page, '折扣明細');
    await sleep(600);
    await shotEl(page, '31_編輯交易_金額拆分', '原始金額（折扣前', { minWidth: 380, pad: 46 });
  },
  async 購物清單品項(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '兩廳院');
    await rowAction(page, '兩廳院售票', 1);
    await shotEl(page, '32_編輯交易_喵喵購物清單與套餐子品項', '喵喵購物清單', { minWidth: 420, pad: 20 });
  },
  async 特殊性質(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '日本零食');
    await rowAction(page, '日本零食代購', 1);
    await shotEl(page, '33_編輯交易_特殊性質與快速結清', '特殊性質', { minWidth: 420, pad: 20 });
  },
  async 分類歸屬(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '喵星人');
    await rowAction(page, '喵星人寵物店', 1);
    await shotEl(page, '34_編輯交易_分類歸屬', '分類歸屬', { minWidth: 420, pad: 20 });
  },
  async 帳戶互轉(page) {
    await home(page, 'transactions');
    await click(page, '新增', { exact: true });
    await click(page, '帳戶互轉');
    await shot(page, '36_帳戶互轉', { maxH: 1600 });
  },
  async 分裝盤(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '週末食材');
    await rowAction(page, '週末食材', 0);
    await shot(page, '37_貓咪零食分裝盤', { maxH: 2000 });
  },

  // ── 04 分帳 ──
  async 這碗跟誰分(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '燒肉眾');
    await rowAction(page, '燒肉眾', 1);
    await click(page, '編輯這碗跟誰分');
    await shot(page, '40_這碗跟誰分', { maxH: 2000 });
  },
  async 糧食往來簿(page) {
    await home(page);
    await click(page, '糧食往來簿');
    await shot(page, '41_糧食往來簿清單', { maxH: 1800 });
  },
  async 標記已結清(page) {
    await home(page);
    await click(page, '糧食往來簿');
    await click(page, '標記已結清');
    await shot(page, '42_糧食往來簿_標記已結清', { maxH: 1800 });
  },

  // ── 05 餵食核對（對帳） ──
  async 對帳上傳(page) {
    await home(page, 'reconcile');
    await shot(page, '50_餵食核對_上傳對帳單', { maxH: 1400 });
  },
  async 對帳結果(page) {
    // 先把最新的 demo_statement.html 轉成 PDF 再上傳：之前踩過一次——重灌假資料後
    // 只重新產生 HTML、忘了重轉 PDF，對帳就拿舊金額去比，畫面上多出一堆對不上的差異。
    const pdfPage = await page.browser().newPage();
    await pdfPage.goto('file:///C:/Users/user/Projects/Pawket/Pawket/data-import/demo_statement.html', { waitUntil: 'networkidle0' });
    await pdfPage.pdf({ path: STATEMENT_PDF, format: 'A4', printBackground: true });
    await pdfPage.close();

    await home(page, 'reconcile');
    await page.select('select', await page.evaluate(() => {
      const sel = document.querySelector('select');
      return [...sel.options].find(o => o.textContent.includes('喵喵銀行')).value;
    }));
    await sleep(800);
    const input = await page.$('input[type=file]');
    await input.uploadFile(STATEMENT_PDF);
    await sleep(1500);
    await click(page, '開始比對');
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const done = await page.evaluate(() => /已比對成功|全部對得上|解析失敗/.test(document.body.innerText));
      if (done) break;
    }
    await shot(page, '51_餵食核對_比對結果', { maxH: 2200 });
    await click(page, '查看這份對帳單的完整原始資料');
    await sleep(800);
    await shot(page, '52_餵食核對_逐筆原始資料', { maxH: 2400 });
  },

  // ── 06 喵喵心願罐 ──
  async 心願罐(page) {
    await home(page);
    await click(page, '查看完整清單');
    await shot(page, '60_喵喵心願罐', { maxH: 2000 });
  },

  // ── 07 戰情報告 ──
  async 戰情報告選期間(page) {
    await home(page);
    await click(page, '戰情報告');
    await sleep(1200);
    await shot(page, '70_戰情報告_選擇分析期間', { maxH: 1600 });
  },
  async 戰情報告內容(page) {
    await home(page);
    await click(page, '戰情報告');
    await sleep(1200);
    await click(page, '自然月度');
    await sleep(1500);
    await shot(page, '71_戰情報告_AI解讀內容', { maxH: 2400 });
  },

  // ── 08 系統設定 ──
  async 系統設定總覽(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await shot(page, '80_系統設定_總覽', { maxH: 1800 });
  },
  async 分類預算(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '分類預算設定');
    await shot(page, '81_系統設定_分類月預算', { maxH: 2200 });
  },
  async 長期預留(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '長期預留支出與安全水位');
    await shot(page, '82_系統設定_長期預留支出與安全水位', { maxH: 2200 });
  },
  async 碗盤總覽(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '碗盤總覽');
    await shot(page, '83_系統設定_碗盤總覽', { maxH: 2200 });
  },
  async 帳戶編輯(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '碗盤總覽');
    await click(page, '編輯', { exact: true, nth: 1 });
    await sleep(700);
    await shot(page, '84_系統設定_帳戶與入帳延遲設定', { maxH: 2200 });
  },

  // ── 09 重新裝碗紀錄 ──
  async 重新裝碗紀錄(page) {
    await home(page, 'activityLog');
    await sleep(1200);
    await shot(page, '90_重新裝碗紀錄', { maxH: 1600 });
  },

  // ── 10 手機版 ──
  async 手機首頁(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page);
    await waitText(page, '貓咪指揮中心');
    await shot(page, 'M1_手機_貓咪指揮中心', { maxH: 2600, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },
  async 手機明細本(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page, 'transactions');
    await waitText(page, '罐罐明細本');
    await shot(page, 'M2_手機_罐罐明細本', { maxH: 1800, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },
  async 手機新增交易(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page);
    await click(page, '新增收支');
    await shot(page, 'M3_手機_新增交易步驟式表單', { maxH: 1800, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },
  async 手機餵食核對(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page, 'reconcile');
    await shot(page, 'M4_手機_餵食核對', { maxH: 1800, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },
};

async function run() {
  const only = process.argv.slice(2);
  const sess = await session();
  globalThis.__sess = sess;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.evaluate(s => {
    localStorage.setItem('sb-fwiroptbupupkbfxmfqu-auth-token', JSON.stringify(s));
    localStorage.setItem('pawket_view', 'dashboard');
  }, sess);
  await page.reload({ waitUntil: 'networkidle2' });
  await waitText(page, '貓咪指揮中心', 30000);

  for (const [name, fn] of Object.entries(shots)) {
    if (only.length && !only.includes(name)) continue;
    console.log(`> ${name}`);
    try { await fn(page); }
    catch (e) { console.log(`  FAIL ${name}: ${e.message}`); }
  }
  if (errors.length) console.log('console errors:', JSON.stringify([...new Set(errors)].slice(0, 5)));
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
