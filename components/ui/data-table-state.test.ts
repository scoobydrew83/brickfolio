import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseVisibility, readStored, serializeVisibility, writeStored } from './data-table-state';

const ids = ['photo', 'theme', 'pieces'];

describe('column visibility (#106)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips hidden columns and drops unknown or bad values', () => {
    expect(serializeVisibility({ theme: false, pieces: true, photo: false })).toBe('["photo","theme"]');
    expect(serializeVisibility({ theme: true })).toBeNull();
    expect(parseVisibility('["theme","gone",3]', ids)).toEqual({ theme: false });
    expect(parseVisibility('not json', ids)).toEqual({});
    expect(parseVisibility('{"theme":false}', ids)).toEqual({});
    expect(parseVisibility(null, ids)).toEqual({});
  });

  it('saves to localStorage and reads it back (a reload)', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    writeStored('bf:t', serializeVisibility({ theme: false }));
    expect(store.get('bf:t')).toBe('["theme"]');
    expect(parseVisibility(readStored('bf:t'), ids)).toEqual({ theme: false });
    writeStored('bf:t', serializeVisibility({}));
    expect(store.has('bf:t')).toBe(false);
  });

  it('keeps working, unsaved, when storage throws', () => {
    const boom = () => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(readStored('bf:x')).toBeNull();
    writeStored('bf:x', '["pieces"]');
    expect(parseVisibility(readStored('bf:x'), ids)).toEqual({ pieces: false });
  });
});
