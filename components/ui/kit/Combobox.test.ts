import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Combobox, canCreate, startValue } from './Combobox';
import { DatePicker } from './DatePicker';
import { firstWeekday, formatYmd, parseYmd } from './dates';

const LOCS = [{ value: '', label: '(none)' }, { value: 'Shelf A', label: 'Shelf A' }, { value: 'Garage', label: 'Garage' }];

/** The value a rendered field posts under `name`. */
const posted = (html: string, name: string) => new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"|<input[^>]*value="([^"]*)"[^>]*name="${name}"`).exec(html)?.slice(1).find((v) => v !== undefined);

describe('Combobox (#105)', () => {
  it('posts the chosen value under its name, as the <select> did', () => {
    const html = renderToStaticMarkup(createElement(Combobox, { name: 'location', label: 'Location', options: LOCS, defaultValue: 'Garage' }));
    expect(posted(html, 'location')).toBe('Garage');
    expect(html).toContain('Garage');
  });

  it('starts like a select: a value that is no option falls back to the first option', () => {
    expect(startValue(LOCS, 'Shelf A')).toBe('Shelf A');
    expect(startValue(LOCS, '')).toBe('');
    expect(startValue(LOCS, 'Gone')).toBe(''); // a deleted location posted '' from the <select> too
    expect(posted(renderToStaticMarkup(createElement(Combobox, { name: 'location', label: 'Location', options: LOCS, defaultValue: 'Gone' })), 'location')).toBe('');
  });

  it('keeps free text (a colour number with no colour names yet) as it is', () => {
    expect(startValue([], '5', true)).toBe('5');
    expect(posted(renderToStaticMarkup(createElement(Combobox, { name: 'colorId', label: 'Colour', options: [], defaultValue: '5', allowCreate: true })), 'colorId')).toBe('5');
  });

  it('offers to create only text that is not already an option', () => {
    expect(canCreate(LOCS, 'Attic')).toBe(true);
    expect(canCreate(LOCS, ' garage ')).toBe(false);
    expect(canCreate(LOCS, '   ')).toBe(false);
  });
});

describe('DatePicker (#105)', () => {
  it('posts the same YYYY-MM-DD string the date input did, or nothing', () => {
    expect(posted(renderToStaticMarkup(createElement(DatePicker, { name: 'acquiredDate', label: 'Acquired', defaultValue: '2024-02-29' })), 'acquiredDate')).toBe('2024-02-29');
    expect(posted(renderToStaticMarkup(createElement(DatePicker, { name: 'buildDate', label: 'Built' })), 'buildDate')).toBe('');
  });

  it('round-trips dates without a time-zone shift', () => {
    for (const s of ['2024-02-29', '1999-12-31', '2025-01-01']) expect(formatYmd(parseYmd(s)!)).toBe(s);
    expect(parseYmd('2023-02-29')).toBeUndefined();
    expect(parseYmd('')).toBeUndefined();
    expect(parseYmd('29/02/2024')).toBeUndefined();
  });

  it("starts the week on the locale's first day", () => {
    expect(firstWeekday('en-US')).toBe(0);
    expect(firstWeekday('de-DE')).toBe(1);
    expect(firstWeekday('en-GB')).toBe(1);
    expect(firstWeekday('ar-EG')).toBe(6);
    expect(firstWeekday('not a locale')).toBe(1);
  });
});
