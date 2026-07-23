/**
 * Deterministic work-state controller for evidence-driven debugging.
 *
 * The controller is intentionally model-free: it advances only from explicit
 * research and verification events, so repeated reasoning/tool calls never
 * count as failed fix attempts by themselves.
 */

export type WorkKind = 'bug_fix' | 'feature' | 'refactor' | 'investigation' | 'test' | 'architecture' | 'general';

export type DebugRecoveryMode = 'direct' | 'reassess' | 'online-search' | 'backtrack' | 'deep-debug' | 'complete';

export type VerificationProgress = 'none' | 'partial' | 'regressed' | 'resolved' | 'unknown';

export type VerificationSignal = {
  identity: string;
  phase: 'reproduce' | 'post-fix' | 'regression' | 'runtime' | 'command';
  outcome: 'passed' | 'failed' | 'inconclusive';
  fingerprint?: string;
  progress?: VerificationProgress;
  summary?: string;
};

export type WorkAttempt = {
  identity: string;
  fingerprint: string;
  outcome: 'baseline' | 'passed' | 'improved' | 'unchanged' | 'regressed' | 'inconclusive';
  summary?: string;
};

export type WorkStatus = {
  key: string;
  kind: WorkKind;
  mode: DebugRecoveryMode;
  forcedDeepDebug: boolean;
  attemptCount: number;
  stagnationTicks: number;
  regressionTicks: number;
  onlineSearchAttempts: number;
  onlineSearchFailures: number;
  baselineByIdentity: Record<string, string>;
  lastFailureFingerprint?: string;
  attempts: WorkAttempt[];
};

export type WorkStatusController = {
  start: (key: string, input: { intent: string; kind?: WorkKind; forcedDeepDebug?: boolean }) => WorkStatus;
  observe: (key: string, signal: VerificationSignal) => WorkStatus;
  get: (key: string) => WorkStatus | undefined;
  reset: (key: string) => void;
};

const MAX_ATTEMPTS = 12;
const REASSESS_TICKS = 1;
const ONLINE_SEARCH_TICKS = 2;
const MAX_ONLINE_SEARCH_FAILURES = 2;

const normalize = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':uuid')
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:[\d:.+-]+z?\b/gi, ':timestamp')
    .replace(/(?<=\/)\d+(?=\/|\b)/g, ':id')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

/** Stable, bounded failure signature suitable for comparing verification runs. */
export const createFailureFingerprint = (...parts: Array<string | undefined>): string =>
  normalize(parts.filter((part): part is string => Boolean(part?.trim())).join(' | ')).slice(0, 1_200) || 'unknown';

/** Detect the explicit user override without treating arbitrary slash commands as Deep Debug. */
export const isDeepDebugRequest = (value: string): boolean => /^\s*\/deep-debug(?:\s|$)/iu.test(value);

/** Remove the command token while preserving the user's actual symptom. */
export const deepDebugTask = (value: string): string => value.replace(/^\s*\/deep-debug(?:\s+|$)/iu, '').trim();

/** Classify an action once; later verification never changes its category. */
export const classifyWorkKind = (intent: string): WorkKind => {
  const value = intent.toLocaleLowerCase();
  if (
    /\b(bug|debug|crash|error|exception|fail(?:ed|ing)?|regression|broken|incorrect)\b|(?:sửa|fix)\s*lỗi|\b(lỗi|hỏng|sai|treo)\b/u.test(
      value
    )
  ) {
    return 'bug_fix';
  }
  if (/\b(refactor|restructure|cleanup|reorganize)\b|tái cấu trúc/u.test(value)) return 'refactor';
  if (/\b(feature|implement|add|build|create)\b|\b(thêm|xây dựng|tạo)\b/u.test(value)) return 'feature';
  if (/\b(test|verify|coverage|benchmark)\b|\b(kiểm thử|kiểm chứng)\b/u.test(value)) return 'test';
  if (/\b(architecture|design|module boundary)\b|\b(kiến trúc|thiết kế)\b/u.test(value)) return 'architecture';
  if (/\b(investigate|research|inspect|trace|understand)\b|\b(điều tra|tìm hiểu|truy vết)\b/u.test(value)) {
    return 'investigation';
  }
  return 'general';
};

const copyStatus = (status: WorkStatus): WorkStatus => structuredClone(status);

const recoveryMode = (status: WorkStatus): DebugRecoveryMode => {
  if (status.forcedDeepDebug) return 'deep-debug';
  if (status.mode === 'complete') return 'complete';
  if (status.onlineSearchFailures >= MAX_ONLINE_SEARCH_FAILURES) return 'backtrack';
  if (status.stagnationTicks >= ONLINE_SEARCH_TICKS) return 'online-search';
  if (status.stagnationTicks >= REASSESS_TICKS) return 'reassess';
  return 'direct';
};

const appendAttempt = (status: WorkStatus, attempt: WorkAttempt): void => {
  status.attempts.push(attempt);
  if (status.attempts.length > MAX_ATTEMPTS) status.attempts.splice(0, status.attempts.length - MAX_ATTEMPTS);
};

/** Create an isolated controller. One IDE MCP server owns one instance. */
export const createWorkStatusController = (): WorkStatusController => {
  const statuses = new Map<string, WorkStatus>();

  const start: WorkStatusController['start'] = (key, input) => {
    const normalizedKey = key.trim();
    const forcedDeepDebug = Boolean(input.forcedDeepDebug || isDeepDebugRequest(input.intent));
    const kind = input.kind ?? (forcedDeepDebug ? 'bug_fix' : classifyWorkKind(input.intent));
    const current = statuses.get(normalizedKey);
    if (current && current.kind === kind && current.mode !== 'complete') {
      current.forcedDeepDebug ||= forcedDeepDebug;
      current.mode = recoveryMode(current);
      return copyStatus(current);
    }
    const created: WorkStatus = {
      key: normalizedKey,
      kind,
      mode: forcedDeepDebug ? 'deep-debug' : 'direct',
      forcedDeepDebug,
      attemptCount: 0,
      stagnationTicks: 0,
      regressionTicks: 0,
      onlineSearchAttempts: 0,
      onlineSearchFailures: 0,
      baselineByIdentity: {},
      attempts: [],
    };
    statuses.set(normalizedKey, created);
    return copyStatus(created);
  };

  const observe: WorkStatusController['observe'] = (key, signal) => {
    const normalizedKey = key.trim();
    const status = statuses.get(normalizedKey) ?? start(normalizedKey, { intent: 'debug failure', kind: 'bug_fix' });
    const live = statuses.get(normalizedKey) ?? status;
    const identity = normalize(signal.identity) || 'verification';
    const fingerprint = signal.fingerprint
      ? createFailureFingerprint(signal.fingerprint)
      : createFailureFingerprint(signal.summary, identity);

    if (signal.outcome === 'inconclusive') {
      appendAttempt(live, { identity, fingerprint, outcome: 'inconclusive', summary: signal.summary });
      return copyStatus(live);
    }

    if (signal.phase === 'reproduce' && signal.outcome === 'failed') {
      live.baselineByIdentity[identity] = fingerprint;
      live.lastFailureFingerprint = fingerprint;
      appendAttempt(live, { identity, fingerprint, outcome: 'baseline', summary: signal.summary });
      live.mode = recoveryMode(live);
      return copyStatus(live);
    }

    if (signal.outcome === 'passed') {
      appendAttempt(live, { identity, fingerprint, outcome: 'passed', summary: signal.summary });
      if (live.baselineByIdentity[identity] || signal.phase === 'post-fix' || signal.phase === 'regression') {
        delete live.baselineByIdentity[identity];
        live.stagnationTicks = 0;
        live.onlineSearchFailures = 0;
        live.lastFailureFingerprint = undefined;
        live.mode = 'complete';
      }
      return copyStatus(live);
    }

    const wasOnlineSearch = live.mode === 'online-search';
    live.attemptCount += 1;
    const priorFailure = live.lastFailureFingerprint ?? live.baselineByIdentity[identity];
    live.lastFailureFingerprint = fingerprint;
    if (signal.progress === 'partial') {
      live.stagnationTicks = Math.max(0, live.stagnationTicks - 1);
      appendAttempt(live, { identity, fingerprint, outcome: 'improved', summary: signal.summary });
    } else if (signal.progress === 'regressed') {
      live.stagnationTicks += 1;
      live.regressionTicks += 1;
      appendAttempt(live, { identity, fingerprint, outcome: 'regressed', summary: signal.summary });
    } else if (signal.progress === 'none' || priorFailure === fingerprint) {
      live.stagnationTicks += 1;
      appendAttempt(live, { identity, fingerprint, outcome: 'unchanged', summary: signal.summary });
    } else {
      // A new failure shape is evidence, but not proof that the agent is stuck.
      // Wait for the same signature to repeat or for an explicit regression
      // signal before escalating the recovery mode.
      appendAttempt(live, { identity, fingerprint, outcome: 'inconclusive', summary: signal.summary });
    }
    if (wasOnlineSearch) {
      live.onlineSearchAttempts += 1;
      live.onlineSearchFailures += 1;
    }
    live.mode = recoveryMode(live);
    return copyStatus(live);
  };

  return {
    start,
    observe,
    get: (key) => {
      const status = statuses.get(key.trim());
      return status ? copyStatus(status) : undefined;
    },
    reset: (key) => statuses.delete(key.trim()),
  };
};

/** Compact dynamic context; emitted only when debugging is active. */
export const renderWorkStatus = (status: WorkStatus): string => {
  const lines = [
    '## WorkStatus',
    `Kind: ${status.kind}`,
    `Mode: ${status.mode}`,
    `Attempts: ${status.attemptCount} · stagnation: ${status.stagnationTicks} · regressions: ${status.regressionTicks} · online trials: ${status.onlineSearchAttempts}`,
  ];
  if (status.mode === 'reassess') {
    lines.push('Recovery: stop extending the current patch; restate expected/actual and run one discriminating test.');
  }
  if (status.mode === 'online-search') {
    lines.push(
      'Online experience required before multi-hypothesis recovery:',
      '1. Search current official docs, source issues and release notes; use forums only as candidate experience.',
      '2. Choose one result matching the verified symptom, versions and boundary; do not paste or expose repository source.',
      '3. Predict its observable effect, apply only the smallest supported change, then rerun the identical reproduction.',
      '4. If no credible result exists, rerun the unchanged reproduction as a no-change control for this online trial.',
      `5. Try at most ${MAX_ONLINE_SEARCH_FAILURES} distinct online candidates; repeated failed verification triggers backtracking.`
    );
  }
  if (status.mode === 'backtrack' || status.mode === 'deep-debug') {
    lines.push(
      'Recovery required:',
      '1. Keep at most three independent hypotheses across different boundaries.',
      '2. Record evidence for/against each and choose the cheapest discriminating test.',
      '3. Treat failed fixes as negative evidence; rollback unproven changes before another same-layer patch.',
      '4. Predict the observable result and regression risk before editing.',
      '5. Verify with the identical reproduction; use Quick Test replay/compare for runtime bugs.'
    );
  }
  return lines.join('\n');
};
