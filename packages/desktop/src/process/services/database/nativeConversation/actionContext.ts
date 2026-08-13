/**
 * Compact, restart-resilient evidence collected during one bounded action.
 *
 * This module is deliberately pure. The conversation service owns the
 * lifecycle; this file only normalizes tool input, extracts useful references
 * from tool output, and renders a bounded Save capsule.
 */

export type ActionEvidenceLedger = {
  queries: string[];
  files: string[];
  symbols: string[];
  evidence: string[];
};

const MAX_ITEMS = 24;
const MAX_EVIDENCE_LINES = 18;
const MAX_LINE_CHARS = 260;

export const emptyActionEvidence = (): ActionEvidenceLedger => ({
  queries: [],
  files: [],
  symbols: [],
  evidence: [],
});

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

const addUnique = (items: string[], value: unknown, limit = MAX_ITEMS): void => {
  if (typeof value !== 'string') return;
  const normalized = clean(value);
  const key = normalized.toLocaleLowerCase();
  if (!normalized || items.some((item) => item.toLocaleLowerCase() === key) || items.length >= limit) return;
  items.push(normalized);
};

const stringValues = (input: unknown): string[] => {
  if (!input || typeof input !== 'object') return [];
  const record = input as Record<string, unknown>;
  return Object.values(record).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
  );
};

/** Stable query text used both for Save and for diagnostics. */
export const actionQueryText = (tool: string, input: unknown): string | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const intent = typeof record.intent === 'string' ? record.intent : undefined;
  const target =
    typeof record.target === 'string'
      ? record.target
      : typeof record.targetFile === 'string'
        ? record.targetFile
        : undefined;
  if (tool === 'ide_research' && (intent || target)) {
    return clean([intent, target ? `target=${target}` : undefined].filter(Boolean).join(' | '));
  }
  const query = typeof record.query === 'string' ? record.query : undefined;
  return query ? clean(query) : undefined;
};

const filePattern =
  /(?:^|[`"'\s([])((?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|json|md|css|scss|sql|toml|yaml|yml))(?:[`"'\s):\],]|$)/gi;

const collectFiles = (text: string, ledger: ActionEvidenceLedger): void => {
  for (const match of text.matchAll(filePattern)) addUnique(ledger.files, match[1]);
};

const collectSymbols = (text: string, ledger: ActionEvidenceLedger): void => {
  for (const match of text.matchAll(
    /\b(?:symbol|symbols|symbol\/role|function|class)\s*[:=]\s*[`']?([A-Za-z_$][\w$]*(?:(?:::|\.)[A-Za-z_$][\w$]*)?)/gi
  )) {
    addUnique(ledger.symbols, match[1]);
  }
};

const collectEvidence = (text: string, ledger: ActionEvidenceLedger): void => {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const relevant = lines.filter((line) =>
    /(?:^#{1,4}\s|\b(?:evidence|status|finding|verified|risk|error|candidate|flow|mapped)\b|\.(?:ts|tsx|js|jsx|rs|json)\b)/i.test(
      line
    )
  );
  // Do not persist arbitrary tool output when it has no evidence markers.
  // This is the boundary that keeps raw transcripts out of Save.
  for (const line of relevant.slice(0, MAX_EVIDENCE_LINES)) {
    addUnique(ledger.evidence, line.slice(0, MAX_LINE_CHARS), MAX_EVIDENCE_LINES);
  }
};

/** Merge input and bounded tool output into the action ledger. */
export const recordActionEvidence = (
  ledger: ActionEvidenceLedger,
  tool: string,
  input: unknown,
  output?: string
): void => {
  addUnique(ledger.queries, actionQueryText(tool, input));
  if (input && typeof input === 'object') {
    const symbols = (input as Record<string, unknown>).symbols;
    if (Array.isArray(symbols)) {
      for (const symbol of symbols) addUnique(ledger.symbols, symbol);
    }
  }
  for (const value of stringValues(input)) {
    if (value.includes('/') || value.includes('\\')) collectFiles(value, ledger);
  }
  if (typeof output === 'string') {
    collectFiles(output, ledger);
    collectSymbols(output, ledger);
    collectEvidence(output, ledger);
  }
};

/** Render a compact capsule; raw tool output is intentionally never persisted. */
export const renderActionEvidence = (ledger: ActionEvidenceLedger): string[] => [
  `Queries: ${ledger.queries.length > 0 ? ledger.queries.join(' || ') : 'none'}`,
  `Files: ${ledger.files.length > 0 ? ledger.files.join(', ') : 'none'}`,
  `Symbols: ${ledger.symbols.length > 0 ? ledger.symbols.join(', ') : 'none'}`,
  `Evidence: ${ledger.evidence.length > 0 ? ledger.evidence.map((line) => `- ${line}`).join('\n') : 'none'}`,
];
