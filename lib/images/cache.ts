// Where cached set and minifigure photos are kept: a folder on Docker (IMAGE_CACHE_DIR, default ./data/images, which
// is /data/images in the Docker volume) or an R2 bucket on Cloudflare (binding IMAGE_CACHE). IMAGE_CACHE=off turns it
// off; the image routes then pass photos through without keeping them.
import 'server-only';

export type ImageStore = {
  kind: 'disk' | 'r2';
  get(key: string): Promise<{ body: ArrayBuffer; type: string } | null>;
  put(key: string, body: ArrayBuffer, type: string): Promise<void>;
  stats(): Promise<{ count: number; bytes: number }>;
  clear(): Promise<void>;
};

/** Keys look like set/10280-1/0123456789ab. Anything else is refused, so a key can never point outside the store. */
export const validKey = (key: string) => /^(set|minifig)\/[a-z0-9][a-z0-9._-]{0,63}\/[0-9a-f]{12}$/.test(key) && !key.includes('..');

/** The store this installation uses, or null when caching is off. */
export async function imageStore(): Promise<ImageStore | null> {
  if (process.env.IMAGE_CACHE === 'off') return null;
  if (process.env.DB_DRIVER === 'd1') {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const bucket = (getCloudflareContext().env as { IMAGE_CACHE?: R2Like }).IMAGE_CACHE;
    return bucket ? r2Store(bucket) : null;
  }
  return diskStore(process.env.IMAGE_CACHE_DIR || './data/images');
}

// ---- disk ----

/** A folder holding one file per image, plus a `.type` file with its content type. */
export function diskStore(dir: string): ImageStore {
  const fs = () => import(/* turbopackIgnore: true */ 'node:fs/promises');
  const paths = async () => {
    const { join, resolve, sep } = await import(/* turbopackIgnore: true */ 'node:path');
    const root = resolve(/*turbopackIgnore: true*/ dir);
    return {
      root,
      file: (key: string) => {
        if (!validKey(key)) return null;
        const full = resolve(/*turbopackIgnore: true*/ join(root, key));
        return full.startsWith(root + sep) ? full : null;
      },
    };
  };
  return {
    kind: 'disk',
    async get(key) {
      const file = (await paths()).file(key);
      if (!file) return null;
      const { readFile } = await fs();
      try {
        const [body, type] = await Promise.all([readFile(/*turbopackIgnore: true*/ file), readFile(/*turbopackIgnore: true*/ `${file}.type`, 'utf8')]);
        return { body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, type: type.trim() };
      } catch {
        return null;
      }
    },
    async put(key, body, type) {
      const file = (await paths()).file(key);
      if (!file) throw new Error(`Invalid image key: ${key}`);
      const { mkdir, writeFile } = await fs();
      const { dirname } = await import(/* turbopackIgnore: true */ 'node:path');
      await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ `${file}.type`, type);
      await writeFile(/*turbopackIgnore: true*/ file, new Uint8Array(body));
    },
    async stats() {
      const { root } = await paths();
      const { readdir, stat } = await fs();
      const { join } = await import(/* turbopackIgnore: true */ 'node:path');
      let count = 0, bytes = 0;
      for (const sub of ['set', 'minifig']) {
        const entries = await readdir(/*turbopackIgnore: true*/ join(root, sub), { recursive: true, withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          if (!e.isFile() || e.name.endsWith('.type')) continue;
          count++;
          bytes += (await stat(/*turbopackIgnore: true*/ join(e.parentPath, e.name)).catch(() => ({ size: 0 }))).size;
        }
      }
      return { count, bytes };
    },
    async clear() {
      const { root } = await paths();
      const { readdir, rm } = await fs();
      const { join } = await import(/* turbopackIgnore: true */ 'node:path');
      for (const name of await readdir(/*turbopackIgnore: true*/ root).catch(() => [] as string[])) {
        if (name === 'set' || name === 'minifig') await rm(/*turbopackIgnore: true*/ join(root, name), { recursive: true, force: true });
      }
    },
  };
}

// ---- R2 ----

/** The part of R2's bucket API used here (typed locally so the Node build doesn't need the Workers types). */
type R2Like = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, body: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<unknown>;
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string[]): Promise<void>;
};

export function r2Store(bucket: R2Like): ImageStore {
  const each = async (fn: (objects: { key: string; size: number }[]) => Promise<void>) => {
    for (const prefix of ['set/', 'minifig/']) {
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, cursor, limit: 1000 });
        await fn(page.objects);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
  };
  return {
    kind: 'r2',
    async get(key) {
      if (!validKey(key)) return null;
      const o = await bucket.get(key);
      return o ? { body: await o.arrayBuffer(), type: o.httpMetadata?.contentType || 'application/octet-stream' } : null;
    },
    async put(key, body, type) {
      if (!validKey(key)) throw new Error(`Invalid image key: ${key}`);
      await bucket.put(key, body, { httpMetadata: { contentType: type } });
    },
    async stats() {
      let count = 0, bytes = 0;
      await each(async (objects) => { count += objects.length; bytes += objects.reduce((n, o) => n + o.size, 0); });
      return { count, bytes };
    },
    async clear() {
      // Listed again from the start each time: paging on while deleting would skip objects.
      for (const prefix of ['set/', 'minifig/']) {
        for (;;) {
          const { objects } = await bucket.list({ prefix, limit: 1000 });
          if (!objects.length) break;
          await bucket.delete(objects.map((o) => o.key));
        }
      }
    },
  };
}
