// Public BrickLink URLs for catalog images and pages. No API call needed.

const IMG_TYPE: Record<string, string> = { PART: 'P', SET: 'S', MINIFIG: 'M', GEAR: 'G', BOOK: 'B', CATALOG: 'C', INSTRUCTION: 'I', ORIGINAL_BOX: 'O' };

/** Thumbnail for a catalog item. Parts are pictured in their color. */
export const itemImage = (type: string, no: string, colorId: number | null) => {
  const t = IMG_TYPE[type] ?? 'P';
  return `https://img.bricklink.com/ItemImage/${t}N/${t === 'P' ? (colorId ?? 0) : 0}/${encodeURIComponent(no)}.png`;
};
export const itemPage = (type: string, no: string) => `https://www.bricklink.com/v2/catalog/catalogitem.page?${IMG_TYPE[type] ?? 'P'}=${encodeURIComponent(no)}`;
export const orderPage = (id: number) => `https://www.bricklink.com/orderDetail.asp?ID=${id}`;
