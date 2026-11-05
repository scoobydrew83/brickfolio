// Client-safe: the photo URL to show for an item. Items in the collection use the image cache route (same origin,
// so the Scan page's service worker keeps them for offline use); others keep the provider's URL.
export const cachedImageSrc = (kind: 'set' | 'minifig', no: string | null | undefined, url: string | null | undefined, inCollection: boolean) =>
  url && no && inCollection ? `/api/v1/images/${kind}/${encodeURIComponent(no)}` : url ?? null;

/** An img onError that switches once to the provider's URL, e.g. when the cache route has no photo for the item. */
export const fallBackTo = (url: string) => (e: { currentTarget: HTMLImageElement }) => {
  if (e.currentTarget.dataset.fallback) return;
  e.currentTarget.dataset.fallback = '1';
  e.currentTarget.src = url;
};
