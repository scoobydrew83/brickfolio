'use client';
import { useState } from 'react';
import { CONDITIONS } from '@/lib/sets';
import { Button, Dialog, field } from '../ui';

type Props = { locations: string[]; pending: boolean; onClose: () => void; onSubmit: (text: string, location: string, condition: string) => void };

/** Paste a list of set and minifig numbers to add them all at once. */
export function QuickAdd({ locations, pending, onClose, onSubmit }: Props) {
  const [text, setText] = useState('');
  const count = text.split(/[\n,;]+/).filter((l) => l.trim() && !l.trim().startsWith('# ')).length;
  return (
    <Dialog
      title="Paste a list"
      subtitle="Set numbers and BrickLink minifig numbers"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="quick-form" loading={pending} disabled={!count}>{pending ? 'Adding…' : `Add ${count || ''}`.trim()}</Button></>}
    >
      <form id="quick-form" className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit(text, String(f.get('location') ?? ''), String(f.get('condition') ?? '')); }}>
        <label className="block text-sm">One per line, or separated by commas
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} required autoFocus spellCheck={false} placeholder={'10497\n21325 x2\n2x 10305\nsw0001'} className={`${field} font-mono`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Location for all
            <select name="location" defaultValue="" className={field}>
              <option value="">(none)</option>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">Condition for all
            <select name="condition" defaultValue="Used" className={field}>
              {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-fg-3">Sets you already have get more copies. Up to 10 new items are looked up on BrickLink now; longer lists are looked up at the next sync, so a big paste doesn’t use up the daily limit.</p>
      </form>
    </Dialog>
  );
}
