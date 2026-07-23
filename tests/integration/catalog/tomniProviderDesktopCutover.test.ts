import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const NATIVE_PROVIDER_CONSUMERS = [
  'packages/desktop/src/process/automation/automationChatBridge.ts',
  'packages/desktop/src/process/automation/nodeExecutors.ts',
  'packages/desktop/src/process/browser/providerChat.ts',
  'packages/desktop/src/process/company/companyBridge.ts',
  'packages/desktop/src/process/ide/ideProvider.ts',
  'packages/desktop/src/process/ide/knowledgeGraphBridge.ts',
  'packages/desktop/src/process/knowledge/rtkEmbedder.ts',
  'packages/desktop/src/process/makevideo/makeVideoBridge.ts',
  'packages/desktop/src/process/manager/managerWiring.ts',
  'packages/desktop/src/process/monitor/analyzerAgent.ts',
  'packages/desktop/src/process/pricing/configuredModelPricing.ts',
  'packages/desktop/src/process/studio/studioChatBridge.ts',
  'packages/desktop/src/process/testing/appDetector.ts',
  'packages/desktop/src/process/testing/scenarioGenerator.ts',
] as const;

const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Tomni desktop provider cutover', () => {
  it('keeps normal Main-process model consumers off the legacy provider route', () => {
    for (const relativePath of NATIVE_PROVIDER_CONSUMERS) {
      const source = read(relativePath);
      expect(source, relativePath).toContain('listReadyProviders');
      expect(source, relativePath).not.toContain("httpRequest<IProvider[]>('GET', '/api/providers')");
      expect(source, relativePath).not.toContain("httpRequest<RawProvider[]>('GET', '/api/providers')");
    }
  });

  it('retains the legacy provider route only at explicit compatibility-import boundaries', () => {
    expect(read('packages/desktop/src/process/services/tomnyProviderBridge.ts')).toContain(
      "httpRequest<IProvider[]>('GET', '/api/providers')"
    );
    expect(read('packages/desktop/src/process/utils/runBackendMigrations.ts')).toContain(
      "httpRequest<IProvider[]>('GET', '/api/providers')"
    );
  });
});
