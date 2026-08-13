import { describe, expect, it } from 'vitest';
import {
  InMemoryInferenceProvider,
  LocalInferenceBroker,
  type CoreModelRequest,
  type ModelRegistryReader,
} from '../../../packages/desktop/src/process/experimentalCore/adapters/sidecar/localInferenceBroker';
import { BoundedCoreModelOutputValidator } from '../../../packages/desktop/src/process/experimentalCore/adapters/sidecar/outputContractValidator';
import type { ModelPackRegistryRecord } from '../../../packages/desktop/src/process/experimentalCore/catalog/modelPackTypes';

const now = 1_800_000_000_000;
const sha = 'a'.repeat(64);

const securitySha = 'b'.repeat(64);
const securityBase = { id: 'Qwen/Qwen3.5-0.8B', revision: 'immutable-security-r1', sha256: securitySha };
const activeRecord: ModelPackRegistryRecord = {
  key: 'com.tomny.core.assistant@0.1.0#weights',
  status: 'active',
  installedPath: '/models/assistant',
  createdAt: '2026-07-25T10:00:00Z',
  updatedAt: '2026-07-25T10:00:00Z',
  manifest: {
    schemaVersion: 1,
    kind: 'model-adapter',
    id: 'com.tomny.core.assistant',
    version: '0.1.0',
    purpose: 'assistant',
    format: 'peft-lora-safetensors',
    baseModel: { id: 'Qwen/Qwen3.5-2B', revision: 'immutable-r1', sha256: sha },
    runtime: {
      engine: 'transformers-peft',
      peft: '>=0.18.1 <0.19.0',
      transformers: '>=5.5.0 <5.6.0',
      minTomnyVersion: '0.0.0',
    },
    contracts: {
      inputSchema: 'tomny.assistant.input.v1',
      outputSchema: 'tomny.assistant.output.v1',
      policyVersion: 'core-policy-v1',
    },
    files: [
      { path: 'adapter_model.safetensors', size: 1, sha256: sha },
      { path: 'adapter_config.json', size: 1, sha256: sha },
    ],
    training: {
      datasetManifestSha256: sha,
      recipeSha256: sha,
      seed: 1,
      provenanceSha256: sha,
    },
    evaluation: { reportSha256: sha, benchmarkVersion: 'tomny-core-v2', status: 'candidate' },
    license: 'Apache-2.0',
    createdAt: '2026-07-25T10:00:00Z',
  },
};

const securityRecord: ModelPackRegistryRecord = {
  ...structuredClone(activeRecord),
  key: 'com.tomny.core.security@0.1.0#weights',
  manifest: {
    ...structuredClone(activeRecord.manifest),
    id: 'com.tomny.core.security',
    purpose: 'security',
    baseModel: securityBase,
    contracts: {
      inputSchema: 'tomny.security.input.v1',
      outputSchema: 'tomny.security.output.v1',
      policyVersion: 'core-policy-v1',
    },
  },
};

const request = (overrides: Partial<CoreModelRequest> = {}): CoreModelRequest => ({
  requestId: 'request-1',
  purpose: 'assistant',
  contractVersion: 'tomny.assistant.input.v1',
  priority: 'P1',
  deadlineMs: now + 1_000,
  payload: { query: 'help' },
  fallback: 'deterministic',
  ...overrides,
});

const registry = (record: ModelPackRegistryRecord | undefined): ModelRegistryReader => ({
  getActive: async () => record,
});

const registryByPurpose = (records: readonly ModelPackRegistryRecord[]): ModelRegistryReader => ({
  getActive: async (purpose) => records.find((record) => record.manifest.purpose === purpose),
});

const validator = {
  validate: (_schemaId: string, value: unknown): boolean =>
    typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true,
};

const options = {
  baseBindings: { security: securityBase, general: activeRecord.manifest.baseModel },
  now: () => now,
  createReceiptId: () => 'receipt-1',
  resolveOutputSchema: () => 'tomny.assistant.output.v1',
};

describe('Local Inference Broker', () => {
  it('binds a valid response to the active adapter, base and prepared slot', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    const broker = new LocalInferenceBroker(registry(activeRecord), provider, validator, {}, options);
    const response = await broker.infer(request());
    expect(response.source).toBe('adapter');
    expect(response.adapter?.slotId).toBe('fake-slot');
    expect(response.validation).toBe('passed');
  });

  it('never serves a candidate record exposed by a faulty registry reader', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    const candidate = { ...structuredClone(activeRecord), status: 'candidate' as const };
    const broker = new LocalInferenceBroker(
      registry(candidate),
      provider,
      validator,
      { deterministic: () => ({ ok: true }) },
      options
    );
    const response = await broker.infer(request());
    expect(response.source).toBe('deterministic');
    expect(response.failureCode).toBe('adapter-unavailable');
    expect(provider.calls).toHaveLength(0);
    expect(provider.lifecycleCalls).toHaveLength(0);
  });

  it('routes security to 0.8B, all other purposes to 2B, and switches one loaded base at a time', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    const userUnderstanding = structuredClone(activeRecord);
    userUnderstanding.key = 'com.tomny.core.user-understanding@0.1.0#weights';
    userUnderstanding.manifest.id = 'com.tomny.core.user-understanding';
    userUnderstanding.manifest.purpose = 'user-understanding';
    userUnderstanding.manifest.contracts.inputSchema = 'tomny.user-understanding.input.v1';
    const orchestrator = structuredClone(activeRecord);
    orchestrator.key = 'com.tomny.core.orchestrator@0.1.0#weights';
    orchestrator.manifest.id = 'com.tomny.core.orchestrator';
    orchestrator.manifest.purpose = 'orchestrator';
    orchestrator.manifest.contracts.inputSchema = 'tomny.orchestrator.input.v1';
    const broker = new LocalInferenceBroker(
      registryByPurpose([activeRecord, userUnderstanding, orchestrator, securityRecord]),
      provider,
      validator,
      {},
      options
    );
    const assistant = await broker.infer(request());
    const user = await broker.infer(
      request({
        purpose: 'user-understanding',
        contractVersion: 'tomny.user-understanding.input.v1',
        requestId: 'user-1',
      })
    );
    const orchestration = await broker.infer(
      request({ purpose: 'orchestrator', contractVersion: 'tomny.orchestrator.input.v1', requestId: 'orchestrator-1' })
    );
    const security = await broker.infer(
      request({ purpose: 'security', contractVersion: 'tomny.security.input.v1', requestId: 'security-1' })
    );
    expect(assistant.runtime).toMatchObject({ poolId: 'general-2b', transition: 'loaded' });
    expect(user.runtime).toMatchObject({ poolId: 'general-2b', transition: 'reused' });
    expect(orchestration.runtime).toMatchObject({ poolId: 'general-2b', transition: 'reused' });
    expect(security.runtime).toMatchObject({ poolId: 'security-0.8b', transition: 'switched' });
    expect(provider.lifecycleCalls).toEqual([
      { operation: 'load', poolId: 'general-2b' },
      { operation: 'unload', poolId: 'general-2b' },
      { operation: 'load', poolId: 'security-0.8b' },
    ]);
  });

  it('rejects an adapter bound to the wrong immutable pool before provider work', async () => {
    const provider = new InMemoryInferenceProvider();
    const wrong = structuredClone(securityRecord);
    wrong.manifest.baseModel = activeRecord.manifest.baseModel;
    const broker = new LocalInferenceBroker(
      registry(wrong),
      provider,
      validator,
      { deterministic: () => ({ ok: true }) },
      options
    );
    const response = await broker.infer(request({ purpose: 'security', contractVersion: 'tomny.security.input.v1' }));
    expect(response.failureCode).toBe('base-binding-mismatch');
    expect(provider.calls).toHaveLength(0);
    expect(provider.lifecycleCalls).toHaveLength(0);
  });

  it('serializes concurrent inference inside the base critical section', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    let concurrent = 0;
    let maximum = 0;
    provider.setInferHook(async () => {
      concurrent += 1;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent -= 1;
    });
    const broker = new LocalInferenceBroker(registry(activeRecord), provider, validator, {}, options);
    await Promise.all([broker.infer(request({ requestId: 'one' })), broker.infer(request({ requestId: 'two' }))]);
    expect(maximum).toBe(1);
    expect(provider.lifecycleCalls).toEqual([{ operation: 'load', poolId: 'general-2b' }]);
  });

  it('cleans a partial load with an independent signal and falls back', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setLoadFailure(new Error('load failed after allocation'));
    const broker = new LocalInferenceBroker(
      registry(activeRecord),
      provider,
      validator,
      { deterministic: () => ({ ok: true }) },
      options
    );
    const response = await broker.infer(request());
    expect(response.failureCode).toBe('base-switch-failed');
    expect(provider.lifecycleCalls).toEqual([
      { operation: 'load', poolId: 'general-2b' },
      { operation: 'unload', poolId: 'general-2b' },
    ]);
    await expect(provider.getLoadedBase()).resolves.toBeUndefined();
  });

  it('keeps failed cleanup poisoned and recovers before the next switch', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    const broker = new LocalInferenceBroker(
      registryByPurpose([activeRecord, securityRecord]),
      provider,
      validator,
      { deterministic: () => ({ ok: true }) },
      options
    );
    await broker.infer(request());
    provider.setUnloadFailure(new Error('unload failed'));
    const failed = await broker.infer(
      request({ purpose: 'security', contractVersion: 'tomny.security.input.v1', requestId: 'security-fail' })
    );
    expect(failed.failureCode).toBe('base-switch-failed');
    provider.setUnloadFailure(undefined);
    const recovered = await broker.infer(
      request({ purpose: 'security', contractVersion: 'tomny.security.input.v1', requestId: 'security-retry' })
    );
    expect(recovered.source).toBe('adapter');
    expect(recovered.runtime?.poolId).toBe('security-0.8b');
  });

  it('surfaces hotswap incompatibility and uses validated deterministic fallback', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setPreparation({ compatible: false, code: 'rank-mismatch', reason: 'rank 16 was not prepared' });
    const broker = new LocalInferenceBroker(
      registry(activeRecord),
      provider,
      validator,
      { deterministic: () => ({ ok: true, decision: 'ask-user' }) },
      options
    );
    const response = await broker.infer(request());
    expect(response.source).toBe('deterministic');
    expect(response.failureCode).toBe('adapter-incompatible');
  });

  it('uses a known contract to fail closed when no adapter is active', async () => {
    const broker = new LocalInferenceBroker(
      registry(undefined),
      new InMemoryInferenceProvider(),
      validator,
      { deterministic: () => ({ ok: true }) },
      options
    );
    const response = await broker.infer(request());
    expect(response.source).toBe('deterministic');
    expect(response.failureCode).toBe('adapter-unavailable');
  });

  it('abstains when fallback output does not satisfy the output schema', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ malformed: true });
    const broker = new LocalInferenceBroker(
      registry(activeRecord),
      provider,
      validator,
      { deterministic: () => ({ malformed: true }) },
      options
    );
    const response = await broker.infer(request());
    expect(response.source).toBe('abstain');
    expect(response.failureCode).toBe('fallback-invalid');
  });

  it('preserves only a safe validation category when a fallback output is invalid', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setFailure(new Error('adapter failed'));
    const broker = new LocalInferenceBroker(
      registry(activeRecord),
      provider,
      new BoundedCoreModelOutputValidator(),
      { deterministic: () => 'sensitive-fallback-content' },
      options
    );
    const response = await broker.infer(request());
    expect(response).toMatchObject({
      source: 'abstain',
      failureCode: 'fallback-invalid',
      outputValidationError: 'not-json-object',
    });
    expect(JSON.stringify(response)).not.toContain('sensitive-fallback-content');
  });

  it('returns only a structured validation category when an adapter output violates its contract', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({
      intent: 'sensitive-model-content',
      status: 'ready',
      confidence: 0.9,
      reasonCode: 'SAFE',
      nextAction: 'open',
    });
    const broker = new LocalInferenceBroker(
      registry(activeRecord),
      provider,
      new BoundedCoreModelOutputValidator(),
      {},
      options
    );
    const response = await broker.infer(request({ fallback: 'abstain' }));
    expect(response).toMatchObject({
      source: 'abstain',
      failureCode: 'output-invalid',
      outputValidationError: 'missing-key',
    });
    expect(JSON.stringify(response)).not.toContain('sensitive-model-content');
  });

  it('never calls a model when the validator is missing', async () => {
    const provider = new InMemoryInferenceProvider();
    const broker = new LocalInferenceBroker(registry(activeRecord), provider, undefined, {}, options);
    const response = await broker.infer(request());
    expect(response.validation).toBe('validator-missing');
    expect(provider.calls).toHaveLength(0);
  });

  it('does not unload a healthy base when a queued request expires', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    provider.setInferHook(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const broker = new LocalInferenceBroker(registry(activeRecord), provider, validator, {}, options);
    const first = broker.infer(request({ requestId: 'slow' }));
    const expired = broker.infer(request({ requestId: 'queued', deadlineMs: now + 5, fallback: 'abstain' }));
    await expect(expired).resolves.toMatchObject({ failureCode: 'deadline-exceeded' });
    await first;
    expect(provider.lifecycleCalls).toEqual([{ operation: 'load', poolId: 'general-2b' }]);
    await expect(provider.getLoadedBase()).resolves.toMatchObject({ poolId: 'general-2b' });
  });

  it('does not start provider work after the deadline', async () => {
    const provider = new InMemoryInferenceProvider();
    const broker = new LocalInferenceBroker(registry(activeRecord), provider, validator, {}, options);
    const response = await broker.infer(request({ deadlineMs: now - 1, fallback: 'abstain' }));
    expect(response.failureCode).toBe('deadline-exceeded');
    expect(provider.calls).toHaveLength(0);
  });
});
