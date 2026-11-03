// BrickLink Wanted List XML (on BrickLink: Want → Upload → paste the XML). Used for "What can I build?" and for
// finishing Partial sets.

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** BrickLink item types as the Wanted List spells them. */
const ITEM_TYPE: Record<string, string> = { PART: 'P', MINIFIG: 'M', GEAR: 'G', BOOK: 'B', CATALOG: 'C', INSTRUCTION: 'I', SET: 'S', ORIGINAL_BOX: 'O' };

export type WantedItem = { type?: string; partNo: string; colorId: number | null; qty: number };

/** The items as Wanted List XML, with an XML comment saying what they're for. Colors apply to parts only. */
export function toWantedListXml(items: WantedItem[], comment: string): string {
  const lines = items.map((i) =>
    `  <ITEM>\n    <ITEMTYPE>${ITEM_TYPE[i.type ?? 'PART'] ?? 'P'}</ITEMTYPE>\n    <ITEMID>${xml(i.partNo)}</ITEMID>\n${(i.type ?? 'PART') === 'PART' && i.colorId !== null ? `    <COLOR>${i.colorId}</COLOR>\n` : ''}    <MINQTY>${i.qty}</MINQTY>\n  </ITEM>`);
  return `<!-- ${xml(comment).replace(/--/g, '-')} -->\n<INVENTORY>\n${lines.join('\n')}${lines.length ? '\n' : ''}</INVENTORY>\n`;
}

/** Identifies a part line across the parts list and the missing list (part numbers compared case-blind). */
export const partKey = (type: string, partNo: string, colorId: number | null) => `${type}|${partNo.toLowerCase()}|${colorId ?? -1}`;
