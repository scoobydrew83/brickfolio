'use client';
// The camera preview and the decode loop. Owns the camera: one stream at a time, released when scanning ends, the
// page is hidden or left, and started again on return. Frames are read in the browser and never uploaded or saved.
import { Camera, Flashlight, FlashlightOff, RefreshCw, SwitchCamera } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatHint, parseBarcode, type Barcode, type createRepeatGuard } from '@/lib/barcode/gtin';
import { parseFigCode, type FigCode } from '@/lib/barcode/figcodes';
import { Button, cx } from '../ui';
import { createDecoder, type CodeKind, type Decoder } from './decoder';

type Guard = ReturnType<typeof createRepeatGuard>;
export type CameraState = 'idle' | 'requesting' | 'scanning' | 'denied' | 'nocamera' | 'busy' | 'insecure' | 'error';

/** Decode about 8 times a second: quick to react, light on the battery. */
const FRAME_MS = 120;

const MESSAGES: Partial<Record<CameraState, string>> = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again. You can also type the barcode below.',
  nocamera: 'No camera found on this device. Type the digits under the barcode below instead.',
  busy: 'The camera is in use by another app. Close it and try again.',
  insecure: 'The camera only works over HTTPS (or on localhost). Open Brickfolio from its https:// address, or type the barcode below.',
  error: 'The camera stopped. Try again.',
};

type Props = {
  /** Decode frames only while true (paused while a result is shown). The camera stays on. */
  active: boolean;
  onDetected: (b: Barcode) => void;
  /** What to look for: retail barcodes, or the square code on minifigure boxes (then onFigCode is called). */
  kind?: CodeKind;
  onFigCode?: (c: FigCode) => void;
  /** Receives the preview element, e.g. to read the set number off the box. */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onState?: (s: CameraState) => void;
  guard: Guard;
  /** Start the camera straight away (the user already started it once this session). */
  autoStart: boolean;
};

export function Scanner({ active, onDetected, onFigCode, kind = 'retail', videoRef, onState, guard, autoStart }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const decoders = useRef(new Map<CodeKind, Promise<Decoder>>());
  const wanted = useRef(false); // the user wants the camera on (survives the page being hidden)
  const starting = useRef(false);
  const [state, setStateRaw] = useState<CameraState>('idle');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torch, setTorch] = useState(false);
  const [caps, setCaps] = useState({ torch: false, cameras: 0 });
  const onDetectedRef = useRef(onDetected);
  const onFigRef = useRef(onFigCode);
  const onStateRef = useRef(onState);
  useEffect(() => { onDetectedRef.current = onDetected; onFigRef.current = onFigCode; onStateRef.current = onState; });
  useEffect(() => { if (videoRef) videoRef.current = video.current; return () => { if (videoRef) videoRef.current = null; }; }, [videoRef]);

  const setState = useCallback((s: CameraState) => { setStateRaw(s); onStateRef.current?.(s); }, []);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setTorch(false);
  }, []);

  const start = useCallback(async (face: 'environment' | 'user' = facing) => {
    if (starting.current) return;
    wanted.current = true;
    if (!window.isSecureContext) return setState('insecure');
    if (!navigator.mediaDevices?.getUserMedia) return setState('nocamera');
    starting.current = true;
    release();
    setState('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: face }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!wanted.current) { s.getTracks().forEach((t) => t.stop()); return; } // closed while asking
      stream.current = s;
      const track = s.getVideoTracks()[0];
      track.addEventListener('ended', () => { if (stream.current === s) { release(); setState('error'); } }); // e.g. a phone call took the camera
      const v = video.current!;
      v.srcObject = s;
      await v.play().catch(() => {});
      const trackCaps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCaps({ torch: !!trackCaps.torch, cameras: devices.filter((d) => d.kind === 'videoinput').length });
      try { sessionStorage.setItem('brickfolio-camera', 'on'); } catch {}
      setState('scanning');
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera' : name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'error');
      wanted.current = false;
    } finally {
      starting.current = false;
    }
  }, [facing, release, setState]);

  const stop = useCallback(() => { wanted.current = false; release(); setState('idle'); }, [release, setState]);

  // Start on mount when allowed; always let go of the camera when leaving the page.
  useEffect(() => {
    // Turning the camera on is the external system this effect syncs with; its state updates follow from that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoStart) void start();
    return () => { wanted.current = false; release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hidden tab, locked phone, app switch: free the camera, and pick up again on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) { if (stream.current) { release(); setStateRaw('idle'); } }
      else if (wanted.current && !stream.current) void start();
    };
    const onPageHide = () => release();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onPageHide); };
  }, [release, start]);

  // The decode loop: one at a time, only while scanning and active, for the kind of code asked for.
  useEffect(() => {
    if (state !== 'scanning' || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!decoders.current.has(kind)) decoders.current.set(kind, createDecoder(kind));
    void (async () => {
      const d = await decoders.current.get(kind)!.catch(() => null);
      if (!d) { decoders.current.delete(kind); if (!cancelled) setState('error'); return; }
      const tick = async () => {
        if (cancelled) return;
        const v = video.current;
        const found = v && v.readyState >= 2 ? await d.detect(v).catch(() => []) : [];
        if (cancelled) return;
        if (kind === 'retail') {
          const valid = found.map((f) => parseBarcode(f.rawValue, formatHint(f.format))).flatMap((b) => (b.ok ? [b] : []));
          const fresh = new Set(guard.frame(valid.map((b) => b.gtin)));
          for (const b of valid) if (fresh.delete(b.gtin)) { const { ok: _, ...barcode } = b; onDetectedRef.current(barcode); }
        } else {
          const codes = found.map((f) => parseFigCode(f.rawValue)).filter((c): c is FigCode => !!c);
          const key = (c: FigCode) => `fig:${c.code}|${c.factory}|${c.year}`;
          const fresh = new Set(guard.frame(codes.map(key)));
          for (const c of codes) if (fresh.delete(key(c))) onFigRef.current?.(c);
        }
        timer = setTimeout(tick, FRAME_MS);
      };
      void tick();
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [state, active, kind, guard, setState]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { setCaps((c) => ({ ...c, torch: false })); }
  };
  const switchCamera = () => { const f = facing === 'environment' ? 'user' : 'environment'; setFacing(f); void start(f); };

  const live = state === 'scanning';
  return (
    <div className="relative overflow-hidden rounded-card bg-black text-white">
      <div className="relative aspect-[4/3] w-full sm:aspect-video">
        <video ref={video} playsInline muted autoPlay aria-label="Camera preview" className={cx('absolute inset-0 size-full object-cover', facing === 'user' && '-scale-x-100', !live && 'opacity-0')} />
        {live && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={cx('relative rounded-lg border-2', kind === 'minifig' ? 'aspect-square h-[55%]' : 'h-[38%] w-[80%] max-w-md', 'shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)] transition-colors', active ? 'border-white' : 'border-primary')}>
              {active && <div className="absolute inset-x-3 top-1/2 h-0.5 bg-primary/90 motion-safe:animate-pulse" />}
            </div>
          </div>
        )}
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {state === 'idle' && (
              <>
                <Camera aria-hidden className="size-10 opacity-80" />
                <p className="max-w-xs text-sm opacity-90">Point the camera at the barcode on the box. Nothing is recorded or uploaded.</p>
                <Button variant="primary" icon={Camera} onClick={() => void start()}>Start camera</Button>
              </>
            )}
            {state === 'requesting' && <p className="text-sm opacity-90">Starting the camera…</p>}
            {MESSAGES[state] && (
              <>
                <p className="max-w-sm text-sm">{MESSAGES[state]}</p>
                {state !== 'insecure' && state !== 'nocamera' && <Button icon={RefreshCw} onClick={() => void start()}>Try again</Button>}
              </>
            )}
          </div>
        )}
      </div>
      {live && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
          <p className="text-sm font-medium drop-shadow">{!active ? 'Paused' : kind === 'minifig' ? 'Line the square code up in the box' : 'Line the barcode up in the box'}</p>
          <span className="flex gap-2">
            {caps.torch && (
              <button type="button" onClick={toggleTorch} aria-pressed={torch} aria-label={torch ? 'Turn the light off' : 'Turn the light on'} className="rounded-full bg-black/50 p-2.5 hover:bg-black/70">
                {torch ? <FlashlightOff aria-hidden className="size-5" /> : <Flashlight aria-hidden className="size-5" />}
              </button>
            )}
            {caps.cameras > 1 && (
              <button type="button" onClick={switchCamera} aria-label="Switch camera" className="rounded-full bg-black/50 p-2.5 hover:bg-black/70">
                <SwitchCamera aria-hidden className="size-5" />
              </button>
            )}
            <button type="button" onClick={stop} className="rounded-full bg-black/50 px-3 py-2 text-sm font-medium hover:bg-black/70">Stop camera</button>
          </span>
        </div>
      )}
    </div>
  );
}
