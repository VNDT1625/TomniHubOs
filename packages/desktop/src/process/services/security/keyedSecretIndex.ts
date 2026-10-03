import { createHmac, randomBytes } from 'node:crypto';

export type KeyedSecretIndex = Readonly<{
  revision: string;
  add(value: string): string;
  has(value: string): boolean;
  hasInText(text: string): boolean;
  clear(): void;
}>;

/** Main-only keyed fingerprints; values and fingerprints never leave this process. */
export const createKeyedSecretIndex = (revision: string, key = randomBytes(32)): KeyedSecretIndex => {
  const entries = new Set<string>();
  const lengths = new Set<number>();
  const digest = (value: string): string => createHmac('sha256', key).update(value, 'utf8').digest('hex');
  return {
    revision,
    add(value: string): string {
      if (!value) throw new Error('Secret value is required.');
      const fingerprint = digest(value);
      entries.add(fingerprint);
      lengths.add(value.length);
      return fingerprint;
    },
    has(value: string): boolean {
      return Boolean(value) && entries.has(digest(value));
    },
    hasInText(text: string): boolean {
      if (!text || text.length > 1_000_000) return false;
      for (const length of lengths) {
        for (let offset = 0; offset + length <= text.length; offset += 1) {
          if (entries.has(digest(text.slice(offset, offset + length)))) return true;
        }
      }
      return false;
    },
    clear(): void {
      entries.clear();
    },
  };
};
