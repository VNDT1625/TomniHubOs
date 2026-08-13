import { app, safeStorage } from 'electron';
import * as path from 'node:path';
import { createCoreContextComposer } from './contextComposer';
import { createContextStore, reconcilePersonalSecretReferences, type ContextStore } from './contextStore';
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

const defaultPersonal = (): PersonalContext => ({
  id: 'default',
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

const ensureDefaultContexts = async (store: ContextStore): Promise<void> => {
  const [agent, personal] = await Promise.all([store.getAgent('tomny'), store.getPersonal('default')]);
  if (!agent) await store.upsertAgent(defaultAgent());
  if (!personal) await store.upsertPersonal(defaultPersonal());
};

const reconcileStoredSecretReferences = async (store: ContextStore, vault: SecretVault): Promise<void> => {
  const [personal, descriptors] = await Promise.all([store.getPersonal('default'), vault.list()]);
  if (!personal) throw new Error('Default Personal Context is unavailable.');
  const reconciled = reconcilePersonalSecretReferences(personal, descriptors);
  if (JSON.stringify(reconciled.secretReferences) === JSON.stringify(personal.secretReferences)) return;
  await store.upsertPersonal({ ...reconciled, updatedAt: Date.now() });
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
  const recovery = ensureDefaultContexts(store).then(noLegacyRecovery);
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
  const ready = recovery.then(() => reconcileStoredSecretReferences(store, vault));
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
