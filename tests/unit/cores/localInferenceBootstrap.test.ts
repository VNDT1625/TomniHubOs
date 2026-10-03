import { describe, expect, it } from 'vitest';
import {
  createProductionLocalInferenceBroker,
  hasPromotedAdapterSet,
  isPromotedActiveRecord,
} from '../../../packages/desktop/src/process/experimentalCore/adapters/sidecar/localInferenceBootstrap';
import { resolveLocalInferenceProvider } from '../../../packages/desktop/src/process/experimentalCore/adapters/sidecar/localInferenceProviderResolver';

describe('local inference bootstrap', () => {
  it('requires explicit runtime dependencies and exposes promotion predicate', () => {
    expect(typeof createProductionLocalInferenceBroker).toBe('function');
    expect(isPromotedActiveRecord(undefined)).toBe(false);
  });

  it('requires every adapter purpose before admission', async () => {
    const registry = { getActive: async () => undefined };
    expect(await hasPromotedAdapterSet(registry)).toBe(false);
  });

  it('keeps incomplete daemon configuration fail-closed', () => {
    expect(resolveLocalInferenceProvider(undefined)).toBeUndefined();
    expect(
      resolveLocalInferenceProvider({
        command: '',
        cwd: 'relative',
        baseRoot: 'relative',
        adapterRoot: 'relative',
        baseBinding: {} as never,
      })
    ).toBeUndefined();
  });
});
