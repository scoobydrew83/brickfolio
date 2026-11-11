'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { addLayoutModule, deleteLayout, editLayout, editLayoutModule, removeLayoutModule, setLayoutModuleItems, type Result } from '@/app/actions';
import { MAX_CELLS, nextRotation, placementError, sizeLabel, type Placement } from '@/lib/layouts';
import type { LayoutDetail, LayoutModule, LayoutNeeds as Needs } from '@/lib/service/layouts';
import { PageHeader } from '../shell/PageHeader';
import { Banner, Button, Dialog, field } from '../ui';
import { LayoutGrid, moduleName } from './LayoutGrid';
import { LayoutNeeds } from './LayoutNeeds';
import { ModulePanel } from './ModulePanel';

type Op =
  | { type: 'add'; module: LayoutModule }
  | { type: 'edit'; id: number; patch: Partial<LayoutModule> }
  | { type: 'remove'; id: number };

const applyOp = (mods: LayoutModule[], op: Op): LayoutModule[] =>
  op.type === 'add' ? [...mods, op.module]
    : op.type === 'edit' ? mods.map((m) => (m.id === op.id ? { ...m, ...op.patch } : m))
      : mods.filter((m) => m.id !== op.id);

let tempId = -1;

/** A layout: the grid editor, the selected module's panel, and the parts the layout still needs. */
export function LayoutEditor({ layout, needs }: { layout: LayoutDetail; needs: Needs }) {
  const router = useRouter();
  const [modules, apply] = useOptimistic(layout.modules, applyOp);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const selected = modules.find((m) => m.id === selectedId) ?? null;

  /** Applies a change at once, then on the server; a refused change rolls back and says why. */
  const run = (op: Op, action: () => Promise<Result>, after?: (r: Result & { ok: true }) => void) => {
    setError(null);
    start(async () => {
      apply(op);
      const r = await action();
      if (r.ok) after?.(r); else setError(r.error);
    });
  };

  /** The editor's own check, the same one the server makes, so a bad move is refused before it's sent. */
  const blocked = (next: Placement, ignoreId?: number) => {
    const why = placementError(layout, next, modules.map((m) => ({ ...m, name: moduleName(m) })), ignoreId);
    if (why) setError(why);
    return !!why;
  };

  const place = (m: LayoutModule, patch: Partial<LayoutModule>) => {
    const next = { ...m, ...patch };
    if (blocked(next, m.id)) return;
    run({ type: 'edit', id: m.id, patch }, () => editLayoutModule(m.id, patch));
  };

  const onCell = (x: number, y: number) => {
    if (moving && selected) {
      place(selected, { x, y });
      setMoving(false);
      return;
    }
    if (blocked({ x, y, w: 1, h: 1, rotation: 0 })) return;
    const id = tempId--;
    setSelectedId(id);
    run(
      { type: 'add', module: { id, x, y, w: 1, h: 1, rotation: 0, kind: 'plain', name: null, notes: null, items: [] } },
      () => addLayoutModule(layout.id, { x, y }),
      (r) => setSelectedId((s) => (s === id ? (r.id ?? null) : s)),
    );
  };

  const onModule = (m: LayoutModule) => {
    if (moving && selected) {
      if (m.id === selected.id) setMoving(false);
      else setError(`That spot is taken by ${moduleName(m)}.`);
      return;
    }
    setError(null);
    setSelectedId(m.id === selectedId ? null : m.id);
  };

  const nudge = (dx: number, dy: number) => { if (selected) place(selected, { x: selected.x + dx, y: selected.y + dy }); };
  const rotate = () => { if (selected) place(selected, { rotation: nextRotation(selected.rotation) }); };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-sm text-fg-3">
        <Link href="/parts" className="text-link hover:underline">Parts</Link><span aria-hidden>/</span>
        <Link href="/layouts" className="text-link hover:underline">Layouts</Link><span aria-hidden>/</span>
        <span className="truncate text-fg">{layout.name}</span>
      </nav>
      <PageHeader title={layout.name} actions={<Button icon={Pencil} onClick={() => setEditing(true)}>Edit layout</Button>}>
        <p className="tabular-nums">{sizeLabel(layout.cols, layout.rows)} · {modules.length} placed</p>
        {layout.notes && <p className="mt-1 whitespace-pre-line">{layout.notes}</p>}
      </PageHeader>

      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}

      <section aria-label="Grid" className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <LayoutGrid
          cols={layout.cols}
          rows={layout.rows}
          modules={modules}
          selectedId={selectedId}
          moving={moving && !!selected}
          needs={needs.modules}
          onCell={onCell}
          onModule={onModule}
          onNudge={nudge}
          onRotate={rotate}
          onEscape={() => (moving ? setMoving(false) : setSelectedId(null))}
        />
        <ModulePanel
          module={selected}
          need={selected ? needs.modules[selected.id] ?? 0 : 0}
          moving={moving}
          pending={pending}
          onEdit={(patch) => { if (selected) place(selected, patch); }}
          onRotate={rotate}
          onMove={() => setMoving((v) => !v)}
          onNudge={nudge}
          onRemove={() => {
            if (!selected) return;
            const id = selected.id;
            setSelectedId(null);
            setMoving(false);
            run({ type: 'remove', id }, () => removeLayoutModule(id));
          }}
          onLink={async (items) => {
            if (!selected) return false;
            setError(null);
            const r = await setLayoutModuleItems(selected.id, items);
            if (!r.ok) setError(r.error);
            return r.ok;
          }}
        />
      </section>

      <section aria-labelledby="layout-parts" className="space-y-3">
        <h2 id="layout-parts" className="text-xl font-bold">Parts</h2>
        <LayoutNeeds layoutId={layout.id} needs={needs} modules={modules} />
      </section>

      {editing && <EditLayoutDialog layout={layout} onClose={() => setEditing(false)} onDeleted={() => router.push('/layouts')} />}
    </div>
  );
}

/** Rename, resize or delete a layout. */
function EditLayoutDialog({ layout, onClose, onDeleted }: { layout: LayoutDetail; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const save = (form: FormData) => start(async () => {
    const r = await editLayout(layout.id, Object.fromEntries(form));
    if (r.ok) onClose(); else setError(r.error);
  });
  const remove = () => start(async () => {
    const r = await deleteLayout(layout.id);
    if (r.ok) onDeleted(); else setError(r.error);
  });
  return (
    <Dialog
      title="Edit layout"
      onClose={onClose}
      footer={confirm ? (
        <>
          <span className="mr-auto self-center text-sm text-danger">Delete {layout.name}? Its modules go too; your sets and builds stay.</span>
          <Button onClick={() => setConfirm(false)}>Keep</Button>
          <Button variant="danger" loading={pending} onClick={remove}>Delete</Button>
        </>
      ) : (
        <>
          <Button variant="danger-link" className="mr-auto" onClick={() => setConfirm(true)}>Delete layout</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-layout" loading={pending}>Save</Button>
        </>
      )}
    >
      <LayoutFields id="edit-layout" action={save} error={error} values={layout} />
    </Dialog>
  );
}

/** Name, size and notes, for the new-layout and edit dialogs. */
export function LayoutFields({ id, action, error, values }: { id: string; action: (form: FormData) => void; error: string | null; values?: Pick<LayoutDetail, 'name' | 'cols' | 'rows' | 'notes'> }) {
  return (
    <form id={id} action={action} className="space-y-4 p-5">
      {error && <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <label className="block text-sm text-fg-2">Name
        <input name="name" required maxLength={80} defaultValue={values?.name} placeholder="Main street" className={field} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-fg-2">Columns
          <input name="cols" type="number" inputMode="numeric" required min={1} max={MAX_CELLS} defaultValue={values?.cols ?? 4} className={field} />
        </label>
        <label className="block text-sm text-fg-2">Rows
          <input name="rows" type="number" inputMode="numeric" required min={1} max={MAX_CELLS} defaultValue={values?.rows ?? 3} className={field} />
        </label>
      </div>
      <p className="text-xs text-fg-3">In MILS modules of 32 × 32 studs (25.6 cm), up to {MAX_CELLS} each way.</p>
      <label className="block text-sm text-fg-2">Notes
        <textarea name="notes" rows={3} maxLength={2000} defaultValue={values?.notes ?? ''} className={field} />
      </label>
    </form>
  );
}
