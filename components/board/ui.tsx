// Set-specific helpers. Generic UI lives in components/ui.
import { money } from '@/lib/sets';

export type Money = (v: unknown) => string;
export const moneyIn = (currency: string): Money => (v) => money(v, currency);
export const blLink = (setNo: string) => `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(setNo)}`;
