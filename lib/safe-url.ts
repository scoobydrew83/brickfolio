/** An https URL safe to store and show as a link or image (no spaces, quotes or angle brackets, at most 500 characters), or null. */
export const safeHttpsUrl = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 500 ? s : null;
};
