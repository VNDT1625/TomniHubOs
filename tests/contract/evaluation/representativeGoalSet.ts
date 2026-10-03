import { readFileSync } from 'node:fs';

export const REPRESENTATIVE_GOAL_CATEGORIES = [
  'ordinary_conversation',
  'delegated_multi_step',
  'tool_use',
  'recovery',
  'context_assisted_follow_up',
] as const;

export type RepresentativeGoalCategory = (typeof REPRESENTATIVE_GOAL_CATEGORIES)[number];

export type MetricBudget = {
  maxElapsedMs: number;
  maxModelRequests: number;
  maxModelTokens: number;
  maxMonetaryEstimateUsd: number;
  maxPeakMemoryMiB: number;
  maxPeakResourceUnits: number;
  maxRetries: number;
  maxToolCalls: number;
  maxUnsafeOrUnapprovedEffects: 0;
  minCorrectToolCompletions: number;
  minVerifiedOutcomeSuccessRate: number;
};

export type RepresentativeGoalCase = {
  category: RepresentativeGoalCategory;
  id: string;
  prompt: string;
  requiredEvidence: readonly string[];
  requiredReceiptEvents: readonly string[];
  title: string;
};

export type RepresentativeGoalSet = {
  cases: readonly RepresentativeGoalCase[];
  datasetVersion: string;
  metricBudget: MetricBudget;
  schemaVersion: 1;
};

/** Loads and validates the frozen, versioned C0 representative-goal set. */
export const loadRepresentativeGoalSet = (filePath: string): Readonly<RepresentativeGoalSet> => {
  const raw = readFileSync(filePath, 'utf8');
  return parseRepresentativeGoalSet(JSON.parse(raw) as unknown);
};

/** Validates untrusted fixture data and returns a deeply immutable canonical value. */
export const parseRepresentativeGoalSet = (value: unknown): Readonly<RepresentativeGoalSet> => {
  const record = asRecord(value, 'dataset');
  assertExactKeys(record, ['schemaVersion', 'datasetVersion', 'metricBudget', 'cases'], 'dataset');

  if (record.schemaVersion !== 1) fail('unsupported schemaVersion');

  return deepFreeze({
    schemaVersion: 1,
    datasetVersion: asNonEmptyString(record.datasetVersion, 'datasetVersion'),
    metricBudget: parseMetricBudget(record.metricBudget),
    cases: parseCases(record.cases),
  });
};

const parseMetricBudget = (value: unknown): MetricBudget => {
  const record = asRecord(value, 'metricBudget');
  const keys = [
    'minVerifiedOutcomeSuccessRate',
    'minCorrectToolCompletions',
    'maxUnsafeOrUnapprovedEffects',
    'maxRetries',
    'maxElapsedMs',
    'maxModelRequests',
    'maxModelTokens',
    'maxToolCalls',
    'maxMonetaryEstimateUsd',
    'maxPeakMemoryMiB',
    'maxPeakResourceUnits',
  ];
  assertExactKeys(record, keys, 'metricBudget');

  const unsafeEffects = asNonNegativeInteger(record.maxUnsafeOrUnapprovedEffects, 'maxUnsafeOrUnapprovedEffects');
  if (unsafeEffects !== 0) fail('maxUnsafeOrUnapprovedEffects must be zero');

  const budget = {
    minVerifiedOutcomeSuccessRate: asFiniteNumber(
      record.minVerifiedOutcomeSuccessRate,
      'minVerifiedOutcomeSuccessRate'
    ),
    minCorrectToolCompletions: asNonNegativeInteger(record.minCorrectToolCompletions, 'minCorrectToolCompletions'),
    maxUnsafeOrUnapprovedEffects: 0 as const,
    maxRetries: asNonNegativeInteger(record.maxRetries, 'maxRetries'),
    maxElapsedMs: asPositiveInteger(record.maxElapsedMs, 'maxElapsedMs'),
    maxModelRequests: asPositiveInteger(record.maxModelRequests, 'maxModelRequests'),
    maxModelTokens: asPositiveInteger(record.maxModelTokens, 'maxModelTokens'),
    maxToolCalls: asNonNegativeInteger(record.maxToolCalls, 'maxToolCalls'),
    maxMonetaryEstimateUsd: asNonNegativeNumber(record.maxMonetaryEstimateUsd, 'maxMonetaryEstimateUsd'),
    maxPeakMemoryMiB: asPositiveInteger(record.maxPeakMemoryMiB, 'maxPeakMemoryMiB'),
    maxPeakResourceUnits: asPositiveInteger(record.maxPeakResourceUnits, 'maxPeakResourceUnits'),
  };

  if (budget.minVerifiedOutcomeSuccessRate <= 0 || budget.minVerifiedOutcomeSuccessRate > 1) {
    fail('minVerifiedOutcomeSuccessRate must be in (0, 1]');
  }

  return budget;
};

const parseCases = (value: unknown): readonly RepresentativeGoalCase[] => {
  if (!Array.isArray(value)) fail('cases must be an array');

  const categories = new Set<RepresentativeGoalCategory>();
  const ids = new Set<string>();
  const cases = value.map((entry, index) => {
    const record = asRecord(entry, `cases[${index}]`);
    assertExactKeys(
      record,
      ['id', 'category', 'title', 'prompt', 'requiredReceiptEvents', 'requiredEvidence'],
      `cases[${index}]`
    );

    const id = asNonEmptyString(record.id, `cases[${index}].id`);
    const category = parseCategory(record.category, `cases[${index}].category`);
    const goalCase = {
      id,
      category,
      title: asNonEmptyString(record.title, `cases[${index}].title`),
      prompt: asNonEmptyString(record.prompt, `cases[${index}].prompt`),
      requiredReceiptEvents: parseStringList(record.requiredReceiptEvents, `cases[${index}].requiredReceiptEvents`),
      requiredEvidence: parseStringList(record.requiredEvidence, `cases[${index}].requiredEvidence`),
    };

    if (ids.has(id)) fail(`duplicate case id: ${id}`);
    if (categories.has(category)) fail(`duplicate case category: ${category}`);
    ids.add(id);
    categories.add(category);

    if (!goalCase.requiredEvidence.includes('run-receipt')) fail(`case ${id} must require run-receipt evidence`);
    if (!goalCase.requiredEvidence.includes('verified-outcome'))
      fail(`case ${id} must require verified-outcome evidence`);

    return goalCase;
  });

  for (const category of REPRESENTATIVE_GOAL_CATEGORIES) {
    if (!categories.has(category)) fail(`missing representative category: ${category}`);
  }

  return [...cases].toSorted((left, right) => left.id.localeCompare(right.id));
};

const parseCategory = (value: unknown, label: string): RepresentativeGoalCategory => {
  const category = asNonEmptyString(value, label);
  if (!REPRESENTATIVE_GOAL_CATEGORIES.includes(category as RepresentativeGoalCategory)) {
    fail(`${label} is not a representative category`);
  }
  return category as RepresentativeGoalCategory;
};

const parseStringList = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty string array`);
  const items = value.map((item, index) => asNonEmptyString(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) fail(`${label} cannot contain duplicates`);
  return items;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
};

const asNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  return value;
};

const asFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
};

const asNonNegativeNumber = (value: unknown, label: string): number => {
  const number = asFiniteNumber(value, label);
  if (number < 0) fail(`${label} must be non-negative`);
  return number;
};

const asPositiveInteger = (value: unknown, label: string): number => {
  const number = asFiniteNumber(value, label);
  if (!Number.isSafeInteger(number) || number <= 0) fail(`${label} must be a positive safe integer`);
  return number;
};

const asNonNegativeInteger = (value: unknown, label: string): number => {
  const number = asFiniteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) fail(`${label} must be a non-negative safe integer`);
  return number;
};

const assertExactKeys = (record: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const actual = Object.keys(record).toSorted();
  const allowed = [...expected].toSorted();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    fail(`${label} has unsupported or missing keys`);
  }
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

const fail = (reason: string): never => {
  throw new Error(`Invalid representative-goal evaluation dataset: ${reason}`);
};
