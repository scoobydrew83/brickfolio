import { describe, expect, it } from 'vitest';
import { dayPickerLocaleCodes, firstWeekday } from './dates';

describe('dayPickerLocaleCodes (#119)', () => {
  it('tries the regional file, then the language', () => {
    expect(dayPickerLocaleCodes('de-AT')).toEqual(['de-AT', 'de']);
    expect(dayPickerLocaleCodes('pt-BR')).toEqual(['pt-BR', 'pt']);
    expect(dayPickerLocaleCodes('fr')).toEqual(['fr']);
    expect(dayPickerLocaleCodes('sr-Latn-RS')).toEqual(['sr-Latn', 'sr-RS', 'sr']);
  });
  it('needs nothing for English, an unknown or a missing language', () => {
    expect(dayPickerLocaleCodes('en-US')).toEqual([]);
    expect(dayPickerLocaleCodes('en-GB')).toEqual([]);
    expect(dayPickerLocaleCodes(undefined)).toEqual([]);
    expect(dayPickerLocaleCodes('not a locale!')).toEqual([]);
  });
  it('leaves the week start as it was', () => {
    expect(firstWeekday('de-DE')).toBe(1);
    expect(firstWeekday('en-US')).toBe(0);
  });
});
