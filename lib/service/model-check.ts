// Checks for LDraw model files, shared by uploads and the LDraw OMR fetch.

export const MAX_MODEL_BYTES = 2_000_000; // fits a single Cloudflare D1 row

/** Checks an uploaded file: an .ldr, .mpd or .dat text file of LDraw lines that places at least one part. */
export function checkModel(fileName: string, content: string): string | null {
  if (!/\.(ldr|mpd|dat)$/i.test(fileName)) return 'Upload an LDraw file: .ldr, .mpd or .dat.';
  if (new TextEncoder().encode(content).length > MAX_MODEL_BYTES) return 'That model is over 2 MB. Upload the unpacked .mpd without embedded parts.';
  if (content.includes('\0')) return "That doesn't look like a text LDraw file.";
  if (!/^\s*1\s+\S+(\s+\S+){12}\s+\S+/m.test(content)) return 'No parts found in that file. LDraw part lines start with "1".';
  return null;
}
