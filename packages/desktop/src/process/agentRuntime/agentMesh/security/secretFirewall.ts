import type { SecretFinding, SecretFindingType, SecretFirewallResult } from './types';

const REDACTED = '[REDACTED]';

type Candidate = SecretFinding & {
  start: number;
  end: number;
  replacement: string;
  priority: number;
  redacts: boolean;
};

type KnownPattern = {
  name: string;
  type: SecretFindingType;
  pattern: RegExp;
  valueGroup?: number;
};

type ScanView = {
  text: string;
  /** Original UTF-16 index for every character retained in text. */
  originalIndexes: number[];
};

const isInvisibleFormatCharacter = (character: string): boolean =>
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(character);

/**
 * Build a detector-only view that cannot be split with terminal styling or
 * invisible Unicode. The original index map lets replacements cover plaintext
 * in the untouched output instead of returning the normalized detector view.
 */
const createScanView = (input: string): ScanView => {
  let text = '';
  const originalIndexes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    if (character === '\u001b') {
      const introducer = input[index + 1];
      if (introducer === '[') {
        index += 2;
        while (index < input.length && !/[@-~]/u.test(input[index] ?? '')) index += 1;
        continue;
      }
      if (introducer === ']') {
        index += 2;
        while (index < input.length) {
          if (input[index] === '\u0007') break;
          if (input[index] === '\u001b' && input[index + 1] === '\\') {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
      continue;
    }
    if (isInvisibleFormatCharacter(character)) continue;
    text += character;
    originalIndexes.push(index);
  }
  return { text, originalIndexes };
};

const KNOWN_PATTERNS: KnownPattern[] = [
  {
    name: 'JWT',
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { name: 'AWS_ACCESS_KEY_ID', type: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'GITHUB_TOKEN', type: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  { name: 'GITHUB_TOKEN', type: 'github-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'GITLAB_TOKEN', type: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,255}\b/g },
  { name: 'SLACK_TOKEN', type: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/g },
  { name: 'STRIPE_SECRET_KEY', type: 'stripe-secret-key', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,255}\b/g },
  {
    name: 'OPENAI_API_KEY',
    type: 'openai-api-key',
    pattern: /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,255}\b/g,
  },
  { name: 'GOOGLE_API_KEY', type: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{30,60}\b/g },
  { name: 'GOOGLE_OAUTH_CLIENT_SECRET', type: 'secret', pattern: /\bGOCSPX-[A-Za-z0-9_-]{12,255}\b/g },
  { name: 'NPM_TOKEN', type: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{20,255}\b/g },
  {
    name: 'BEARER_TOKEN',
    type: 'token',
    pattern: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi,
    valueGroup: 2,
  },
];

const normalizeKey = (key: string): string =>
  key
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

const isHighConfidenceKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  if (!normalized || normalized.includes('publickey')) return false;
  return [
    'apikey',
    'apisecret',
    'accesskey',
    'accesskeyid',
    'secretaccesskey',
    'password',
    'passwd',
    'passphrase',
    'matkhau',
    'matma',
    'mapin',
    'clientsecret',
    'webhooksecret',
    'authtoken',
    'accesstoken',
    'refreshtoken',
    'bearertoken',
    'idtoken',
    'privatekey',
    'signingkey',
    'encryptionkey',
    'encryptionkeys',
    'fernetkey',
    'databaseurl',
    'dburl',
    'connectionstring',
    'authorization',
    'credential',
    'credentials',
    'cookie',
    'sessioncookie',
    'sessiontoken',
    'secret',
    'token',
  ].some((suffix) => normalized === suffix || normalized.endsWith(suffix));
};

const inferKeyType = (key: string): SecretFindingType => {
  const normalized = normalizeKey(key);
  if (
    normalized.includes('password') ||
    normalized.endsWith('passwd') ||
    normalized.endsWith('passphrase') ||
    normalized.endsWith('matkhau') ||
    normalized.endsWith('matma') ||
    normalized.endsWith('mapin')
  ) {
    return 'password';
  }
  if (normalized.includes('privatekey') || normalized.includes('signingkey') || normalized.includes('encryptionkey')) {
    return 'private-key';
  }
  if (normalized.includes('databaseurl') || normalized.endsWith('dburl') || normalized.includes('connectionstring')) {
    return 'connection-string';
  }
  if (normalized.includes('apikey') || normalized.includes('accesskey')) return 'api-key';
  if (normalized.includes('token') || normalized === 'authorization') return 'token';
  return 'secret';
};

const isAlreadyMasked = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized) return false;
  return (
    /^(?:\[REDACTED(?::[^\]]+)?\]|<redacted>|\*{3,}|[xX]{4,}|•{3,})$/i.test(normalized) ||
    /^(?:\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\})$/.test(normalized) ||
    /^\{\{\s*(?:secrets?|env)\.[^}]+\}\}$/i.test(normalized) ||
    /^process\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ||
    /^secret:\/\/[A-Za-z0-9][A-Za-z0-9._~/-]{0,255}$/i.test(normalized)
  );
};

const addStructuredCandidate = (
  candidates: Candidate[],
  input: string,
  key: string,
  start: number,
  end: number,
  priority: number
): void => {
  if (!isHighConfidenceKey(key) || start >= end) return;
  const value = input.slice(start, end);
  if (!value.trim()) return;
  const alreadyMasked = isAlreadyMasked(value);
  candidates.push({
    start,
    end,
    replacement: alreadyMasked ? value : REDACTED,
    redacts: !alreadyMasked,
    name: key,
    type: alreadyMasked ? 'already-masked' : inferKeyType(key),
    confidence: 'high',
    priority,
  });
};

const collectQuotedStructuredValues = (input: string, candidates: Candidate[]): void => {
  const quotedField = /(["'])([A-Za-z_][A-Za-z0-9_.-]{0,127})\1(\s*:\s*)(["'])((?:\\.|[^\r\n])*?)\4/g;
  for (const match of input.matchAll(quotedField)) {
    const [full, keyQuote, key, separator, valueQuote, value] = match;
    if (match.index === undefined || !full || value === undefined) continue;
    const start = match.index + keyQuote.length + key.length + keyQuote.length + separator.length + valueQuote.length;
    addStructuredCandidate(candidates, input, key, start, start + value.length, 120);
  }
};

const quotedValueEnd = (value: string, quote: string): number => {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return index;
  }
  return -1;
};

const scalarValueSpan = (raw: string, structuredSuffix: boolean): { start: number; end: number } | undefined => {
  const start = raw.length - raw.trimStart().length;
  if (start >= raw.length) return undefined;
  const quote = raw[start];
  if (quote === '"' || quote === "'") {
    const closing = quotedValueEnd(raw.slice(start), quote);
    return closing > 0 ? { start: start + 1, end: start + closing } : undefined;
  }
  let end = raw.length;
  const comment = raw.slice(start).search(/\s+#/);
  if (comment >= 0) end = start + comment;
  while (end > start && /\s/.test(raw[end - 1] ?? '')) end -= 1;
  if (isAlreadyMasked(raw.slice(start, end))) return { start, end };
  if (structuredSuffix) {
    while (end > start && /[,}\]]/.test(raw[end - 1] ?? '')) end -= 1;
  }
  while (end > start && /\s/.test(raw[end - 1] ?? '')) end -= 1;
  const value = raw.slice(start, end);
  if (!value || value === '|' || value === '>') return undefined;
  return { start, end };
};

const collectLineStructuredValues = (input: string, candidates: Candidate[]): void => {
  const assignment =
    /^(\s*(?:(?:\d+):\s+)?(?:export\s+)?)(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,127})\2(\s*([:=])\s*)([^\r\n]*)(\r?)$/gm;
  for (const match of input.matchAll(assignment)) {
    const [full, prefix, quote, key, separator, operator, raw] = match;
    if (match.index === undefined || !full) continue;
    const trimmed = raw.trimStart();
    if (operator === ':' && (trimmed.startsWith('"') || trimmed.startsWith("'"))) continue;
    const span = scalarValueSpan(raw, operator === ':');
    if (!span) continue;
    const rawStart = match.index + prefix.length + quote.length + key.length + quote.length + separator.length;
    addStructuredCandidate(candidates, input, key, rawStart + span.start, rawStart + span.end, 100);
  }
};

const collectYamlBlockValues = (input: string, candidates: Candidate[]): void => {
  const block =
    /^([ \t]*)([A-Za-z_][A-Za-z0-9_.-]{0,127})\s*:\s*[|>][+-]?[ \t]*(?:#.*)?\r?\n((?:(?:\1[ \t]+)[^\r\n]*(?:\r?\n|$))+)/gm;
  for (const match of input.matchAll(block)) {
    if (match.index === undefined || !isHighConfidenceKey(match[2] ?? '')) continue;
    const body = match[3] ?? '';
    if (!body.trim() || isAlreadyMasked(body.trim())) continue;
    const bodyStart = match.index + match[0].length - body.length;
    const indent = `${match[1] ?? ''}  `;
    candidates.push({
      start: bodyStart,
      end: bodyStart + body.length,
      replacement: `${indent}${REDACTED}${body.endsWith('\n') ? '\n' : ''}`,
      redacts: true,
      name: match[2] ?? 'SECRET',
      type: inferKeyType(match[2] ?? 'SECRET'),
      confidence: 'high',
      priority: 150,
    });
  }
};

const collectCliFlagValues = (input: string, candidates: Candidate[]): void => {
  const flag = /(?:^|\s)--([A-Za-z][A-Za-z0-9_.-]{1,127})(?:=|\s+)("(?:\\.|[^"\r\n])*"|'(?:\\.|[^'\r\n])*'|[^\s;&|]+)/g;
  for (const match of input.matchAll(flag)) {
    if (match.index === undefined || !match[1] || !match[2] || !isHighConfidenceKey(match[1])) continue;
    const raw = match[2];
    const value = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") ? raw.slice(1, -1) : raw;
    const offset = match[0].lastIndexOf(raw) + (value === raw ? 0 : 1);
    addStructuredCandidate(candidates, input, match[1], match.index + offset, match.index + offset + value.length, 140);
  }
};

const collectXmlValues = (input: string, candidates: Candidate[]): void => {
  const xml = /<([A-Za-z_][A-Za-z0-9_.-]{0,127})\b[^>]*>([^<\r\n]+)<\/\1\s*>/gi;
  for (const match of input.matchAll(xml)) {
    if (match.index === undefined || !match[1] || match[2] === undefined || !isHighConfidenceKey(match[1])) continue;
    const start = match.index + match[0].indexOf(match[2]);
    addStructuredCandidate(candidates, input, match[1], start, start + match[2].length, 130);
  }
};

const collectConnectionStrings = (input: string, candidates: Candidate[]): void => {
  const connection =
    /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s:/@]+:([^\s/@]+)@[^\s]+/gi;
  for (const match of input.matchAll(connection)) {
    if (match.index === undefined || !match[1] || isAlreadyMasked(match[1])) continue;
    const offset = match[0].indexOf(match[1]);
    candidates.push({
      start: match.index + offset,
      end: match.index + offset + match[1].length,
      replacement: REDACTED,
      redacts: true,
      name: 'CONNECTION_STRING_PASSWORD',
      type: 'connection-string',
      confidence: 'high',
      priority: 170,
    });
  }
};

const collectUrlCredentials = (input: string, candidates: Candidate[]): void => {
  const queryValue = /[?&#]([A-Za-z_][A-Za-z0-9_.~-]{0,127})=([^&#\s]*)/g;
  for (const match of input.matchAll(queryValue)) {
    if (match.index === undefined || !match[1] || !match[2] || !isHighConfidenceKey(match[1])) continue;
    const start = match.index + match[0].lastIndexOf(match[2]);
    addStructuredCandidate(candidates, input, match[1], start, start + match[2].length, 175);
  }

  const userInfo = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:([^/@\s]+)@/gi;
  for (const match of input.matchAll(userInfo)) {
    if (match.index === undefined || !match[1] || isAlreadyMasked(match[1])) continue;
    const start = match.index + match[0].lastIndexOf(match[1]);
    candidates.push({
      start,
      end: start + match[1].length,
      replacement: REDACTED,
      redacts: true,
      name: 'URL_PASSWORD',
      type: 'connection-string',
      confidence: 'high',
      priority: 175,
    });
  }
};

const collectProseValues = (input: string, candidates: Candidate[]): void => {
  const prose =
    /\b(client[ _.-]?secret|api[ _.-]?key|access[ _.-]?token|refresh[ _.-]?token|password|passphrase)\s+(?:is|equals?)\s+(["']?)([^\s,"';]{4,})\2/gi;
  for (const match of input.matchAll(prose)) {
    if (match.index === undefined || !match[1] || !match[3]) continue;
    const start = match.index + match[0].lastIndexOf(match[3]);
    addStructuredCandidate(candidates, input, match[1], start, start + match[3].length, 125);
  }
};

const collectLocalizedCredentialValues = (input: string, candidates: Candidate[]): void => {
  const localized =
    /(^|[\r\n])(\s*)(mật\s*(?:khẩu|mã)|mat\s*(?:khau|ma)|mã\s*pin|ma\s*pin)\s*(?::|=|là|la)\s*([^\r\n]{4,})/giu;
  for (const match of input.matchAll(localized)) {
    if (match.index === undefined || !match[3] || !match[4]) continue;
    const start = match.index + match[0].lastIndexOf(match[4]);
    addStructuredCandidate(candidates, input, match[3], start, start + match[4].length, 130);
  }
};

const collectAggressiveValues = (input: string, candidates: Candidate[]): void => {
  const value =
    /(?<![A-Za-z0-9])(?=[A-Za-z0-9+/_=-]{24,}(?![A-Za-z0-9]))(?=[^\s]*[A-Za-z])(?=[^\s]*\d)[A-Za-z0-9+/_=-]{24,}(?![A-Za-z0-9])/g;
  for (const match of input.matchAll(value)) {
    if (match.index === undefined || !match[0] || isAlreadyMasked(match[0])) continue;
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: REDACTED,
      redacts: true,
      name: 'SENSITIVE_VALUE',
      type: 'token',
      confidence: 'medium',
      priority: 80,
    });
  }
};

const collectPemPrivateKeys = (input: string, candidates: Candidate[]): void => {
  const pem = /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH) )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
  for (const match of input.matchAll(pem)) {
    if (match.index === undefined) continue;
    const label = match[1];
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: `-----BEGIN ${label}-----\n${REDACTED}\n-----END ${label}-----`,
      redacts: true,
      name: 'PRIVATE_KEY',
      type: 'pem-private-key',
      confidence: 'high',
      priority: 200,
    });
  }
};

const collectKnownPatterns = (input: string, candidates: Candidate[]): void => {
  for (const definition of KNOWN_PATTERNS) {
    for (const match of input.matchAll(definition.pattern)) {
      if (match.index === undefined) continue;
      const value = definition.valueGroup ? match[definition.valueGroup] : match[0];
      if (!value) continue;
      const offset = definition.valueGroup ? match[0].lastIndexOf(value) : 0;
      candidates.push({
        start: match.index + offset,
        end: match.index + offset + value.length,
        replacement: REDACTED,
        redacts: true,
        name: definition.name,
        type: definition.type,
        confidence: 'high',
        priority: 160,
      });
    }
  }
};

const selectNonOverlapping = (candidates: Candidate[]): Candidate[] => {
  const ordered = candidates.toSorted(
    (left, right) => left.start - right.start || right.priority - left.priority || right.end - left.end
  );
  const selected: Candidate[] = [];
  let cursor = 0;
  for (const candidate of ordered) {
    if (candidate.start < cursor) continue;
    selected.push(candidate);
    cursor = candidate.end;
  }
  return selected;
};

const restoreOriginalCandidateSpans = (candidates: Candidate[], view: ScanView): Candidate[] =>
  candidates.flatMap((candidate) => {
    const start = view.originalIndexes[candidate.start];
    const last = view.originalIndexes[candidate.end - 1];
    return start === undefined || last === undefined ? [] : [{ ...candidate, start, end: last + 1 }];
  });

/**
 * Detect and redact secrets from agent-visible text without retaining plaintext.
 * Metadata contains only a stable field/pattern name, type, and confidence.
 */
const redact = (input: string, aggressive: boolean): SecretFirewallResult => {
  if (!input) return { text: input, findings: [], redacted: false };
  const view = createScanView(input);
  const scanInput = view.text;
  const candidates: Candidate[] = [];
  collectPemPrivateKeys(scanInput, candidates);
  collectQuotedStructuredValues(scanInput, candidates);
  collectLineStructuredValues(scanInput, candidates);
  collectYamlBlockValues(scanInput, candidates);
  collectCliFlagValues(scanInput, candidates);
  collectXmlValues(scanInput, candidates);
  collectConnectionStrings(scanInput, candidates);
  collectUrlCredentials(scanInput, candidates);
  collectProseValues(scanInput, candidates);
  collectLocalizedCredentialValues(scanInput, candidates);
  collectKnownPatterns(scanInput, candidates);
  if (aggressive) collectAggressiveValues(scanInput, candidates);

  const selected = selectNonOverlapping(restoreOriginalCandidateSpans(candidates, view));
  if (selected.length === 0) return { text: input, findings: [], redacted: false };

  let cursor = 0;
  let text = '';
  let redacted = false;
  const findings: SecretFinding[] = [];
  const findingKeys = new Set<string>();
  for (const candidate of selected) {
    text += input.slice(cursor, candidate.start);
    text += candidate.replacement;
    cursor = candidate.end;
    redacted ||= candidate.redacts;
    const findingKey = `${candidate.name}\u0000${candidate.type}\u0000${candidate.confidence}`;
    if (!findingKeys.has(findingKey)) {
      findingKeys.add(findingKey);
      findings.push({ name: candidate.name, type: candidate.type, confidence: candidate.confidence });
    }
  }
  text += input.slice(cursor);
  return { text, findings, redacted };
};

/** Detect high-confidence secret formats at a general agent-visible boundary. */
export const redactSecretText = (input: string): SecretFirewallResult => redact(input, false);

/** Apply additional high-entropy protection for files already classified as secret-bearing. */
export const redactSensitiveText = (input: string): SecretFirewallResult => redact(input, true);
