import { describe, expect, it } from 'vitest';
import { readLocalInferenceRuntimeConfig } from '../../../packages/desktop/src/process/experimentalCore/adapters/sidecar/localInferenceProviderResolver';
describe('runtime config', () => {
  it('rejects missing or malformed env', () => {
    expect(readLocalInferenceRuntimeConfig({})).toBeUndefined();
    expect(
      readLocalInferenceRuntimeConfig({
        TOMNY_QWEN_DAEMON_COMMAND: 'x',
        TOMNY_QWEN_DAEMON_CWD: 'C:\\x',
        TOMNY_QWEN_BASE_ROOT: 'C:\\b',
        TOMNY_QWEN_ADAPTER_ROOT: 'C:\\a',
        TOMNY_QWEN_BASE_SHA256: 'bad',
      })
    ).toBeUndefined();
  });
});
