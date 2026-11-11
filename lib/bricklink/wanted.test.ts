import { describe, expect, it } from 'vitest';
import { parseBrickLinkXml, toWantedListXml } from './wanted';

describe('parseBrickLinkXml', () => {
  it('reads back what toWantedListXml writes', () => {
    const items = [
      { type: 'PART', partNo: '3001', colorId: 5, qty: 10 },
      { type: 'MINIFIG', partNo: 'sw0001', colorId: null, qty: 1 },
      { type: 'PART', partNo: '3069b&<x>"', colorId: 11, qty: 2 },
    ];
    const { items: back, errors } = parseBrickLinkXml(toWantedListXml(items, 'Parts for a -- test'));
    expect(errors).toEqual([]);
    expect(back.map(({ type, partNo, colorId, qty }) => ({ type, partNo, colorId, qty }))).toEqual(items);
  });

  it('reads an inventory export: QTY, condition, remarks, entities, and ignores comments and unknown tags', () => {
    const xml = `<?xml version="1.0"?>
<!-- <ITEM><ITEMID>commented</ITEMID></ITEM> -->
<INVENTORY>
  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3023</ITEMID><COLOR>86</COLOR><QTY>24</QTY><CONDITION>U</CONDITION><REMARKS>Drawer &amp; bin 3</REMARKS><PRICE>0.05</PRICE></ITEM>
  <ITEM>
    <ITEMTYPE>M</ITEMTYPE><ITEMID>sp047</ITEMID><COLOR>0</COLOR><MINQTY>1</MINQTY>
  </ITEM>
  <ITEM><ITEMID>3001</ITEMID><QTY>2</QTY></ITEM>
</INVENTORY>`;
    expect(parseBrickLinkXml(xml)).toEqual({
      items: [
        { type: 'PART', partNo: '3023', colorId: 86, qty: 24, condition: 'U', remarks: 'Drawer & bin 3' },
        { type: 'MINIFIG', partNo: 'sp047', colorId: null, qty: 1, condition: null, remarks: null }, // minifigs carry no colour
        { type: 'PART', partNo: '3001', colorId: null, qty: 2, condition: null, remarks: null }, // no ITEMTYPE = part
      ],
      errors: [],
    });
  });

  it('refuses a cut-off file instead of reading part of it', () => {
    const whole = '<INVENTORY><ITEM><ITEMID>3001</ITEMID><QTY>2</QTY></ITEM><ITEM><ITEMID>3002</ITEMID><QTY>1</QTY></ITEM></INVENTORY>';
    expect(parseBrickLinkXml(whole).items).toHaveLength(2);
    for (const cut of [whole.slice(0, whole.indexOf('<ITEM><ITEMID>3002') + 20), whole.replace('</INVENTORY>', ''), whole.replace('</ITEM><ITEM><ITEMID>3002', '<ITEM><ITEMID>3002')]) {
      expect(parseBrickLinkXml(cut)).toEqual({ items: [], errors: [expect.stringMatching(/cut off/)] });
    }
  });

  it('reports bad items and refuses things that are not BrickLink XML', () => {
    expect(parseBrickLinkXml('Part,Color,Quantity\n3001,4,2').errors[0]).toMatch(/no <INVENTORY>/);
    expect(parseBrickLinkXml('<INVENTORY></INVENTORY>').errors).toEqual(['The file has no <ITEM> entries.']);
    const r = parseBrickLinkXml('<INVENTORY><ITEM><ITEMTYPE>Z</ITEMTYPE><ITEMID>1</ITEMID></ITEM><ITEM><ITEMID>3001</ITEMID><QTY>two</QTY></ITEM><ITEM><ITEMTYPE>P</ITEMTYPE></ITEM></INVENTORY>');
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual(['Item 1: unknown item type "Z".', 'Item 2 (3001): quantity "two" isn\'t a whole number of 1 or more.', 'Item 3: no item number.']);
  });
});
