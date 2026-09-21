// 作品集截圖腳本（2026-09-21 建立）：用本機 Chrome（無頭模式）登入示範帳號，
// 把 App 各個畫面逐一拍成圖，給作品集 ai-pawket.html 的「重啟版 App 截圖」區用。
//
// 搭配 seed_demo_account.py 使用：那支負責建立示範帳號＋灌假資料，這支負責拍照。
// App 之後有新功能、要重拍截圖時，先跑 seed_demo_account.py 重建資料，再跑這支。
//
// 事前準備（只有要跑這支時才需要，刻意不寫進 package.json，免得 Vercel 每次建置
// 都多裝一包用不到的東西）：
//   1. 另外開一個資料夾，npm init -y && npm i puppeteer-core
//   2. 把這支複製過去，cd 到 Pawket 資料夾跑 npm run dev（腳本固定連 localhost:3000）
//   3. node capture_demo_screenshots.mjs          ← 拍全部
//      node capture_demo_screenshots.mjs 罐罐明細本 垃圾桶   ← 只拍指定幾張
//
// 輸出：預設丟在 C:/Users/user/Projects/Pawket/screenshots_2x（可用 SHOT_OUT 環境變數
// 改）。拍出來是 2 倍解析度，交付給作品集前縮成 1 倍（1440px 寬，跟原型版那批截圖
// 同尺寸），縮圖指令（需要 pip install pillow）：
//
//   python -c "import os;from PIL import Image;S=r'C:/Users/user/Projects/Pawket/screenshots_2x';D=r'C:/Users/user/Projects/Portfolio/web/assets/images/Pawket/Claude Code重啟版截圖';os.makedirs(D,exist_ok=True);[Image.open(os.path.join(S,f)).resize((Image.open(os.path.join(S,f)).width//2,Image.open(os.path.join(S,f)).height//2),Image.LANCZOS).save(os.path.join(D,f),optimize=True) for f in os.listdir(S) if f.endswith('.png')]"
//
// 截圖一律用「把瀏覽器視窗拉到跟內容一樣高」的方式拍（不是 fullPage），
// 因為 fullPage 會讓 Chrome 改用超高的模擬視窗，RWD 斷點會錯亂、版面跑成手機版。
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://localhost:3000';
const SUPA = 'https://fwiroptbupupkbfxmfqu.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3aXJvcHRidXB1cGtiZnhtZnF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNzI3NjMsImV4cCI6MjA5OTg0ODc2M30.NyYJsZEPwuPPKk9vy4M6IFf7mE-ExF43rl1S7GheF1Q';
const OUT = process.env.SHOT_OUT || 'C:/Users/user/Projects/Pawket/screenshots_2x';

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
    // 找「文字含 t、但底下沒有其他也含 t 的元素」那個最內層節點，再往上找到
    // 整列的容器（列上有分裝/編輯/複製/刪除四顆按鈕，所以用按鈕數判斷）
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
  await el.type(text, { delay: 30 });
  await sleep(900);
}

async function waitText(page, text, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(t => document.body.innerText.includes(t), text)) return;
    await sleep(300);
  }
  throw new Error(`等不到畫面上出現「${text}」`);
}

async function shot(page, name, { maxH = 2600, mobile = false } = {}) {
  await sleep(800);
  const width = mobile ? MOBILE.width : W;
  // 彈窗是 max-h-[90vh] + 內層 overflow-y-auto，所以視窗越高、彈窗才展得越開。
  // 量一次、調一次視窗高度，重複幾輪直到整個彈窗（或整頁）剛好裝得下為止。
  let h = 900;
  for (let i = 0; i < 4; i++) {
    const m = await page.evaluate(() => {
      // 只有「蓋滿整個畫面的那層」才算彈窗遮罩；側欄也是 fixed，但它只佔一小塊，
      // 不能被誤判成彈窗（誤判會讓視窗高度被算成很矮，整頁截圖就被切掉）
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
      return {
        panel,
        doc: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      };
    });
    const target = m.panel ? Math.ceil(m.panel / 0.9) + 110 : m.doc;
    const next = Math.min(Math.max(target, 700), maxH);
    if (Math.abs(next - h) < 24) break;
    h = next;
    await page.setViewport({ width, height: Math.round(h), deviceScaleFactor: DSF });
    await sleep(700);
  }
  await page.setViewport({ width, height: Math.round(h), deviceScaleFactor: DSF });
  await sleep(900);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  await page.setViewport({ width, height: mobile ? MOBILE.height : 900, deviceScaleFactor: DSF });
  console.log(`  OK ${name}.png (${Math.round(fs.statSync(file).size / 1024)} KB, ${width}x${Math.round(h)})`);
}

async function home(page, view = 'dashboard') {
  await page.evaluate(v => localStorage.setItem('pawket_view', v), view);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
}

const shots = {
  async 貓咪指揮中心(page) {
    await home(page);
    await waitText(page, '貓咪指揮中心');
    await shot(page, '重啟_貓咪指揮中心_總覽', { maxH: 3200 });
  },

  async 配速警示(page) {
    await home(page);
    await waitText(page, '需立即關注的項目');
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,h2,h3')]
        .find(e => (e.innerText || '').trim().startsWith('需立即關注的項目'));
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 40);
    });
    await sleep(600);
    await page.setViewport({ width: W, height: 760, deviceScaleFactor: DSF });
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, '重啟_貓咪指揮中心_配速警示.png') });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
    console.log('  OK 重啟_貓咪指揮中心_配速警示.png');
  },

  async 帳戶餘額總覽(page) {
    await home(page);
    await click(page, '帳戶餘額總覽');
    await sleep(900);
    await page.setViewport({ width: W, height: 1000, deviceScaleFactor: DSF });
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, '重啟_帳戶餘額總覽.png') });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
    console.log('  OK 重啟_帳戶餘額總覽.png');
  },

  async 罐罐明細本(page) {
    await home(page, 'transactions');
    await waitText(page, '罐罐明細本');
    await shot(page, '重啟_罐罐明細本', { maxH: 2200 });
  },

  async 分類篩選(page) {
    await home(page, 'transactions');
    await click(page, '分類篩選');
    await shot(page, '重啟_明細本_分類篩選', { maxH: 1800 });
  },

  async 編輯交易_折扣(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '蝦皮');
    await rowAction(page, '蝦皮購物', 1);
    await shot(page, '重啟_編輯交易_折扣與品項', { maxH: 2400 });
  },

  async 編輯交易_套餐(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '兩廳院');
    await rowAction(page, '兩廳院售票', 1);
    await shot(page, '重啟_編輯交易_套餐子品項', { maxH: 2400 });
  },

  async 編輯交易_代購(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '日本零食');
    await rowAction(page, '日本零食代購', 1);
    await shot(page, '重啟_編輯交易_代購標記', { maxH: 2400 });
  },

  async 分裝盤(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '週末食材');
    await rowAction(page, '週末食材', 0);
    await shot(page, '重啟_分裝盤', { maxH: 2000 });
  },

  async 這碗跟誰分(page) {
    await home(page, 'transactions');
    await type(page, '快速查找', '燒肉眾');
    await rowAction(page, '燒肉眾', 1);
    await click(page, '編輯這碗跟誰分');
    await shot(page, '重啟_這碗跟誰分', { maxH: 2000 });
  },

  async 糧食往來簿(page) {
    await home(page);
    await click(page, '糧食往來簿');
    await shot(page, '重啟_糧食往來簿', { maxH: 1800 });
  },

  async 喵喵心願罐(page) {
    await home(page);
    await click(page, '查看完整清單');
    await shot(page, '重啟_喵喵心願罐', { maxH: 2000 });
  },

  async 新增收支(page) {
    await home(page);
    await click(page, '新增收支');
    await shot(page, '重啟_新增收支', { maxH: 2200 });
  },

  async 帳戶互轉(page) {
    await home(page, 'transactions');
    await click(page, '新增', { exact: true });
    await click(page, '帳戶互轉');
    await shot(page, '重啟_帳戶互轉', { maxH: 1600 });
  },

  async 餵食核對(page) {
    await home(page, 'reconcile');
    await sleep(1500);
    await shot(page, '重啟_餵食核對', { maxH: 1600 });
  },

  async 戰情報告(page) {
    await home(page);
    await click(page, '戰情報告');
    await sleep(1500);
    await shot(page, '重啟_戰情報告', { maxH: 1800 });
  },

  async 戰情報告內容(page) {
    await home(page);
    await click(page, '戰情報告');
    await sleep(1200);
    await click(page, '2026/08/01 ~ 2026/08/31');
    await sleep(1200);
    await shot(page, '重啟_戰情報告_報告內容', { maxH: 2400 });
  },

  async 重新裝碗紀錄(page) {
    await home(page, 'activityLog');
    await sleep(1500);
    await shot(page, '重啟_重新裝碗紀錄', { maxH: 1400 });
  },

  async 垃圾桶(page) {
    await home(page, 'transactions');
    await click(page, '垃圾桶');
    await shot(page, '重啟_垃圾桶', { maxH: 1600 });
  },

  async 系統設定_分類預算(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '分類預算設定');
    await shot(page, '重啟_系統設定_分類預算', { maxH: 2000 });
  },

  async 系統設定_長期預留(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '長期預留支出與安全水位');
    await shot(page, '重啟_系統設定_長期預留支出', { maxH: 2000 });
  },

  async 碗盤總覽(page) {
    await home(page);
    await page.click('[title="總設定"]');
    await sleep(700);
    await click(page, '系統設定');
    await sleep(900);
    await click(page, '碗盤總覽');
    await shot(page, '重啟_碗盤總覽', { maxH: 2000 });
  },

  // ── 手機版 ──
  async 手機_首頁(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page);
    await waitText(page, '貓咪指揮中心');
    await shot(page, '重啟_手機_貓咪指揮中心', { maxH: 2400, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },

  async 手機_明細本(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page, 'transactions');
    await waitText(page, '罐罐明細本');
    await shot(page, '重啟_手機_罐罐明細本', { maxH: 1800, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },

  async 手機_新增收支(page) {
    await page.setViewport({ ...MOBILE, deviceScaleFactor: DSF });
    await home(page);
    await click(page, '新增收支');
    await shot(page, '重啟_手機_新增收支', { maxH: 2400, mobile: true });
    await page.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  },
};

async function run() {
  const only = process.argv.slice(2);
  const sess = await session();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
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
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
