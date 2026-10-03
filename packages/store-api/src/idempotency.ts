import { createHash } from 'node:crypto';

export type IdempotencyRecord = Readonly<{ scope: string; key: string; requestHash: string; responseJson: string }>;

export const hashRequest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const resolveIdempotency = (
  existing: IdempotencyRecord | undefined,
  scope: string,
  key: string,
  request: unknown
): { kind: 'new' } | { kind: 'replay'; responseJson: string } | { kind: 'conflict' } => {
  if (!existing) return { kind: 'new' };
  if (existing.scope !== scope || existing.key !== key) return { kind: 'conflict' };
  return existing.requestHash === hashRequest(request)
    ? { kind: 'replay', responseJson: existing.responseJson }
    : { kind: 'conflict' };
};
