// PDF結構化解析：直接抽取PDF裡的文字層，取代把整份PDF當圖片丟給AI辨識(OCR)。
// 大部分銀行對帳單PDF本身是「文字型」(不是掃描圖片)，直接抽文字比圖片OCR快、
// 免費、不會看錯字——這裡負責把PDF轉成排列整齊的純文字，交給geminiService
// 用文字(而不是圖片)去結構化成交易清單。掃描圖片型的PDF文字層幾乎是空的，
// 那種情況由呼叫端偵測後改用原本的圖片OCR流程(見looksLikeScannedPdf)。
import * as pdfjsLib from 'pdfjs-dist';
import { PasswordResponses } from 'pdfjs-dist';

// Vite打包用：讓pdf.js的worker被當成獨立資源bundle進去，不用另外設定伺服器路徑。
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export class PdfPasswordRequiredError extends Error {
  constructor(public isRetry: boolean) {
    super(isRetry ? '密碼不對，請重新輸入' : '這份PDF有密碼保護，請輸入密碼');
  }
}

export interface PdfExtractResult {
  text: string;      // 每一頁、每一列都排好順序的純文字(列內依左到右座標排序，避免PDF內部文字流順序跳來跳去)
  pageCount: number;
  charCount: number; // 排除空白字元後的總字數，用來判斷是不是掃描圖片型PDF
}

// 低於這個「每頁平均字數」，視為掃描圖片型PDF(文字層幾乎是空的)，不適合走文字解析。
export const MIN_TEXT_CHARS_PER_PAGE = 30;

export const looksLikeScannedPdf = (result: PdfExtractResult): boolean =>
  result.charCount < MIN_TEXT_CHARS_PER_PAGE * result.pageCount;

export const extractPdfText = async (data: ArrayBuffer, password?: string): Promise<PdfExtractResult> => {
  const loadingTask = pdfjsLib.getDocument({
    data,
    password,
    cMapUrl: '/cmaps/',
    cMapPacked: true,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') {
      throw new PdfPasswordRequiredError(err.code === PasswordResponses.INCORRECT_PASSWORD);
    }
    throw err;
  }

  const pageTexts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // 同一列的文字項目在PDF內部資料流裡的先後順序，不一定等於畫面上從左到右的順序
    // (常見於表格式PDF，同一格常常被拆成好幾個文字片段)。這裡先按Y座標分組成列，
    // 再對每一列按X座標排序，還原成真正的閱讀順序。
    const rows: Record<number, { x: number; str: string }[]> = {};
    content.items.forEach((item: any) => {
      if (!item.str || !item.str.trim()) return;
      const y = Math.round(item.transform[5]);
      if (!rows[y]) rows[y] = [];
      rows[y].push({ x: item.transform[4], str: item.str });
    });

    const sortedYs = Object.keys(rows).map(Number).sort((a, b) => b - a);
    const lines = sortedYs.map(y => rows[y].sort((a, b) => a.x - b.x).map(i => i.str.trim()).join(' '));
    pageTexts.push(lines.join('\n'));
  }

  const text = pageTexts.join('\n\n--- 下一頁 ---\n\n');
  const charCount = text.replace(/\s/g, '').length;
  return { text, pageCount: doc.numPages, charCount };
};

export const fileToArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
