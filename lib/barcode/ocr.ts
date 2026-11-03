// Reading the set number printed on a box (OCR with Tesseract.js, in the browser). The model files are served by
// this server at /ocr/<file> (app/ocr/[file]/route.ts), so nothing leaves your network; on Cloudflare Workers,
// which has no file system to serve them from, they load from jsDelivr instead. OCR_ASSETS_URL overrides both.

/** The files the browser may ask for, and where each lives in node_modules. */
export const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

export type OcrPaths = { workerPath: string; corePath: string; langPath: string };

const CDN: OcrPaths = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
};

/** Where the browser loads the OCR files from. */
export function ocrPaths(env: Record<string, string | undefined> = process.env): OcrPaths {
  const base = env.OCR_ASSETS_URL?.replace(/\/$/, '');
  if (base) return { workerPath: `${base}/worker.min.js`, corePath: base, langPath: base };
  if (env.DB_DRIVER === 'd1') return CDN;
  return { workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr' };
}

export type OcrWord = { text: string; confidence: number; height: number };

/**
 * Likely set numbers among the words read off a box: 3 to 7 digits, biggest print first (the set number is the
 * largest number on the front), then the most confident. Piece counts and ages look the same, so you pick.
 */
export function setNumberCandidates(words: OcrWord[], max = 5): string[] {
  const best = new Map<string, OcrWord>();
  for (const w of words) {
    const t = w.text.replace(/[^0-9]/g, '');
    if (t.length < 3 || t.length > 7 || w.confidence < 40 || t.startsWith('0')) continue;
    const prev = best.get(t);
    if (!prev || w.height > prev.height) best.set(t, { ...w, text: t });
  }
  return [...best.values()].sort((a, b) => b.height - a.height || b.confidence - a.confidence).slice(0, max).map((w) => w.text);
}
