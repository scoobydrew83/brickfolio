// Helpers for DatePicker: values stay plain YYYY-MM-DD strings, as the native <input type="date"> posted them.

/** A YYYY-MM-DD string as a local date (midnight), or undefined when it isn't one. */
export function parseYmd(s: string | null | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : undefined;
}

/** A local date as YYYY-MM-DD (no time zone shift, unlike toISOString). */
export function formatYmd(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Regions whose week starts on Sunday (CLDR), for browsers without Intl.Locale#getWeekInfo (Firefox).
const SUNDAY = new Set(['AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CN', 'CO', 'DM', 'DO', 'ET', 'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN', 'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM', 'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR', 'PT', 'PY', 'SA', 'SG', 'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW']);
const SATURDAY = new Set(['AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY']);

type WeekInfo = { firstDay: number };
type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

/** The first day of the week for a locale such as "en-US" or "de-DE": 0 = Sunday … 6 = Saturday. Monday when unknown. */
export function firstWeekday(locale: string | undefined): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  try {
    const l = new Intl.Locale(locale || 'en-US') as LocaleWithWeek;
    const info = l.getWeekInfo?.() ?? l.weekInfo;
    if (info?.firstDay) return (info.firstDay % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6; // 7 = Sunday
    const region = l.maximize().region ?? '';
    return SUNDAY.has(region) ? 0 : SATURDAY.has(region) ? 6 : 1;
  } catch {
    return 1;
  }
}

/**
 * The react-day-picker locale files to try for a browser language, most specific first: "de-AT" → de-AT, de;
 * "sr-Latn-RS" → sr-Latn, sr-RS, sr. English needs none (it's DayPicker's built-in default). A file that doesn't exist
 * is skipped by the loader.
 */
export function dayPickerLocaleCodes(tag: string | undefined): string[] {
  try {
    const l = new Intl.Locale(tag || 'en-US');
    if (l.language === 'en' || l.language === 'und') return [];
    return [l.script && `${l.language}-${l.script}`, l.region && `${l.language}-${l.region}`, l.language].filter((c): c is string => !!c);
  } catch {
    return [];
  }
}
