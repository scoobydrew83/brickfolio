// Rebrickable API v3 client: catalog data only (themes, set details, minifigures). Rebrickable has no prices,
// so BrickLink stays the source for every value in the app. Docs: https://rebrickable.com/api/v3/docs/
// Free key from your Rebrickable account settings. The API allows about one call per second.

const BASE = 'https://rebrickable.com/api/v3';
const GAP_MS = 1100;

export class RebrickableError extends Error {}
/** Rebrickable refused the request for this key (401/403). */
export class RebrickableForbidden extends RebrickableError {}
/**
 * A build's parts list isn't available: Rebrickable refuses it ('forbidden': designers can keep a MOC's parts list
 * private or sell it, and the API doesn't hand those out) or doesn't have it ('not_found').
 */
export class PartsUnavailable extends RebrickableError {
  constructor(public reason: 'forbidden' | 'not_found', message: string) { super(message); }
}

export type RbTheme = { id: number; parentId: number | null; name: string };
export type RbSet = { setNo: string; name: string; year: number | null; themeId: number | null; numParts: number | null; imageUrl: string | null };

/** What the sync needs from Rebrickable. */
export type Catalog = {
  /** One cheap call that throws a readable error when the key is wrong or Rebrickable is unreachable. */
  check?(): Promise<void>;
  themes(): Promise<RbTheme[]>;
  /** Set details, or null when Rebrickable doesn't know the set number. */
  set(setNo: string): Promise<RbSet | null>;
  /** Number of minifigures in a set (sum of quantities). */
  minifigCount(setNo: string): Promise<number>;
};

/** An alternate build (MOC) of a set, from Rebrickable. */
export type RbBuild = { mocNo: string; name: string; numParts: number | null; imageUrl: string | null; url: string | null; designer: string | null };
/** One part of a build, in BrickLink numbers when Rebrickable knows them (`mapped`), else Rebrickable's own. */
export type RbBuildPart = { partNo: string; colorId: number | null; qty: number; mapped: boolean };

/** Alternate builds and their parts, for "What can I build?". */
export type BuildSource = {
  alternates(setNo: string): Promise<RbBuild[]>;
  buildParts(mocNo: string): Promise<RbBuildPart[]>;
};

/** A minifigure in Rebrickable's catalog (fig-000123), for the Collectible Minifigures checklist. */
export type RbFig = { figNo: string; name: string; numParts: number | null; imageUrl: string | null };
/** Minifigures in a theme, e.g. one Collectible Minifigures series. */
export type FigSource = { themeFigs(themeId: number): Promise<RbFig[]> };

type Page<T> = { count: number; next: string | null; results: T[] };
type ApiBuild = { set_num: string; name: string; num_parts?: number; moc_img_url?: string | null; moc_url?: string | null; designer_name?: string | null };
type ApiInvPart = {
  quantity: number; is_spare?: boolean;
  part: { part_num: string; external_ids?: { BrickLink?: string[] } };
  color?: { id: number; external_ids?: { BrickLink?: { ext_ids?: number[] } } };
};

/** Maps a Rebrickable inventory line to BrickLink part and colour numbers where Rebrickable lists them. */
export function toBuildPart(p: ApiInvPart): RbBuildPart {
  const blPart = p.part.external_ids?.BrickLink?.[0];
  const blColor = p.color?.external_ids?.BrickLink?.ext_ids?.[0];
  return { partNo: blPart ?? p.part.part_num, colorId: blColor ?? p.color?.id ?? null, qty: p.quantity, mapped: !!blPart && blColor !== undefined };
}
type ApiTheme = { id: number; parent_id: number | null; name: string };
type ApiSet = { set_num: string; name: string; year?: number; theme_id?: number; num_parts?: number; set_img_url?: string | null };
type ApiMinifig = { quantity?: number };
type ApiFig = { set_num: string; name: string; num_parts?: number; set_img_url?: string | null };

class NotFound extends Error {}

export function createRebrickable(key: string, fetchImpl: typeof fetch = fetch, gapMs = GAP_MS): Catalog & BuildSource & FigSource {
  let last = 0;
  async function get<T>(urlOrPath: string): Promise<T> {
    const url = urlOrPath.startsWith('http') ? urlOrPath : BASE + urlOrPath;
    for (let attempt = 0; ; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { Authorization: `key ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      } catch (e) {
        const why = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
        throw new RebrickableError(`Couldn't reach rebrickable.com from the server (${why}). Check the server's internet access and DNS.`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, gapMs * 2 * 2 ** attempt)); continue; }
      if (res.status === 404) throw new NotFound();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        const message = `Rebrickable: ${body?.detail || res.statusText || res.status}`;
        throw res.status === 401 || res.status === 403 ? new RebrickableForbidden(message) : new RebrickableError(message);
      }
      return (await res.json()) as T;
    }
  }
  /** Follows `next` links so callers get every result. */
  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let url: string | null = path; url; ) {
      const page: Page<T> = await get<Page<T>>(url);
      out.push(...page.results);
      // Only follow links back to the API, so the key is never sent anywhere else.
      url = page.next?.startsWith(BASE + '/') ? page.next : null;
    }
    return out;
  }

  return {
    async check() {
      try {
        await get<Page<ApiTheme>>('/lego/themes/?page_size=1');
      } catch (e) {
        if (e instanceof NotFound) throw new RebrickableError('Rebrickable: the API address answered "not found".');
        throw e;
      }
    },
    async themes() {
      return (await all<ApiTheme>('/lego/themes/?page_size=1000')).map((t) => ({ id: t.id, parentId: t.parent_id ?? null, name: t.name }));
    },
    async set(setNo) {
      try {
        const s = await get<ApiSet>(`/lego/sets/${encodeURIComponent(setNo)}/`);
        return { setNo: s.set_num, name: s.name, year: s.year ?? null, themeId: s.theme_id ?? null, numParts: s.num_parts ?? null, imageUrl: s.set_img_url ?? null };
      } catch (e) {
        if (e instanceof NotFound) return null;
        throw e;
      }
    },
    async alternates(setNo) {
      try {
        return (await all<ApiBuild>(`/lego/sets/${encodeURIComponent(setNo)}/alternates/?page_size=1000`)).map((b) => ({
          mocNo: b.set_num, name: b.name, numParts: b.num_parts ?? null, imageUrl: b.moc_img_url ?? null, url: b.moc_url ?? null, designer: b.designer_name ?? null,
        }));
      } catch (e) {
        if (e instanceof NotFound) return [];
        throw e;
      }
    },
    async buildParts(mocNo) {
      try {
        const lines = await all<ApiInvPart>(`/lego/mocs/${encodeURIComponent(mocNo)}/parts/?page_size=1000&inc_part_details=1`);
        return lines.filter((l) => !l.is_spare).map(toBuildPart);
      } catch (e) {
        if (e instanceof NotFound) throw new PartsUnavailable('not_found', `Rebrickable has no parts list for ${mocNo}.`);
        if (e instanceof RebrickableForbidden) throw new PartsUnavailable('forbidden', `Rebrickable doesn't share the parts list of ${mocNo}.`);
        throw e;
      }
    },
    async themeFigs(themeId) {
      return (await all<ApiFig>(`/lego/minifigs/?in_theme_id=${themeId}&page_size=1000`)).map((f) => ({
        figNo: f.set_num, name: f.name, numParts: f.num_parts ?? null, imageUrl: f.set_img_url ?? null,
      }));
    },
    async minifigCount(setNo) {
      try {
        return (await all<ApiMinifig>(`/lego/sets/${encodeURIComponent(setNo)}/minifigs/?page_size=1000`)).reduce((t, m) => t + (m.quantity ?? 1), 0);
      } catch (e) {
        if (e instanceof NotFound) return 0;
        throw e;
      }
    },
  };
}

/** Client from REBRICKABLE_API_KEY, or null when it isn't set (the feature is optional). */
export function rebrickableFromEnv(): (Catalog & BuildSource & FigSource) | null {
  const key = process.env.REBRICKABLE_API_KEY;
  return key ? createRebrickable(key) : null;
}
