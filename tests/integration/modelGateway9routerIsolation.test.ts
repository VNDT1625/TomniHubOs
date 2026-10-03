import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd());
const read = (relativePath: string): Promise<string> => readFile(path.join(root, relativePath), 'utf8');

describe('model gateway 9Router isolation', () => {
  it('keeps the replacement model path free of legacy runtime imports', async () => {
    const files = [
      'packages/desktop/src/process/tomnigateway/modelConsumerBridge.ts',
      'packages/desktop/src/process/tomnigateway/modelService.ts',
      'packages/desktop/src/process/tomnigateway/modelRoutes.ts',
      'packages/desktop/src/process/services/security/providerExecution/providerExecutionBroker.ts',
    ];
    const sources = await Promise.all(files.map(read));
    for (const source of sources) {
      expect(source).not.toMatch(/managedRouter9|bundled-model-gateway|prepare-model-gateway/u);
    }
  });

  it('keeps the replacement gateway lifecycle injectable and disabled without Main admission', async () => {
    const source = await read('packages/desktop/src/process/tomnigateway/lifecycle.ts');
    expect(source).toContain('modelService?: TomniGatewayModelService');
    expect(source).toContain('model: deps.modelService');
  });
});
