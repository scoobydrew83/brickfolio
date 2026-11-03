// The OCR model files (Tesseract.js, Apache-2.0; English model, Apache-2.0) served from this server, so reading a set
// number off a box needs no outside service. Only the whitelisted files in lib/barcode/ocr.ts can be fetched.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OCR_FILES } from '@/lib/barcode/ocr';

const TYPES: Record<string, string> = { js: 'text/javascript; charset=utf-8', gz: 'application/gzip' };

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const rel = OCR_FILES[file];
  if (!rel) return new Response('Not found', { status: 404 });
  try {
    const data = await readFile(join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules', rel));
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': TYPES[file.split('.').pop()!] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return new Response('OCR files are not installed on this server.', { status: 404 });
  }
}
