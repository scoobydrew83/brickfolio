'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Search, Trash2, Upload } from 'lucide-react';
import { findOmrModel, removeModel, uploadModel } from '@/app/actions';
import { Banner, Button, Segmented } from './ui';

type View = 'photo' | '3d' | 'steps';
type Props = {
  setNo: string;
  model: { fileName: string; author: string | null } | null;
  library: boolean; // an LDraw parts library is configured on the server
  photo: React.ReactNode;
  initialView?: View; // e.g. from ?view=3d on the set page
};

/** A set's photo, its LDraw model in 3D, and the model's building steps. */
export function ModelViewer({ setNo, model, library, photo, initialView }: Props) {
  const [view, setView] = useState<View>(initialView ?? 'photo');
  return (
    <section aria-label="Photo and model" className="space-y-3">
      <Segmented
        label="View"
        value={view}
        onChange={setView}
        options={[{ value: 'photo', label: 'Photo' }, { value: '3d', label: '3D model' }, { value: 'steps', label: 'Steps' }]}
      />
      {view === 'photo' ? photo : !library ? <NoLibrary /> : !model ? <UploadModel setNo={setNo} /> : <Model setNo={setNo} steps={view === 'steps'} fileName={model.fileName} author={model.author} />}
    </section>
  );
}

const frame = 'relative h-72 overflow-hidden rounded-card bg-tile sm:h-[26rem]';

function NoLibrary() {
  return (
    <div className={`${frame} flex items-center justify-center p-8 text-center text-sm text-tile-ink/80`}>
      <p className="max-w-sm">
        The 3D view needs the LDraw parts library on the server. Set <code className="rounded-chip bg-white px-1">LDRAW_LIBRARY_DIR</code> to the unzipped
        library (or <code className="rounded-chip bg-white px-1">LDRAW_LIBRARY_URL</code> on Cloudflare). See the install guide.
      </p>
    </div>
  );
}

function UploadModel({ setNo }: { setNo: string }) {
  const [pending, start] = useTransition();
  const [finding, startFind] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`${frame} flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-tile-ink/80`}>
      <p className="max-w-sm">
        No model for this set yet. Many older sets have one in the{' '}
        <a href="https://library.ldraw.org/omr" target="_blank" rel="noreferrer" className="font-semibold text-tile-ink underline">LDraw Official Model Repository</a>.
      </p>
      <Button
        variant="primary"
        icon={Search}
        loading={finding}
        disabled={pending}
        onClick={() => startFind(async () => { const r = await findOmrModel(setNo); setError(r.ok ? null : r.error); })}
      >
        Find model on LDraw
      </Button>
      <p className="text-xs">Or upload an .ldr or .mpd file you have:</p>
      <form
        className="flex flex-wrap items-center justify-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          start(async () => {
            const r = await uploadModel(setNo, data);
            setError(r.ok ? null : r.error);
          });
        }}
      >
        <input name="file" type="file" accept=".ldr,.mpd,.dat" required aria-label="LDraw model file" className="max-w-full text-sm file:mr-3 file:rounded-control file:border file:border-tile-ink/40 file:bg-white file:px-3 file:py-1.5" />
        <Button type="submit" icon={Upload} loading={pending} disabled={finding}>Upload</Button>
      </form>
      {error && <p role="alert" className="font-semibold text-tile-ink">{error}</p>}
    </div>
  );
}

/** Loads three.js only when the 3D view opens, then the model, then its parts from the library. */
function Model({ setNo, steps, fileName, author }: { setNo: string; steps: boolean; fileName: string; author: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string; total?: number }>({ status: 'loading' });
  const [step, setStep] = useState(0);
  const showUpTo = useRef<((step: number) => void) | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = await import('three');
        const { LDrawLoader } = await import('three/examples/jsm/loaders/LDrawLoader.js');
        const { LDrawConditionalLineMaterial } = await import('three/examples/jsm/materials/LDrawConditionalLineMaterial.js');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const el = host.current;
        if (!el || disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(el.clientWidth, el.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        el.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('aria-label', `3D model of set ${setNo}; drag to rotate, scroll to zoom`);
        renderer.domElement.setAttribute('role', 'img');

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(getComputedStyle(el).getPropertyValue('--tile').trim() || '#f5f7f9');
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8796a3, 2.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(-1, 1.5, 1);
        scene.add(sun);
        const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 1, 100000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;

        const loader = new LDrawLoader();
        loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
        loader.setPartsLibraryPath('/api/v1/ldraw/');
        await loader.preloadMaterials('/api/v1/ldraw/LDConfig.ldr').catch(() => {}); // colours fall back to defaults
        const res = await fetch(`/api/v1/sets/${encodeURIComponent(setNo)}/model`);
        if (!res.ok) throw new Error('Could not load the model file.');
        const text = await res.text();
        const model = await new Promise<import('three').Group>((resolve, reject) => loader.parse(text, resolve, reject));
        if (disposed) return;
        model.rotation.x = Math.PI; // LDraw's Y axis points down
        scene.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0.6, 0.5, 0.85).multiplyScalar(size * 1.35));
        camera.near = size / 100;
        camera.far = size * 20;
        camera.updateProjectionMatrix();

        const parts: import('three').Object3D[] = [];
        model.traverse((c) => { if ((c as import('three').Group).isGroup && c !== model) parts.push(c); });
        showUpTo.current = (upTo) => { for (const c of parts) c.visible = (c.userData.buildingStep ?? 0) <= upTo; };
        const total = Math.max(1, model.userData.numBuildingSteps ?? 1);

        let frameId = 0;
        const loop = () => { controls.update(); renderer.render(scene, camera); frameId = requestAnimationFrame(loop); };
        loop();
        const resize = new ResizeObserver(() => {
          renderer.setSize(el.clientWidth, el.clientHeight);
          camera.aspect = el.clientWidth / el.clientHeight;
          camera.updateProjectionMatrix();
        });
        resize.observe(el);
        cleanup = () => {
          cancelAnimationFrame(frameId);
          resize.disconnect();
          controls.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
        setStep(total - 1);
        setState({ status: 'ready', total });
      } catch (e) {
        if (!disposed) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { disposed = true; cleanup(); };
  }, [setNo]);

  // Steps: show only what is built up to the chosen step. The 3D view shows the finished model.
  useEffect(() => {
    const upTo = steps ? step : Infinity;
    showUpTo.current?.(upTo);
  }, [steps, step, state.status]);

  const total = state.total ?? 1;
  return (
    <div className="space-y-3">
      <div ref={host} className={frame} data-model-status={state.status}>
        {state.status === 'loading' && <p className="absolute inset-0 flex items-center justify-center text-sm text-tile-ink/75">Loading the model and its parts…</p>}
        {state.status === 'error' && (
          <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-tile-ink/80">The model didn&apos;t load.</p>
        )}
      </div>
      {steps && state.status === 'ready' && (
        <label className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 font-semibold tabular-nums">Step {step + 1} of {total}</span>
          <input type="range" min={0} max={total - 1} value={step} onChange={(e) => setStep(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
        </label>
      )}
      {state.status === 'error' && <Banner kind="error">{state.error} Parts the library doesn&apos;t have are the usual cause.</Banner>}
      {message && <Banner kind="error" onDismiss={() => setMessage(null)}>{message}</Banner>}
      <p className="flex flex-wrap items-center gap-x-3 text-xs text-fg-3">
        <span>Model: {fileName}{author ? ` by ${author}` : ''}. Parts from the LDraw library (CC BY 2.0).</span>
        <Button variant="danger-link" className="text-xs" disabled={pending} onClick={() => start(async () => { const r = await removeModel(setNo); if (!r.ok) setMessage(r.error); })}>
          <Trash2 aria-hidden className="size-3.5" />Remove model
        </Button>
      </p>
    </div>
  );
}
