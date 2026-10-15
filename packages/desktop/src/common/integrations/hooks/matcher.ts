/**
 * Matcher evaluation (repotopackage design section 11.2, Claude Code "Matcher patterns").
 * Pure and bounded: user-supplied regular expressions are untrusted input.
 */

/** Longest matcher pattern accepted (characters). */
export const MAX_MATCHER_LENGTH = 300;

/** Longest subject string compared (characters); the rest is cut. */
export const MAX_MATCH_SUBJECT_LENGTH = 1000;

/** Why a matcher was refused, when it was. */
export type MatcherFlag = 'pattern-too-long' | 'invalid-pattern' | 'unsafe-pattern';

/** Matcher evaluation outcome. `flag` is set only when the matcher itself was rejected (never matches). */
export type MatcherResult = { matched: boolean; flag?: MatcherFlag };

const EXACT_LIST_PATTERN = /^[A-Za-z0-9_\- ,|]+$/;

/** Match-all matchers: missing, empty (or whitespace-only) and `*`. */
const isMatchAll = (matcher: string | undefined): boolean => {
  if (matcher === undefined) return true;
  const trimmed = matcher.trim();
  return trimmed === '' || trimmed === '*';
};

/** Reads a quantifier at index `i`. `open` means it can repeat without a fixed count. */
const quantifierAt = (src: string, i: number): { open: boolean; length: number } | null => {
  const ch = src[i];
  if (ch === '*' || ch === '+') return { open: true, length: 1 };
  if (ch === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i, i + 24));
    if (!m) return null;
    // {n} is a fixed count; {n,} and {n,m} can repeat ambiguously.
    return { open: m[2] !== undefined, length: m[0].length };
  }
  return null;
};

/**
 * Cheap structural check for nested repetition such as `(a+)+`, `(a*)*`, `(.*){2,}`.
 * A group that contains an unbounded or ranged quantifier and is itself quantified is refused.
 * This is a heuristic, not a proof: overlapping alternation like `(a|aa)+` is not detected;
 * the 1000-character subject cut bounds the remaining risk.
 */
export const hasNestedRepetition = (pattern: string): boolean => {
  const stack: boolean[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      stack.push(false);
      continue;
    }
    if (ch === ')') {
      const innerRepeats = stack.pop() ?? false;
      const outer = quantifierAt(pattern, i + 1);
      if (outer && outer.open) {
        if (innerRepeats) return true;
        if (stack.length > 0) stack[stack.length - 1] = true;
      } else if (innerRepeats && stack.length > 0) {
        stack[stack.length - 1] = true;
      }
      continue;
    }
    const q = quantifierAt(pattern, i);
    if (q) {
      if (q.open && stack.length > 0) stack[stack.length - 1] = true;
      i += q.length - 1;
    }
  }
  return false;
};

/**
 * Evaluates a matcher against a name and reports why a matcher was refused.
 * Never throws. Rejected matchers never match.
 */
export const evaluateMatcher = (matcher: string | undefined, name: string): MatcherResult => {
  if (matcher === undefined || isMatchAll(matcher)) return { matched: true };
  if (matcher.length > MAX_MATCHER_LENGTH) return { matched: false, flag: 'pattern-too-long' };
  const subject = name.length > MAX_MATCH_SUBJECT_LENGTH ? name.slice(0, MAX_MATCH_SUBJECT_LENGTH) : name;

  if (EXACT_LIST_PATTERN.test(matcher)) {
    const names = matcher
      .split(/[|,]/)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    return { matched: names.includes(subject) };
  }

  if (hasNestedRepetition(matcher)) return { matched: false, flag: 'unsafe-pattern' };
  let re: RegExp;
  try {
    re = new RegExp(matcher);
  } catch {
    return { matched: false, flag: 'invalid-pattern' };
  }
  return { matched: re.test(subject) };
};

/** True when the matcher selects `name`. Unsafe, oversized or invalid patterns never match. */
export const matchesTool = (matcher: string | undefined, name: string): boolean =>
  evaluateMatcher(matcher, name).matched;
