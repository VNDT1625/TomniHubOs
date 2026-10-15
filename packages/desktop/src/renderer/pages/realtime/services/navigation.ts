/** Only https links are allowed to cross from Realtime cards to the internal browser. */
export function browserPathForExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return `/browser?url=${encodeURIComponent(url.href)}`;
  } catch {
    return null;
  }
}
