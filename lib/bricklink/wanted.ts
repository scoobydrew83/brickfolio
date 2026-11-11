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

/** BrickLink's item type letters back to the type names used in parts lists. */
const TYPE_OF: Record<string, string> = Object.fromEntries(Object.entries(ITEM_TYPE).map(([k, v]) => [v, k]));

const unxml = (v: string) => v.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);

export type XmlItem = { type: string; partNo: string; colorId: number | null; qty: number; condition: 'N' | 'U' | null; remarks: string | null };

/**
 * Reads BrickLink XML: a Wanted List (MINQTY) or an inventory or Studio export (QTY), `<INVENTORY><ITEM>…`. A small
 * hand-written reader (Workers have no DOMParser): comments and unknown tags are ignored. Colours apply to parts only.
 * Items it can't read are reported in `errors` with their position, and left out.
 */
export function parseBrickLinkXml(text: string): { items: XmlItem[]; errors: string[] } {
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  const items: XmlItem[] = [], errors: string[] = [];
  if (!/<INVENTORY[\s>]/i.test(src)) return { items, errors: ['This isn\'t BrickLink XML: there is no <INVENTORY> element.'] };
  const blocks = src.match(/<ITEM>[\s\S]*?<\/ITEM>/gi) ?? [];
  // A cut-off file (an unclosed <ITEM>, or no </INVENTORY>) is refused, so it can't import or replace part of a list.
  const opened = (src.match(/<ITEM[\s>]/gi) ?? []).length;
  if (!/<\/INVENTORY>/i.test(src) || opened !== blocks.length || (src.match(/<\/ITEM>/gi) ?? []).length !== blocks.length) {
    return { items, errors: ['The file looks cut off or broken: every <ITEM> needs a closing </ITEM>, and the list needs a closing </INVENTORY>.'] };
  }
  blocks.forEach((b, i) => {
    const tag = (name: string) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(b); return m ? unxml(m[1].trim()) : null; };
    const letter = (tag('ITEMTYPE') ?? 'P').toUpperCase();
    const type = TYPE_OF[letter];
    const partNo = tag('ITEMID');
    const qtyRaw = tag('QTY') ?? tag('MINQTY') ?? '1';
    const qty = Number(qtyRaw);
    const colorRaw = tag('COLOR');
    const cond = (tag('CONDITION') ?? '').toUpperCase();
    if (!type) return void errors.push(`Item ${i + 1}: unknown item type "${letter}".`);
    if (!partNo || partNo.length > 64) return void errors.push(`Item ${i + 1}: no item number.`);
    if (!Number.isInteger(qty) || qty < 1) return void errors.push(`Item ${i + 1} (${partNo}): quantity "${qtyRaw}" isn't a whole number of 1 or more.`);
    const colorId = type === 'PART' && colorRaw && /^\d+$/.test(colorRaw) && colorRaw !== '0' ? Number(colorRaw) : null;
    items.push({ type, partNo, colorId, qty, condition: cond === 'N' || cond === 'U' ? cond : null, remarks: tag('REMARKS') });
  });
  if (!blocks.length) errors.push('The file has no <ITEM> entries.');
  return { items, errors };
}
