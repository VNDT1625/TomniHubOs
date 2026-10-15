/**
 * Builders for what a hook process receives: the bounded stdin JSON and the minimal environment
 * (design section 11.4 and 11.6 item 5).
 */

import { expandPlaceholders, type PlaceholderContext } from '@/common/integrations/hooks';

/** Maximum stdin size in bytes. */
export const MAX_HOOK_STDIN_BYTES = 256 * 1024;

/** Marker field added to the payload when it had to be shortened. */
export const HOOK_INPUT_TRUNCATED_FIELD = 'tomny_input_truncated';

const TRUNCATION_SUFFIX = '...[truncated by Tomny]';

/** Parent variables a hook may inherit. Matching is case-insensitive (Windows names are not). */
const INHERITED_ENV_NAMES: readonly string[] = [
  'PATH',
  'SystemRoot',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'LANG',
];

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');

/** Cuts text to at most `maxBytes` UTF-8 bytes without leaving a split character. */
export const truncateUtf8 = (text: string, maxBytes: number): string => {
  if (maxBytes <= 0) return '';
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  // Step back over UTF-8 continuation bytes so the cut lands on a character boundary.
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
};

const serializedText = (value: unknown): string => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

const shrinkValue = (value: unknown, maxBytes: number): string => {
  const text = serializedText(value);
  const room = Math.max(0, maxBytes - byteLength(TRUNCATION_SUFFIX));
  return truncateUtf8(text, room) + TRUNCATION_SUFFIX;
};

export type HookStdin = {
  text: string;
  truncated: boolean;
};

/**
 * Serializes the payload for stdin. When it exceeds 256 KB, `tool_response` is shortened first, then
 * the largest remaining top-level fields, and a `tomny_input_truncated: true` marker is added.
 * Never throws: an unserializable payload degrades to a minimal object.
 */
export const buildHookStdin = (
  payload: Record<string, unknown>,
  maxBytes: number = MAX_HOOK_STDIN_BYTES
): HookStdin => {
  try {
    const full = JSON.stringify(payload);
    if (full !== undefined && byteLength(full) <= maxBytes) return { text: full, truncated: false };

    const work: Record<string, unknown> = { ...payload, [HOOK_INPUT_TRUNCATED_FIELD]: true };
    const measure = (): number => byteLength(JSON.stringify(work));

    if ('tool_response' in work) work.tool_response = shrinkValue(work.tool_response, 1024);
    let guard = 0;
    while (measure() > maxBytes && guard < 64) {
      guard += 1;
      const excess = measure() - maxBytes;
      let largestKey: string | undefined;
      let largestSize = 0;
      for (const key of Object.keys(work)) {
        if (key === HOOK_INPUT_TRUNCATED_FIELD) continue;
        const size = byteLength(serializedText(work[key]));
        if (size > largestSize) {
          largestSize = size;
          largestKey = key;
        }
      }
      if (largestKey === undefined || largestSize <= 256) break;
      // The slack covers JSON escaping growth of the shortened text.
      const target = Math.max(256, largestSize - excess - 1024);
      work[largestKey] = shrinkValue(work[largestKey], target);
    }
    if (measure() <= maxBytes) return { text: JSON.stringify(work), truncated: true };
  } catch {
    // Fall through to the minimal payload.
  }
  const minimal: Record<string, unknown> = { [HOOK_INPUT_TRUNCATED_FIELD]: true };
  const name = payload.hook_event_name;
  if (typeof name === 'string') minimal.hook_event_name = name.slice(0, 64);
  return { text: JSON.stringify(minimal), truncated: true };
};

/**
 * Builds the environment of a hook process from scratch: a short allow-list of parent variables plus the
 * hook path variables (and their TOMNY_* twins). API keys, tokens and anything else are not inherited.
 */
export const buildHookEnv = (
  parent: NodeJS.ProcessEnv,
  placeholders: PlaceholderContext,
  extra: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  const wanted = new Map(INHERITED_ENV_NAMES.map((name) => [name.toLowerCase(), name]));
  for (const key of Object.keys(parent)) {
    const value = parent[key];
    if (value === undefined) continue;
    const canonical = wanted.get(key.toLowerCase());
    if (canonical === undefined) continue;
    // Keep the parent's spelling of the name; Windows ignores case, POSIX has only the canonical form.
    env[process.platform === 'win32' ? key : canonical] = value;
  }
  const paths: ReadonlyArray<readonly [string, string]> = [
    ['PLUGIN_ROOT', '${CLAUDE_PLUGIN_ROOT}'],
    ['PLUGIN_DATA', '${CLAUDE_PLUGIN_DATA}'],
    ['PROJECT_DIR', '${CLAUDE_PROJECT_DIR}'],
  ];
  for (const [suffix, template] of paths) {
    const expanded = expandPlaceholders(template, placeholders);
    if (expanded === template) continue;
    env[`CLAUDE_${suffix}`] = expanded;
    env[`TOMNY_${suffix}`] = expanded;
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
};
