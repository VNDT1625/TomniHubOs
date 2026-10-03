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
const base = { id: 'Qwen/Qwen3.5-0.8B', revision: 'immutable-r1', sha256: sha };

const record = (
  purpose: ModelPackRegistryRecord['manifest']['purpose'],
  inputSchema: string,
  outputSchema: string
): ModelPackRegistryRecord => ({
  key: `com.tomny.core.${purpose}@0.1.0#weights`,
  status: 'active',
  installedPath: `/models/${purpose}`,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  manifest: {
    schemaVersion: 1,
    kind: 'model-adapter',
    id: `com.tomny.core.${purpose}`,
    version: '0.1.0',
    purpose,
    format: 'peft-lora-safetensors',
    baseModel: base,
    runtime: {
      engine: 'transformers-peft',
      peft: '>=0.18.1 <0.19.0',
      transformers: '>=5.5.0 <5.6.0',
      minTomnyVersion: '0.0.0',
    },
    contracts: { inputSchema, outputSchema, policyVersion: 'core-policy-v1' },
    files: [
      { path: 'adapter_model.safetensors', size: 1, sha256: sha },
      { path: 'adapter_config.json', size: 1, sha256: sha },
    ],
    training: { datasetManifestSha256: sha, recipeSha256: sha, seed: 1, provenanceSha256: sha },
    evaluation: { reportSha256: sha, benchmarkVersion: 'qwen08-v1', status: 'candidate' },
    license: 'Apache-2.0',
    createdAt: '2026-09-08T00:00:00Z',
  },
});

const security = record('security', 'tomny.security.input.v1', 'tomny.security.output.v1');
const understanding = record(
  'user-understanding',
  'tomny.user-understanding.input.v2',
  'tomny.user-understanding.output.v2'
);
const semantic = record('semantic-analysis', 'tomny.semantic-analysis.input.v1', 'tomny.semantic-analysis.output.v1');

const request = (overrides: Partial<CoreModelRequest> = {}): CoreModelRequest => ({
  requestId: 'request-1',
  purpose: 'security',
  contractVersion: 'tomny.security.input.v1',
  priority: 'P0',
  deadlineMs: now + 1_000,
  payload: { text: 'sanitized' },
  fallback: 'abstain',
  ...overrides,
});

const registry = (records: readonly ModelPackRegistryRecord[]): ModelRegistryReader => ({
  getActive: async (purpose) => records.find((item) => item.manifest.purpose === purpose),
});

const broker = (records: readonly ModelPackRegistryRecord[], provider = new InMemoryInferenceProvider()) =>
  new LocalInferenceBroker(
    registry(records),
    provider,
    { validate: () => true },
    {},
    { baseBinding: base, now: () => now, createReceiptId: () => 'receipt-1' }
  );

const securityOutput = {
  riskType: 'none',
  action: 'allow',
  confidence: 1,
  reasonCode: 'CLEAN',
  requiresBackendValidation: false,
  redactions: [],
};
const understandingOutput = {
  hasMemorySignal: false,
  kind: 'none',
  scopeHint: 'none',
  confidence: 1,
  reason: 'No durable signal.',
  requiresUserConfirmation: true,
};
const semanticOutput = { security: securityOutput, userUnderstanding: understandingOutput };

describe('LocalInferenceBroker', () => {
  it('uses the immutable 0.8B base for all three adapters without stacking or switching bases', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    const instance = broker([security, understanding, semantic], provider);

    const results = await Promise.all([
      instance.infer(request()),
      instance.infer(
        request({
          requestId: 'understanding',
          purpose: 'user-understanding',
          contractVersion: 'tomny.user-understanding.input.v2',
        })
      ),
      instance.infer(
        request({
          requestId: 'combined',
          purpose: 'semantic-analysis',
          contractVersion: 'tomny.semantic-analysis.input.v1',
        })
      ),
    ]);

    expect(results.map((item) => item.runtime?.poolId)).toEqual(['qwen-0.8b', 'qwen-0.8b', 'qwen-0.8b']);
    expect(provider.lifecycleCalls).toEqual([{ operation: 'load', poolId: 'qwen-0.8b' }]);
    expect(provider.calls.map((call) => call.adapterKey)).toEqual([security.key, understanding.key, semantic.key]);
  });

  it('rejects an adapter that does not bind to the immutable 0.8B base before provider work', async () => {
    const provider = new InMemoryInferenceProvider();
    const wrong = structuredClone(security);
    wrong.manifest.baseModel = { ...base, sha256: 'b'.repeat(64) };
    const response = await broker([wrong], provider).infer(request());

    expect(response).toMatchObject({ source: 'abstain', failureCode: 'base-binding-mismatch' });
    expect(provider.calls).toHaveLength(0);
    expect(provider.lifecycleCalls).toHaveLength(0);
  });

  it('serializes five concurrent requests through one local worker', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ ok: true });
    let current = 0;
    let maximum = 0;
    provider.setInferHook(async () => {
      current += 1;
      maximum = Math.max(maximum, current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      current -= 1;
    });
    const instance = broker([security], provider);

    await Promise.all(
      Array.from({ length: 5 }, (_item, index) => instance.infer(request({ requestId: `request-${index}` })))
    );

    expect(maximum).toBe(1);
    expect(provider.lifecycleCalls).toEqual([{ operation: 'load', poolId: 'qwen-0.8b' }]);
  });

  it('cleans a partial base load and fails closed', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setLoadFailure(new Error('allocation failed'));
    const response = await broker([security], provider).infer(request());

    expect(response).toMatchObject({ source: 'abstain', failureCode: 'base-load-failed' });
    expect(provider.lifecycleCalls).toEqual([
      { operation: 'load', poolId: 'qwen-0.8b' },
      { operation: 'unload', poolId: 'qwen-0.8b' },
    ]);
    await expect(provider.getLoadedBase()).resolves.toBeUndefined();
  });

  it('does not serve a candidate record exposed by a faulty registry', async () => {
    const provider = new InMemoryInferenceProvider();
    const candidate = structuredClone(security);
    candidate.status = 'candidate';
    const response = await broker([candidate], provider).infer(request());

    expect(response).toMatchObject({ source: 'abstain', failureCode: 'adapter-unavailable' });
    expect(provider.calls).toHaveLength(0);
  });

  it('does not start provider work after a deadline', async () => {
    const provider = new InMemoryInferenceProvider();
    const response = await broker([security], provider).infer(request({ deadlineMs: now - 1 }));

    expect(response).toMatchObject({ source: 'abstain', failureCode: 'deadline-exceeded' });
    expect(provider.calls).toHaveLength(0);
  });

  it('validates the combined output contract before accepting semantic analysis', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput(semanticOutput);
    const strictBroker = new LocalInferenceBroker(
      registry([semantic]),
      provider,
      new BoundedCoreModelOutputValidator(),
      {},
      { baseBinding: base, now: () => now, createReceiptId: () => 'receipt-1' }
    );

    await expect(
      strictBroker.infer(request({ purpose: 'semantic-analysis', contractVersion: 'tomny.semantic-analysis.input.v1' }))
    ).resolves.toMatchObject({
      source: 'adapter',
      validation: 'passed',
      value: semanticOutput,
    });
  });

  it('rejects malformed combined output without exposing it in the receipt', async () => {
    const provider = new InMemoryInferenceProvider();
    provider.setOutput({ security: securityOutput, userUnderstanding: { secret: 'must not escape' } });
    const strictBroker = new LocalInferenceBroker(
      registry([semantic]),
      provider,
      new BoundedCoreModelOutputValidator(),
      {},
      { baseBinding: base, now: () => now, createReceiptId: () => 'receipt-1' }
    );
    const response = await strictBroker.infer(
      request({ purpose: 'semantic-analysis', contractVersion: 'tomny.semantic-analysis.input.v1' })
    );

    expect(response).toMatchObject({ source: 'abstain', failureCode: 'output-invalid' });
    expect(JSON.stringify(response)).not.toContain('must not escape');
  });
});
