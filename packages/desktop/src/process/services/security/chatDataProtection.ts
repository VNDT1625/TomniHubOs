import { randomUUID } from 'node:crypto';

import { redactSensitiveText } from '@process/agentRuntime/agentMesh/security';

export type ChatDataCategory =
  | 'credential'
  | 'financial'
  | 'health'
  | 'identity'
  | 'personal.address'
  | 'personal.contact'
  | 'private.workspace'
  | 'unclassified';

export type ChatDataSource = 'attachment' | 'clipboard' | 'context' | 'note' | 'text' | 'tool-output' | 'url';
export type ChatDataProtectionDecision = 'allow' | 'block' | 'protected';

export type LocalSemanticFinding = Readonly<{
  start: number;
  end: number;
  category: ChatDataCategory;
  confidence: number;
  label: string;
}>;

export type LocalSemanticClassifier = {
  readonly execution: 'local' | 'isolated';
  classify(input: Readonly<{ text: string; source: ChatDataSource }>): Promise<unknown>;
};

export type ChatSecretCodec = {
  available(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

export type ChatTemporarySecret = Readonly<{
  handle: string;
  label: string;
  category: ChatDataCategory;
  confidence: number;
  source: ChatDataSource;
  createdAt: number;
}>;

export type ChatDataAuditEntry = Readonly<{
  event: 'created' | 'accepted' | 'cleared' | 'egress';
  sessionId: string;
  handle?: string;
  destination?: string;
  decision?: 'allow' | 'block';
  timestamp: number;
}>;

type StoredTemporarySecret = ChatTemporarySecret & { encryptedValue: string };

export type ChatTemporarySecretStore = {
  create(
    sessionId: string,
    input: Omit<ChatTemporarySecret, 'handle' | 'createdAt'> & { value: string }
  ): ChatTemporarySecret;
  list(sessionId: string): ChatTemporarySecret[];
  accept(sessionId: string, handle: string): { secret: ChatTemporarySecret; value: string };
  clear(sessionId: string): void;
  recordEgress(sessionId: string, destination: string, decision: 'allow' | 'block'): void;
  audit(sessionId: string): ChatDataAuditEntry[];
};

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_LABEL = /[^A-Za-z0-9]+/gu;
const CATEGORIES = new Set<ChatDataCategory>([
  'credential',
  'financial',
  'health',
  'identity',
  'personal.address',
  'personal.contact',
  'private.workspace',
  'unclassified',
]);

const copyMetadata = ({ encryptedValue: _encryptedValue, ...secret }: StoredTemporarySecret): ChatTemporarySecret =>
  structuredClone(secret);

const assertSession = (sessionId: string): void => {
  if (!SAFE_SESSION_ID.test(sessionId)) throw new Error('Invalid chat session identifier.');
};

const handleLabel = (label: string): string => {
  const normalized = label
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(SAFE_LABEL, '_')
    .replace(/^_+|_+$/gu, '');
  return normalized.slice(0, 48) || 'SENSITIVE';
};

const parseFindings = (value: unknown, text: string): LocalSemanticFinding[] | undefined => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { findings?: unknown }).findings))
    return undefined;
  const findings = (value as { findings: unknown[] }).findings;
  const parsed: LocalSemanticFinding[] = [];
  for (const item of findings) {
    if (!item || typeof item !== 'object') return undefined;
    const finding = item as Record<string, unknown>;
    if (
      !Number.isInteger(finding.start) ||
      !Number.isInteger(finding.end) ||
      typeof finding.category !== 'string' ||
      typeof finding.confidence !== 'number' ||
      typeof finding.label !== 'string' ||
      !CATEGORIES.has(finding.category as ChatDataCategory)
    ) {
      return undefined;
    }
    const start = finding.start as number;
    const end = finding.end as number;
    const confidence = finding.confidence as number;
    const label = finding.label.trim().slice(0, 120);
    if (
      start < 0 ||
      end <= start ||
      end > text.length ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      !label
    ) {
      return undefined;
    }
    parsed.push({ start, end, category: finding.category as ChatDataCategory, confidence, label });
  }
  const sorted = parsed.toSorted((left, right) => left.start - right.start || right.end - left.end);
  if (sorted.some((item, index) => index > 0 && item.start < (sorted[index - 1]?.end ?? 0))) return undefined;
  return sorted;
};

/** Main-only, session-bound temporary vault. Values never cross an IPC response. */
export const createChatTemporarySecretStore = (
  codec: ChatSecretCodec,
  options: { now?: () => number; newHandle?: () => string } = {}
): ChatTemporarySecretStore => {
  const now = options.now ?? Date.now;
  const newHandle = options.newHandle ?? (() => `temp://chat/${randomUUID()}`);
  const secrets = new Map<string, StoredTemporarySecret[]>();
  const audit = new Map<string, ChatDataAuditEntry[]>();
  const append = (sessionId: string, entry: Omit<ChatDataAuditEntry, 'sessionId' | 'timestamp'>): void => {
    const current = audit.get(sessionId) ?? [];
    audit.set(sessionId, [...current, { ...entry, sessionId, timestamp: now() }]);
  };
  const requireEncryption = (): void => {
    if (!codec.available()) throw new Error('Temporary secret encryption is unavailable.');
  };

  return {
    create(sessionId, input) {
      assertSession(sessionId);
      requireEncryption();
      if (!CATEGORIES.has(input.category) || !input.value || !input.label.trim())
        throw new Error('Invalid temporary secret.');
      const secret: StoredTemporarySecret = {
        handle: newHandle(),
        label: input.label.trim().slice(0, 120),
        category: input.category,
        confidence: input.confidence,
        source: input.source,
        createdAt: now(),
        encryptedValue: codec.encrypt(input.value),
      };
      secrets.set(sessionId, [...(secrets.get(sessionId) ?? []), secret]);
      append(sessionId, { event: 'created', handle: secret.handle });
      return copyMetadata(secret);
    },
    list(sessionId) {
      assertSession(sessionId);
      return (secrets.get(sessionId) ?? []).map(copyMetadata);
    },
    accept(sessionId, handle) {
      assertSession(sessionId);
      requireEncryption();
      const current = secrets.get(sessionId) ?? [];
      const stored = current.find((secret) => secret.handle === handle);
      if (!stored) throw new Error('Unknown temporary secret.');
      const value = codec.decrypt(stored.encryptedValue);
      secrets.set(
        sessionId,
        current.filter((secret) => secret.handle !== handle)
      );
      append(sessionId, { event: 'accepted', handle });
      return { secret: copyMetadata(stored), value };
    },
    clear(sessionId) {
      assertSession(sessionId);
      secrets.delete(sessionId);
      append(sessionId, { event: 'cleared' });
    },
    recordEgress(sessionId, destination, decision) {
      assertSession(sessionId);
      append(sessionId, { event: 'egress', destination, decision });
    },
    audit(sessionId) {
      assertSession(sessionId);
      return structuredClone(audit.get(sessionId) ?? []);
    },
  };
};

export type ChatDataProtectionResult =
  | Readonly<{ decision: 'allow'; rewrittenText: string; secrets: readonly ChatTemporarySecret[] }>
  | Readonly<{ decision: 'protected'; rewrittenText: string; secrets: readonly ChatTemporarySecret[] }>
  | Readonly<{ decision: 'block'; reason: string }>;

/**
 * Combines deterministic redaction with a local semantic classifier. A malformed,
 * remote, or unavailable classifier cannot allow plaintext past this boundary.
 */
export const protectChatData = async (
  input: Readonly<{ sessionId: string; source: ChatDataSource; text: string }>,
  dependencies: Readonly<{
    classifier?: LocalSemanticClassifier;
    store: ChatTemporarySecretStore;
    minimumConfidence?: number;
  }>
): Promise<ChatDataProtectionResult> => {
  assertSession(input.sessionId);
  if (!input.text) return { decision: 'allow', rewrittenText: '', secrets: [] };
  const deterministic = redactSensitiveText(input.text);
  if (deterministic.redacted) return { decision: 'block', reason: 'deterministic_secret_detected' };
  if (!dependencies.classifier || !['local', 'isolated'].includes(dependencies.classifier.execution)) {
    return { decision: 'block', reason: 'semantic_classifier_unavailable' };
  }

  let findings: LocalSemanticFinding[] | undefined;
  try {
    findings = parseFindings(
      await dependencies.classifier.classify({ text: input.text, source: input.source }),
      input.text
    );
  } catch {
    return { decision: 'block', reason: 'semantic_classifier_failed' };
  }
  if (!findings) return { decision: 'block', reason: 'semantic_classifier_invalid' };
  const minimumConfidence = dependencies.minimumConfidence ?? 0.8;
  const accepted = findings.filter((finding) => finding.confidence >= minimumConfidence);
  if (accepted.length === 0) return { decision: 'allow', rewrittenText: input.text, secrets: [] };

  const created = accepted.map((finding) =>
    dependencies.store.create(input.sessionId, {
      label: finding.label,
      category: finding.category,
      confidence: finding.confidence,
      source: input.source,
      value: input.text.slice(finding.start, finding.end),
    })
  );
  let rewrittenText = input.text;
  for (let index = accepted.length - 1; index >= 0; index -= 1) {
    const finding = accepted[index];
    const secret = created[index];
    if (!finding || !secret) continue;
    const replacement = `[${handleLabel(secret.label)}_TEMP_${String(index + 1).padStart(2, '0')}]`;
    rewrittenText = `${rewrittenText.slice(0, finding.start)}${replacement}${rewrittenText.slice(finding.end)}`;
  }
  return { decision: 'protected', rewrittenText, secrets: created };
};
