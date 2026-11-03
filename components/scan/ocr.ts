// Reads the set number off a box from one camera frame, in the browser. Tesseract.js is loaded the first time it's
// needed (about 7 MB of model files, cached by the browser after that), and kept for the next read.
import { setNumberCandidates, type OcrPaths, type OcrWord } from '@/lib/barcode/ocr';

type TWorker = { recognize: (img: HTMLCanvasElement, opts?: object, out?: object) => Promise<{ data: { blocks?: Block[] | null } }>; setParameters: (p: Record<string, string>) => Promise<unknown> };
type Block = { paragraphs?: { lines?: { words?: { text: string; confidence: number; bbox: { y0: number; y1: number } }[] }[] }[] };

let worker: Promise<TWorker> | null = null;

async function getWorker(paths: OcrPaths): Promise<TWorker> {
  worker ??= (async () => {
    const T = await import('tesseract.js');
    const w = (await T.createWorker('eng', T.OEM.LSTM_ONLY, { ...paths, gzip: true })) as unknown as TWorker;
    await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: String(T.PSM.SPARSE_TEXT) });
    return w;
  })().catch((e) => { worker = null; throw e; });
  return worker;
}

/** A grey, contrast-stretched copy of the frame, at most 1600 px wide: what OCR reads best. */
function snapshot(video: HTMLVideoElement): HTMLCanvasElement | null {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 1600 / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/** Likely set numbers in view, biggest print first. Throws a readable error when OCR can't load. */
export async function readSetNumbers(video: HTMLVideoElement, paths: OcrPaths): Promise<string[]> {
  const img = snapshot(video);
  if (!img) return [];
  let w: TWorker;
  try { w = await getWorker(paths); } catch { throw new Error('Couldn’t load the text reader. Check the connection and try again.'); }
  const { data } = await w.recognize(img, {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const x of l.words ?? []) {
    words.push({ text: x.text, confidence: x.confidence, height: x.bbox.y1 - x.bbox.y0 });
  }
  return setNumberCandidates(words);
}
