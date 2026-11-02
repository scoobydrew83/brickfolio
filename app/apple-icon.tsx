import { badge } from './badge';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export default function AppleIcon() {
  return badge(180);
}
