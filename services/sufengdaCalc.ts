// 速風達代購金額計算（2026-09-17新增）。
//
// Ivy說明的速風達算法（已用真實銀行扣款驗證：呈仕CITER $965、Iiio雜誌 $897、Starry雜誌 $779、集運運費 $73）：
//   台幣 = 商品人民幣(含中國境內運費) × 1.02(代購手續費) × 匯率 × 1.02(街口支付手續費)，四捨五入到整數。
// 集運運費不收代購手續費，只有街口支付手續費。
// 用代購錢包餘額付時，街口手續費一樣是2%，但實際扣款會因為錢包裡原本的餘額/儲值零頭而跟上面算出來的
// 不一樣——這時品項照「直接付款」拆，差額記成一筆「代購錢包餘額折抵」折扣，實付金額才會等於銀行扣款。
//
// 每行台幣都要是整數（台幣沒有小數點），而且加總要剛好等於整筆四捨五入後的總額：各行先無條件捨去，
// 差額再依小數餘數由大到小一元一元分配（最大餘數法），不會出現「各行四捨五入後加總差1元」的情況。

export const SUFENGDA_PROXY_FEE_RATE = 0.02;
export const SUFENGDA_PAYMENT_FEE_RATE = 0.02;
export const SUFENGDA_PROXY_FEE_NAME = '代購手續費';
export const SUFENGDA_PAYMENT_FEE_NAME = '街口支付手續費';
export const SUFENGDA_WALLET_DISCOUNT_LABEL = '代購錢包餘額折抵';

export interface SufengdaProduct {
  name: string;
  rmb: number;      // 人民幣單價
  quantity: number;
}

export interface SufengdaLine {
  name: string;
  quantity: number;
  exact: number;    // 精確台幣（整行，已乘數量）
  twd: number;      // 分配後的整數台幣（整行）
  note: string;
  kind: 'product' | 'proxyFee' | 'paymentFee';
}

export interface SufengdaResult {
  lines: SufengdaLine[];
  exactTotal: number;
  total: number;    // 四捨五入後的整數總額 = 直接付款時的銀行扣款
}

const round2 = (n: number) => Math.round(n * 100) / 100;
// 顯示用：去掉浮點誤差造成的長尾（例如 159*4.71 = 748.8900000000001）
const fmt = (n: number) => String(round2(n));

const allocateIntegers = (exacts: number[], target: number): number[] => {
  const floors = exacts.map(e => Math.floor(round2(e)));
  const result = [...floors];
  let diff = target - floors.reduce((s, f) => s + f, 0);
  const order = exacts.map((e, i) => ({ i, r: round2(e) - floors[i] }));
  if (diff > 0) {
    order.sort((a, b) => b.r - a.r);
    for (let k = 0; k < diff; k++) result[order[k % order.length].i] += 1;
  } else if (diff < 0) {
    order.sort((a, b) => a.r - b.r);
    for (let k = 0; k < -diff; k++) result[order[k % order.length].i] -= 1;
  }
  return result;
};

export const calcSufengda = (products: SufengdaProduct[], rate: number, withProxyFee: boolean): SufengdaResult | null => {
  const valid = products.filter(p => p.rmb > 0 && p.quantity > 0);
  if (valid.length === 0 || !(rate > 0)) return null;

  const productExacts = valid.map(p => p.rmb * p.quantity * rate);
  const rmbSum = valid.reduce((s, p) => s + p.rmb * p.quantity, 0);
  const productTwdSum = productExacts.reduce((s, e) => s + e, 0);
  const proxyExact = withProxyFee ? rmbSum * SUFENGDA_PROXY_FEE_RATE * rate : 0;
  const paymentExact = (productTwdSum + proxyExact) * SUFENGDA_PAYMENT_FEE_RATE;
  const exactTotal = productTwdSum + proxyExact + paymentExact;
  const total = Math.round(round2(exactTotal));

  const exacts = [...productExacts, ...(withProxyFee ? [proxyExact] : []), paymentExact];
  const ints = allocateIntegers(exacts, total);

  const lines: SufengdaLine[] = valid.map((p, i) => ({
    name: p.name,
    quantity: p.quantity,
    exact: productExacts[i],
    twd: ints[i],
    note: `原幣¥${p.rmb} × ${p.quantity}個 × 匯率${rate} = ${fmt(productExacts[i])}`,
    kind: 'product',
  }));
  let k = valid.length;
  if (withProxyFee) {
    lines.push({
      name: SUFENGDA_PROXY_FEE_NAME, quantity: 1, exact: proxyExact, twd: ints[k++],
      note: `¥${fmt(rmbSum)} × 2% = ¥${fmt(rmbSum * SUFENGDA_PROXY_FEE_RATE)} × 匯率${rate} = ${fmt(proxyExact)}`,
      kind: 'proxyFee',
    });
  }
  lines.push({
    name: SUFENGDA_PAYMENT_FEE_NAME, quantity: 1, exact: paymentExact, twd: ints[k],
    note: `(${withProxyFee ? '商品+代購手續費' : '商品'} ${fmt(productTwdSum + proxyExact)}) × 2% = ${fmt(paymentExact)}`,
    kind: 'paymentFee',
  });
  return { lines, exactTotal, total };
};

// 從既有品項備註反解人民幣單價/匯率，讓打開既有交易時可以帶入（支援本工具、外幣試算工具、Ivy手打的「原幣$168 × 1個 × 匯率4.79」格式）
export const parseRmbNote = (note: string | undefined): { rmb?: number; rate?: number } => {
  if (!note) return {};
  const rmb = note.match(/原幣[¥$]?\s*([\d.]+)/);
  const rate = note.match(/匯率\s*([\d.]+)/);
  return { rmb: rmb ? parseFloat(rmb[1]) : undefined, rate: rate ? parseFloat(rate[1]) : undefined };
};
