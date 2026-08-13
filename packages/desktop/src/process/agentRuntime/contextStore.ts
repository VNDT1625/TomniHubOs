import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AgentContext,
  ContextDocument,
  ContextFact,
  PersonalLearningRecord,
  PersonalContext,
  PersonalSecretReference,
  SecretDescriptor,
  StructuredPersonalProfile,
} from './contextTypes';

const EMPTY_DOCUMENT: ContextDocument = { version: 1, agents: [], people: [] };
export type PersonalFactCollection = 'facts' | 'preferences' | 'habits';
export type ContextStoreFs = {
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  writeFile(filePath: string, data: string, options: { encoding: 'utf-8'; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(dirPath: string, options: { recursive: true }): Promise<string | undefined>;
};
export type ContextStore = {
  getAgent(id: string): Promise<AgentContext | undefined>;
  getPersonal(id: string): Promise<PersonalContext | undefined>;
  upsertAgent(value: AgentContext): Promise<void>;
  upsertPersonal(value: PersonalContext): Promise<void>;
  learnPersonalFact(personalId: string, collection: PersonalFactCollection, fact: ContextFact): Promise<boolean>;
  exportDocument?: () => Promise<ContextDocument>;
  replaceDocument?: (document: ContextDocument) => Promise<void>;
};

const nodeFs: ContextStoreFs = {
  readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
  writeFile: (filePath, data, options) => fs.promises.writeFile(filePath, data, options),
  rename: (from, to) => fs.promises.rename(from, to),
  mkdir: (dirPath, options) => fs.promises.mkdir(dirPath, options),
};
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
const clone = <T>(value: T): T | undefined => (value === undefined ? undefined : structuredClone(value));

const CORE_SECRET_CONTEXT_CAPABILITY = 'core.secret-context';

export const personalSecretReferenceFromDescriptor = (descriptor: SecretDescriptor): PersonalSecretReference => ({
  key: descriptor.label,
  handle: descriptor.handle,
  capability: CORE_SECRET_CONTEXT_CAPABILITY,
  surfaces: [...descriptor.binding.surfaces],
  purposes: [...descriptor.binding.purposes],
  fields: [...descriptor.fields],
  description: descriptor.note || descriptor.label,
});

/** Restore Core-owned references from authoritative encrypted-vault metadata after startup. */
export const reconcilePersonalSecretReferences = (
  profile: PersonalContext,
  descriptors: SecretDescriptor[]
): PersonalContext => {
  // An absent/empty vault is not proof that the encrypted records were
  // intentionally removed (it can be a first boot, a migration, or a vault
  // read failure). Preserve existing opaque references rather than deleting
  // them and causing another irreversible context loss.
  if (descriptors.length === 0) return structuredClone(profile);
  return {
    ...profile,
    secretReferences: [
      ...profile.secretReferences.filter((item) => item.capability !== CORE_SECRET_CONTEXT_CAPABILITY),
      ...descriptors.map(personalSecretReferenceFromDescriptor),
    ],
  };
};

export type PersonalContextMutationStore = Pick<ContextStore, 'getPersonal' | 'upsertPersonal'>;
export type PersonalContextMutationCoordinator = {
  saveProfile(profile: PersonalContext): Promise<PersonalContext>;
  bindSecret(descriptor: SecretDescriptor): Promise<void>;
  removeSecretReference(handle: string): Promise<void>;
};

/**
 * Serialize every Personal Context read-modify-write so editable profile data
 * and Core-owned opaque secret references cannot overwrite one another.
 */
export const createPersonalContextMutationCoordinator = (
  store: PersonalContextMutationStore,
  options: { personalId?: string; now?: () => number } = {}
): PersonalContextMutationCoordinator => {
  const personalId = options.personalId ?? 'default';
  const now = options.now ?? Date.now;
  let mutation = Promise.resolve();

  const getLatestProfile = async (): Promise<PersonalContext> => {
    const profile = await store.getPersonal(personalId);
    if (!profile) throw new Error(`Personal context not found: ${personalId}`);
    return profile;
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation, operation);
    mutation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };
  const persist = async (profile: PersonalContext): Promise<PersonalContext> => {
    await store.upsertPersonal(profile);
    return getLatestProfile();
  };

  return {
    saveProfile: (profile) =>
      enqueue(async () => {
        const current = await getLatestProfile();
        return persist({
          ...profile,
          id: personalId,
          // Renderer-owned profile fields may change, but opaque bindings remain Core-owned.
          secretReferences: current.secretReferences,
          updatedAt: now(),
        });
      }),
    bindSecret: (descriptor) =>
      enqueue(async () => {
        const current = await getLatestProfile();
        await persist({
          ...current,
          secretReferences: [
            ...current.secretReferences.filter((item) => item.handle !== descriptor.handle),
            personalSecretReferenceFromDescriptor(descriptor),
          ],
          updatedAt: now(),
        });
      }),
    removeSecretReference: (handle) =>
      enqueue(async () => {
        const current = await getLatestProfile();
        if (!current.secretReferences.some((item) => item.handle === handle)) return;
        await persist({
          ...current,
          secretReferences: current.secretReferences.filter((item) => item.handle !== handle),
          updatedAt: now(),
        });
      }),
  };
};

export type PersonalLearningCoordinator = {
  propose(input: Omit<PersonalLearningRecord, 'id' | 'status' | 'createdAt'>): Promise<PersonalLearningRecord>;
  confirm(recordId: string): Promise<boolean>;
  reject(recordId: string): Promise<boolean>;
  correct(recordId: string, fact: ContextFact, explanation: string): Promise<boolean>;
  forget(recordId: string): Promise<boolean>;
  recordOutcome(recordId: string, outcome: 'helpful' | 'not_helpful'): Promise<boolean>;
};

/** Consent gate for personal context: proposed observations never enter projections until confirmed. */
export const createPersonalLearningCoordinator = (
  store: PersonalContextMutationStore,
  options: { personalId?: string; now?: () => number; createId?: () => string } = {}
): PersonalLearningCoordinator => {
  const personalId = options.personalId ?? 'default';
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  let queue = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };
  const update = async (
    recordId: string,
    operation: (profile: PersonalContext, record: PersonalLearningRecord) => PersonalContext
  ): Promise<boolean> => {
    const profile = await store.getPersonal(personalId);
    if (!profile) throw new Error(`Personal context not found: ${personalId}`);
    const record = profile.learningRecords?.find((item) => item.id === recordId);
    if (!record) return false;
    await store.upsertPersonal(operation(profile, record));
    return true;
  };
  return {
    propose: (input) =>
      mutate(async () => {
        const profile = await store.getPersonal(personalId);
        if (!profile) throw new Error(`Personal context not found: ${personalId}`);
        const record: PersonalLearningRecord = { ...input, id: createId(), status: 'proposed', createdAt: now() };
        await store.upsertPersonal({
          ...profile,
          learningRecords: [...(profile.learningRecords ?? []), record],
          updatedAt: now(),
        });
        return record;
      }),
    confirm: (recordId) =>
      mutate(() =>
        update(recordId, (profile, record) => {
          if (record.status !== 'proposed') return profile;
          const merged = mergeLearnedFact(profile[record.collection], record.fact);
          if (!merged.accepted)
            return {
              ...profile,
              learningRecords: profile.learningRecords?.map((item) =>
                item.id === record.id ? { ...item, status: 'rejected' } : item
              ),
              updatedAt: now(),
            };
          return {
            ...profile,
            [record.collection]: merged.values,
            learningRecords: profile.learningRecords?.map((item) =>
              item.id === record.id ? { ...item, status: 'applied', confirmedAt: now() } : item
            ),
            updatedAt: now(),
          };
        })
      ),
    reject: (recordId) =>
      mutate(() =>
        update(recordId, (profile, record) => ({
          ...profile,
          learningRecords: profile.learningRecords?.map((item) =>
            item.id === record.id ? { ...item, status: 'rejected' } : item
          ),
          updatedAt: now(),
        }))
      ),
    correct: (recordId, fact, explanation) =>
      mutate(() =>
        update(recordId, (profile, record) => ({
          ...profile,
          [record.collection]: mergeLearnedFact(profile[record.collection], fact).values,
          learningRecords: profile.learningRecords?.map((item) =>
            item.id === record.id ? { ...item, fact, explanation, status: 'corrected', confirmedAt: now() } : item
          ),
          updatedAt: now(),
        }))
      ),
    forget: (recordId) =>
      mutate(() =>
        update(recordId, (profile, record) => ({
          ...profile,
          [record.collection]: profile[record.collection].filter(
            (fact) => fact.key !== record.fact.key || fact.value !== record.fact.value
          ),
          learningRecords: profile.learningRecords?.map((item) =>
            item.id === record.id ? { ...item, status: 'forgotten' } : item
          ),
          updatedAt: now(),
        }))
      ),
    recordOutcome: (recordId, outcome) =>
      mutate(() =>
        update(recordId, (profile, record) => ({
          ...profile,
          learningRecords: profile.learningRecords?.map((item) =>
            item.id === record.id ? { ...item, outcome } : item
          ),
          updatedAt: now(),
        }))
      ),
  };
};

const SECRET_TEXT_PATTERNS = [
  /\bsk-[a-z0-9_-]{12,}\b/giu,
  /\bghp_[a-z0-9]{20,}\b/giu,
  /\b(?:bearer\s+)[a-z0-9._~+/-]+=*/giu,
  /\b(?:api[_-]?key|password|secret|token|cookie)\s*[:=]\s*[^\s,;]+/giu,
];

/** Redact common credential-shaped values before context can enter a prompt. */
export const redactContextText = (value: string): string =>
  SECRET_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value).slice(0, 8_000);

const OPAQUE_SECRET_HANDLE_PATTERN = /^secret:\/\/[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/u;

/** Opaque handles are capability identifiers, not free text or secret values. */
export const isOpaqueSecretHandle = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 300 && OPAQUE_SECRET_HANDLE_PATTERN.test(value);

const parsePersistedSecretHandle = (value: unknown): string => {
  // Previous builds accidentally sanitized every valid `secret://` handle to
  // this placeholder. Accept it only long enough for startup reconciliation
  // to replace Core-owned references from authoritative vault descriptors.
  if (value === '[REDACTED]') return value;
  if (!isOpaqueSecretHandle(value)) throw new Error('Invalid context secret handle.');
  return value;
};

const boundedText = (value: unknown, label: string, max = 8_000): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid context ${label}.`);
  return redactContextText(value);
};
const boundedList = (value: unknown, label: string): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((item) => typeof item !== 'string' || item.length > 1_000)
  ) {
    throw new Error(`Invalid context ${label}.`);
  }
  return value.map((item) => boundedText(item, label, 1_000));
};
const parseFact = (value: unknown): ContextFact => {
  if (!value || typeof value !== 'object') throw new Error('Invalid context fact.');
  const item = value as Partial<ContextFact>;
  if (
    typeof item.key !== 'string' ||
    typeof item.value !== 'string' ||
    typeof item.confidence !== 'number' ||
    item.confidence < 0 ||
    item.confidence > 1 ||
    !Number.isFinite(item.confidence) ||
    !Number.isSafeInteger(item.learnedAt) ||
    (item.lastConfirmedAt !== undefined && !Number.isSafeInteger(item.lastConfirmedAt)) ||
    !item.scope ||
    typeof item.scope !== 'object' ||
    (item.scope.kind !== 'global' && item.scope.kind !== 'surface') ||
    (item.scope.kind === 'surface' && (typeof item.scope.surface !== 'string' || item.scope.surface.length > 100)) ||
    !['user', 'observed', 'imported', 'inferred'].includes(item.source ?? '') ||
    !['normal', 'private'].includes(item.sensitivity ?? '') ||
    typeof item.userLocked !== 'boolean'
  ) {
    throw new Error('Invalid context fact.');
  }
  return {
    key: boundedText(item.key, 'fact key', 200),
    value: boundedText(item.value, 'fact value'),
    confidence: item.confidence,
    source: item.source,
    learnedAt: item.learnedAt,
    lastConfirmedAt: item.lastConfirmedAt,
    scope:
      item.scope.kind === 'global'
        ? { kind: 'global' }
        : { kind: 'surface', surface: boundedText(item.scope.surface, 'surface', 100) },
    sensitivity: item.sensitivity,
    userLocked: item.userLocked,
  };
};
const emptyStructuredPersonalProfile = (): StructuredPersonalProfile => ({
  personalInformation: [],
  psychology: [],
  personality: [],
  interests: [],
  profession: [],
  aestheticTaste: [],
  pastContext: [],
});
const parseStructuredFactCollection = (value: unknown, label: string): ContextFact[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`Invalid context ${label}.`);
  return value.map(parseFact);
};
const parseStructuredPersonalProfile = (value: unknown): StructuredPersonalProfile => {
  if (value === undefined) return emptyStructuredPersonalProfile();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid structured personal profile.');
  }
  const profile = value as Partial<Record<keyof StructuredPersonalProfile, unknown>>;
  return {
    personalInformation: parseStructuredFactCollection(profile.personalInformation, 'personal information'),
    psychology: parseStructuredFactCollection(profile.psychology, 'psychology'),
    personality: parseStructuredFactCollection(profile.personality, 'personality'),
    interests: parseStructuredFactCollection(profile.interests, 'interests'),
    profession: parseStructuredFactCollection(profile.profession, 'profession'),
    aestheticTaste: parseStructuredFactCollection(profile.aestheticTaste, 'aesthetic taste'),
    pastContext: parseStructuredFactCollection(profile.pastContext, 'past context'),
  };
};
const parseAgent = (value: unknown): AgentContext => {
  if (!value || typeof value !== 'object') throw new Error('Invalid agent context.');
  const item = value as Partial<AgentContext>;
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.role !== 'string' ||
    typeof item.identity !== 'string' ||
    !Number.isSafeInteger(item.updatedAt)
  ) {
    throw new Error('Invalid agent context.');
  }
  return {
    id: boundedText(item.id, 'agent id', 200),
    name: boundedText(item.name, 'agent name', 200),
    role: boundedText(item.role, 'agent role', 500),
    identity: boundedText(item.identity, 'agent identity'),
    traits: boundedList(item.traits, 'agent traits'),
    capabilities: boundedList(item.capabilities, 'agent capabilities'),
    instructions: boundedList(item.instructions, 'agent instructions'),
    updatedAt: item.updatedAt,
  };
};
const parsePersonal = (value: unknown): PersonalContext => {
  if (!value || typeof value !== 'object') throw new Error('Invalid personal context.');
  const item = value as Partial<PersonalContext>;
  if (
    !item.communication ||
    !item.decisionPolicy ||
    typeof item.communication !== 'object' ||
    typeof item.decisionPolicy !== 'object' ||
    typeof item.id !== 'string' ||
    !Number.isSafeInteger(item.updatedAt)
  ) {
    throw new Error('Invalid personal context.');
  }
  const communication = item.communication as PersonalContext['communication'];
  const decision = item.decisionPolicy as PersonalContext['decisionPolicy'];
  if (
    !Array.isArray(communication.vocabulary) ||
    !Array.isArray(communication.writingGuidance) ||
    !['ask', 'minor-only', 'autonomous'].includes(decision.autonomy)
  ) {
    throw new Error('Invalid personal context.');
  }
  if (communication.verbosity !== undefined && !['concise', 'balanced', 'detailed'].includes(communication.verbosity))
    throw new Error('Invalid personal communication style.');
  const refs = Array.isArray(item.secretReferences) ? item.secretReferences : [];
  const learningRecords = Array.isArray(item.learningRecords) ? item.learningRecords : [];
  if (refs.length > 100 || refs.some((ref) => !ref || typeof ref !== 'object'))
    throw new Error('Invalid secret references.');
  if (learningRecords.length > 1_000) throw new Error('Invalid learning records.');
  return {
    id: boundedText(item.id, 'personal id', 200),
    facts: (item.facts ?? []).map(parseFact),
    preferences: (item.preferences ?? []).map(parseFact),
    structuredProfile: parseStructuredPersonalProfile(item.structuredProfile),
    communication: {
      language: communication.language ? boundedText(communication.language, 'language', 100) : undefined,
      tone: communication.tone ? boundedText(communication.tone, 'tone', 200) : undefined,
      verbosity: communication.verbosity,
      vocabulary: boundedList(communication.vocabulary, 'vocabulary'),
      writingGuidance: boundedList(communication.writingGuidance, 'writing guidance'),
    },
    decisionPolicy: {
      autonomy: decision.autonomy,
      mayDecideCategories: boundedList(decision.mayDecideCategories, 'decision categories'),
      alwaysAskCategories: boundedList(decision.alwaysAskCategories, 'always ask categories'),
      riskTolerance: decision.riskTolerance,
    },
    habits: (item.habits ?? []).map(parseFact),
    secretReferences: refs.map((ref) => {
      const record = ref as PersonalContext['secretReferences'][number];
      if (
        typeof record.key !== 'string' ||
        typeof record.handle !== 'string' ||
        typeof record.capability !== 'string' ||
        !Array.isArray(record.surfaces) ||
        !Array.isArray(record.purposes) ||
        (record.fields !== undefined && !Array.isArray(record.fields))
      )
        throw new Error('Invalid secret reference.');
      return {
        key: boundedText(record.key, 'secret key', 200),
        handle: parsePersistedSecretHandle(record.handle),
        capability: boundedText(record.capability, 'secret capability', 300),
        surfaces: boundedList(record.surfaces, 'secret surfaces'),
        purposes: boundedList(record.purposes, 'secret purposes'),
        fields: record.fields ? boundedList(record.fields, 'secret fields') : undefined,
        description: record.description ? boundedText(record.description, 'secret description', 500) : undefined,
      };
    }),
    ...(item.learningRecords === undefined
      ? {}
      : {
          learningRecords: learningRecords.map((rawRecord): PersonalLearningRecord => {
            if (!rawRecord || typeof rawRecord !== 'object') throw new Error('Invalid learning record.');
            const record = rawRecord as Partial<PersonalLearningRecord>;
            if (
              typeof record.id !== 'string' ||
              !['facts', 'preferences', 'habits'].includes(record.collection ?? '') ||
              !record.fact ||
              typeof record.explanation !== 'string' ||
              typeof record.provenance !== 'string' ||
              !['proposed', 'applied', 'rejected', 'corrected', 'forgotten'].includes(record.status ?? '') ||
              !Number.isSafeInteger(record.createdAt)
            ) {
              throw new Error('Invalid learning record.');
            }
            return {
              id: boundedText(record.id, 'learning record id', 200),
              collection: record.collection,
              fact: parseFact(record.fact),
              explanation: boundedText(record.explanation, 'learning explanation', 1_000),
              provenance: boundedText(record.provenance, 'learning provenance', 500),
              status: record.status,
              createdAt: record.createdAt,
              confirmedAt: record.confirmedAt,
              outcome: record.outcome,
            };
          }),
        }),
    updatedAt: item.updatedAt,
  };
};
export const sanitizeContextDocument = (document: ContextDocument): ContextDocument => {
  if (
    document.version !== 1 ||
    !Array.isArray(document.agents) ||
    !Array.isArray(document.people) ||
    document.agents.length > 100 ||
    document.people.length > 100
  )
    throw new Error('Unsupported context document.');
  return { version: 1, agents: document.agents.map(parseAgent), people: document.people.map(parsePersonal) };
};
const parseDocument = (raw: string): ContextDocument => {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid context document.');
  const candidate = value as Partial<ContextDocument>;
  if (candidate.version !== 1 || !Array.isArray(candidate.agents) || !Array.isArray(candidate.people)) {
    throw new Error('Unsupported context document.');
  }
  return sanitizeContextDocument({ version: 1, agents: candidate.agents, people: candidate.people });
};
const extractFirstJsonObject = (raw: string): string | undefined => {
  const start = raw.search(/\S/u);
  if (start < 0 || raw[start] !== '{') return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }
  return undefined;
};
const parseDocumentWithTrailingWriteRecovery = (raw: string): { document: ContextDocument; repaired: boolean } => {
  try {
    return { document: parseDocument(raw), repaired: false };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const prefix = extractFirstJsonObject(raw);
    if (!prefix || prefix.trim() === raw.trim()) throw error;
    return { document: parseDocument(prefix), repaired: true };
  }
};
const sameScope = (left: ContextFact, right: ContextFact): boolean =>
  left.scope.kind === right.scope.kind &&
  (left.scope.kind === 'global' || (right.scope.kind === 'surface' && left.scope.surface === right.scope.surface));

/** Explicit/locked knowledge cannot be silently overwritten by an inference. */
export const mergeLearnedFact = (
  current: ContextFact[],
  candidate: ContextFact
): { values: ContextFact[]; accepted: boolean } => {
  const index = current.findIndex((item) => item.key === candidate.key && sameScope(item, candidate));
  if (index < 0) return { values: [...current, structuredClone(candidate)], accepted: true };
  const existing = current[index];
  const candidatePriority =
    candidate.userLocked || candidate.source === 'user' ? 3 : candidate.source === 'imported' ? 2 : 1;
  const existingPriority =
    existing.userLocked || existing.source === 'user' ? 3 : existing.source === 'imported' ? 2 : 1;
  if (
    candidatePriority < existingPriority ||
    (candidatePriority === existingPriority && candidate.confidence < existing.confidence)
  ) {
    return { values: current, accepted: false };
  }
  const next = [...current];
  next[index] = structuredClone(candidate);
  return { values: next, accepted: true };
};

/** Atomic Main-process profile store. Its typed contract cannot hold raw secrets. */
export const createContextStore = (filePath: string, fsImpl: ContextStoreFs = nodeFs): ContextStore => {
  let cache: ContextDocument | undefined;
  let loading: Promise<ContextDocument> | undefined;
  let mutation = Promise.resolve();
  const writeDocument = async (document: ContextDocument): Promise<void> => {
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    await fsImpl.rename(temporary, filePath);
  };
  const load = async (): Promise<ContextDocument> => {
    if (cache) return cache;
    loading ??= (async () => {
      try {
        const parsed = parseDocumentWithTrailingWriteRecovery(await fsImpl.readFile(filePath, 'utf-8'));
        if (parsed.repaired) await writeDocument(parsed.document);
        cache = parsed.document;
      } catch (error) {
        if (!isMissing(error)) throw error;
        cache = structuredClone(EMPTY_DOCUMENT);
      }
      return cache;
    })().finally(() => {
      loading = undefined;
    });
    return loading;
  };
  const persist = async (next: ContextDocument): Promise<void> => {
    next = sanitizeContextDocument(next);
    await writeDocument(next);
    cache = next;
  };
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation, operation);
    mutation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };
  return {
    async getAgent(id) {
      await mutation;
      return clone((await load()).agents.find((item) => item.id === id));
    },
    async getPersonal(id) {
      await mutation;
      return clone((await load()).people.find((item) => item.id === id));
    },
    async upsertAgent(value) {
      return mutate(async () => {
        const current = await load();
        await persist({
          ...current,
          agents: [...current.agents.filter((item) => item.id !== value.id), structuredClone(value)],
        });
      });
    },
    async upsertPersonal(value) {
      return mutate(async () => {
        const current = await load();
        await persist({
          ...current,
          people: [...current.people.filter((item) => item.id !== value.id), structuredClone(value)],
        });
      });
    },
    async learnPersonalFact(personalId, collection, fact) {
      return mutate(async () => {
        const current = await load();
        const person = current.people.find((item) => item.id === personalId);
        if (!person) throw new Error(`Personal context not found: ${personalId}`);
        const merged = mergeLearnedFact(person[collection], fact);
        if (!merged.accepted) return false;
        const updated: PersonalContext = { ...person, [collection]: merged.values, updatedAt: Date.now() };
        await persist({ ...current, people: current.people.map((item) => (item.id === personalId ? updated : item)) });
        return true;
      });
    },
    async exportDocument() {
      await mutation;
      return structuredClone(await load());
    },
    async replaceDocument(document) {
      return mutate(() => persist(structuredClone(document)));
    },
  };
};
