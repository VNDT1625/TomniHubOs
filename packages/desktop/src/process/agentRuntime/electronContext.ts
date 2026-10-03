import { app, safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { createCoreContextComposer } from './contextComposer';
import { createContextStore, type ContextStore } from './contextStore';
import {
  createFileSecretRepository,
  createSecretVault,
  type SecretRecoveryReport,
  type SecretVault,
  type SecretVaultCodec,
} from './secretVault';
import type { AgentContext, CoreContextComposer, PersonalContext } from './contextTypes';

const safeStorageCodec: SecretVaultCodec = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plainText) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secret encryption is unavailable.');
    return safeStorage.encryptString(plainText).toString('base64');
  },
  decrypt: (cipherText) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secret encryption is unavailable.');
    return safeStorage.decryptString(Buffer.from(cipherText, 'base64'));
  },
};

const defaultAgent = (): AgentContext => ({
  id: 'tomny',
  name: 'Tomny',
  role: 'General agentic assistant',
  identity: 'A surface-aware agent that plans, uses trusted tools, and reports evidence honestly.',
  traits: ['proactive', 'precise', 'transparent'],
  capabilities: ['direct CLI transport', 'surface tools', 'Team and Company orchestration'],
  instructions: [
    'Use the active surface capabilities instead of assuming unavailable tools.',
    'Make minor reversible decisions within the user decision policy; ask before sensitive or irreversible actions.',
  ],
  updatedAt: Date.now(),
});

const ACCOUNT_PERSONAL_CONTEXT_PREFIX = 'account-v1-';

/**
 * A Personal Context record is never keyed by an account identifier directly.
 * This stable opaque key lets Main isolate profiles without placing account
 * identity in the context document, renderer, or model-visible projection.
 */
export const accountPersonalContextId = (accountId: string): string => {
  if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > 512 || /\p{Cc}/u.test(accountId)) {
    throw new Error('ACCOUNT_PERSONAL_CONTEXT_UNAVAILABLE');
  }
  return `${ACCOUNT_PERSONAL_CONTEXT_PREFIX}${createHash('sha256').update(accountId, 'utf8').digest('base64url')}`;
};

const defaultPersonal = (id: string): PersonalContext => ({
  id,
  facts: [],
  preferences: [],
  structuredProfile: {
    personalInformation: [],
    psychology: [],
    personality: [],
    interests: [],
    profession: [],
    aestheticTaste: [],
    pastContext: [],
  },
  communication: { vocabulary: [], writingGuidance: [] },
  decisionPolicy: { autonomy: 'minor-only', mayDecideCategories: [], alwaysAskCategories: ['secrets', 'payments'] },
  habits: [],
  secretReferences: [],
  updatedAt: Date.now(),
});

const ensureCoreAgentContext = async (store: ContextStore): Promise<void> => {
  const agent = await store.getAgent('tomny');
  if (!agent) await store.upsertAgent(defaultAgent());
};

/**
 * Create or load the profile bound to the authenticated Main account. The old
 * shared `default` record is intentionally never read or migrated here: it is
 * quarantined until a separately consented, account-bound migration exists.
 */
export const ensureAccountPersonalContext = async (
  store: Pick<ContextStore, 'getPersonal' | 'upsertPersonal'>,
  accountId: string
): Promise<PersonalContext> => {
  const id = accountPersonalContextId(accountId);
  const existing = await store.getPersonal(id);
  if (existing) return existing;
  const created = defaultPersonal(id);
  await store.upsertPersonal(created);
  const persisted = await store.getPersonal(id);
  if (!persisted) throw new Error('ACCOUNT_PERSONAL_CONTEXT_UNAVAILABLE');
  return persisted;
};

/** Main callers must supply a live trusted account; absent identity is a denial. */
export const ensureActiveAccountPersonalContext = async (
  store: Pick<ContextStore, 'getPersonal' | 'upsertPersonal'>,
  accountId: string | undefined
): Promise<PersonalContext> => {
  if (accountId === undefined) throw new Error('ACCOUNT_PERSONAL_CONTEXT_UNAVAILABLE');
  return ensureAccountPersonalContext(store, accountId);
};

/**
 * Core owns its vault. Optional packages may offer their own explicit migration
 * when activated, but Core startup must not load their storage implementation.
 */
const noLegacyRecovery = (): SecretRecoveryReport => ({
  status: 'missing',
  imported: 0,
  existing: 0,
  skipped: 0,
  failed: 0,
});

export type ElectronContextServices = {
  composer: CoreContextComposer;
  vault: SecretVault;
  store: ContextStore;
  /** Count-only startup result; never contains source identities or secret values. */
  recovery: Promise<SecretRecoveryReport>;
  ready: Promise<void>;
};

let sharedContextServices: ElectronContextServices | undefined;

/** Main-process wiring. Renderer and model transports never receive the vault instance. */
export const createElectronContextServices = (): ElectronContextServices => {
  if (sharedContextServices) return sharedContextServices;
  const directory = path.join(app.getPath('userData'), 'tomny-core', 'context');
  const store = createContextStore(path.join(directory, 'profiles.json'));
  const repository = createFileSecretRepository(path.join(directory, 'secrets.json'));
  const vault = createSecretVault(repository, safeStorageCodec);
  const recovery = ensureCoreAgentContext(store).then(noLegacyRecovery);
  void recovery.then((report) => {
    if (report.status === 'partial' || report.status === 'unavailable') {
      console.warn('[SecretContextRecovery] Legacy recovery was not complete.', {
        status: report.status,
        imported: report.imported,
        existing: report.existing,
        skipped: report.skipped,
        failed: report.failed,
      });
    }
  });
  // Vault metadata is not copied into a profile at startup. A shared legacy
  // profile must not become an implicit cross-account secret migration.
  const ready = recovery.then<void>(() => undefined);
  const baseComposer = createCoreContextComposer(store);
  const composer: CoreContextComposer = {
    async composePrompt(input) {
      await ready;
      return baseComposer.composePrompt(input);
    },
    async inspectContext(input) {
      await ready;
      if (!baseComposer.inspectContext) return {};
      return baseComposer.inspectContext(input);
    },
  };
  sharedContextServices = { composer, vault, store, recovery, ready };
  return sharedContextServices;
};
