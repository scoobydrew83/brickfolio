// Reads codes from the camera preview, in the browser only: frames never leave the device. Two kinds:
// - retail: the UPC/EAN barcode on a set's box;
// - minifig: the square Data Matrix on a Collectible Minifigures box.
// Uses the built-in BarcodeDetector where the browser has one for that kind (Chrome on Android, Safari on macOS),
// otherwise ZXing, loaded only then (iPhone Safari, Firefox, desktop Chrome on Linux/Windows).

export type Detected = { rawValue: string; format: string };
export type Decoder = { kind: 'native' | 'zxing'; detect(video: HTMLVideoElement): Promise<Detected[]> };
export type CodeKind = 'retail' | 'minifig';

const WANT: Record<CodeKind, string[]> = { retail: ['ean_13', 'upc_a', 'ean_8', 'upc_e'], minifig: ['data_matrix'] };

type NativeDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> };
type NativeCtor = { new (opts: { formats: string[] }): NativeDetector; getSupportedFormats?: () => Promise<string[]> };

/** Tests and the e2e check can swap a decoder in (window.__brickfolioDecoder; a function may return null to keep the real one). */
type Hooked = Window & { __brickfolioDecoder?: Decoder | ((kind: CodeKind) => Decoder | null) };

async function native(kind: CodeKind): Promise<Decoder | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const formats = WANT[kind].filter((f) => supported.includes(f));
    if (kind === 'retail' ? !formats.includes('ean_13') || !formats.includes('upc_a') : !formats.length) return null;
    const d = new Ctor({ formats });
    return { kind: 'native', detect: async (video) => (await d.detect(video)).map((r) => ({ rawValue: r.rawValue, format: r.format })) };
  } catch {
    return null;
  }
}

async function zxing(kind: CodeKind): Promise<Decoder> {
  const [{ BrowserMultiFormatOneDReader, BrowserDatamatrixCodeReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const hints = new Map<number, unknown>([[DecodeHintType.TRY_HARDER, true]]);
  if (kind === 'retail') hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.EAN_8, BarcodeFormat.UPC_E]);
  const reader = kind === 'retail' ? new BrowserMultiFormatOneDReader(hints as never) : new BrowserDatamatrixCodeReader(hints as never);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    kind: 'zxing',
    async detect(video) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!ctx || !w || !h) return [];
      // The middle of the frame (where the guide box is), at most 1000 px wide: a wide band for a 1D barcode,
      // a square for a Data Matrix. Much cheaper than the full frame.
      const cropW = Math.round(w * (kind === 'retail' ? 0.9 : 0.6)), cropH = Math.round(h * (kind === 'retail' ? 0.5 : 0.8));
      const scale = Math.min(1, 1000 / cropW);
      canvas.width = Math.round(cropW * scale);
      canvas.height = Math.round(cropH * scale);
      ctx.drawImage(video, (w - cropW) / 2, (h - cropH) / 2, cropW, cropH, 0, 0, canvas.width, canvas.height);
      try {
        const r = reader.decodeFromCanvas(canvas);
        return [{ rawValue: r.getText(), format: BarcodeFormat[r.getBarcodeFormat()] }];
      } catch {
        return []; // nothing in this frame
      }
    },
  };
}

/** The best decoder this browser has for this kind of code. */
export async function createDecoder(kind: CodeKind = 'retail'): Promise<Decoder> {
  const hooked = (window as Hooked).__brickfolioDecoder;
  const d = typeof hooked === 'function' ? hooked(kind) : hooked;
  if (d) return d;
  return (await native(kind)) ?? zxing(kind);
}
