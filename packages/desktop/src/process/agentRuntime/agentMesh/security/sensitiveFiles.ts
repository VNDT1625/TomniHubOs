import path from 'node:path';

import { redactSecretText, redactSensitiveText } from './secretFirewall';
import type { SecretFirewallResult } from './types';

const MAX_MARKED_FILES = 1_024;
const MARK_TTL_MS = 24 * 60 * 60 * 1_000;
const markedFiles = new Map<string, number>();

const normalizePath = (filePath: string): string => path.resolve(filePath).toLowerCase();

const looksSensitiveByName = (filePath: string): boolean => {
  const name = path.basename(filePath).toLowerCase();
  return (
    /^\.env(?:\..+)?$/u.test(name) ||
    /(?:secret|credential|private[-_.]?key|access[-_.]?token|auth[-_.]?token)/u.test(name) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/u.test(name) ||
    /\.(?:pem|p12|pfx|key|keystore|jks)$/u.test(name)
  );
};

const prune = (now: number): void => {
  for (const [filePath, expiresAt] of markedFiles) {
    if (expiresAt <= now) markedFiles.delete(filePath);
  }
  while (markedFiles.size > MAX_MARKED_FILES) {
    const oldest = markedFiles.keys().next().value;
    if (typeof oldest !== 'string') break;
    markedFiles.delete(oldest);
  }
};

/** Mark one path as secret-bearing without retaining any file content or secret value. */
export const markSecretBearingFile = (filePath: string, now = Date.now()): void => {
  prune(now);
  const normalized = normalizePath(filePath);
  markedFiles.delete(normalized);
  markedFiles.set(normalized, now + MARK_TTL_MS);
  prune(now);
};

/** Redact a file read and remember paths whose content or name indicates secret material. */
export const redactSecretFileText = (filePath: string, input: string, now = Date.now()): SecretFirewallResult => {
  prune(now);
  const normalized = normalizePath(filePath);
  const classified = looksSensitiveByName(filePath) || (markedFiles.get(normalized) ?? 0) > now;
  let result = classified ? redactSensitiveText(input) : redactSecretText(input);
  if (!classified && result.redacted) {
    markSecretBearingFile(filePath, now);
    result = redactSensitiveText(input);
  } else if (classified) {
    markSecretBearingFile(filePath, now);
  }
  return result;
};

export const resetSecretBearingFilesForTests = (): void => {
  markedFiles.clear();
};
