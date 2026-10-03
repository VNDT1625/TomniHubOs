import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const NATIVE_PROVIDER_CONSUMERS = [
  'packages/desktop/src/process/company/companyBridge.ts',
  'packages/desktop/src/process/manager/managerWiring.ts',
  'packages/desktop/src/process/monitor/analyzerAgent.ts',
  'packages/desktop/src/process/pricing/configuredModelPricing.ts',

  'packages/desktop/src/process/testing/appDetector.ts',
  'packages/desktop/src/process/testing/scenarioGenerator.ts',
] as const;

const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Tomny desktop provider cutover', () => {
  it('keeps normal Main-process model consumers off the legacy provider route', () => {
    for (const relativePath of NATIVE_PROVIDER_CONSUMERS) {
      const source = read(relativePath);
      expect(source, relativePath).toContain('listReadyProviders');
      expect(source, relativePath).not.toContain("httpRequest<IProvider[]>('GET', '/api/providers')");
      expect(source, relativePath).not.toContain("httpRequest<RawProvider[]>('GET', '/api/providers')");
    }
  });

  it('requires Browser chat to use the shared provider execution broker without a direct key or fetch path', () => {
    const source = read('packages/desktop/src/process/browser/providerChat.ts');

    expect(source).toContain("from '@process/services/agentChat'");
    expect(source).not.toContain('listReadyProviders');
    expect(source).not.toContain('api_key');
    expect(source).not.toContain('fetch(');
  });

  it('requires Studio Chat to use the shared provider execution broker without a direct key or fetch path', () => {
    const source = read('packages/package-apps/document-studio/src/process/studioChatBridge.ts');

    expect(source).toContain("from '@process/services/agentChat'");
    expect(source).toContain('createProviderChat');
    expect(source).not.toContain('listReadyProviders');
    expect(source).not.toContain('api_key');
    expect(source).not.toContain('fetch(');
  });

  it('keeps Monitor model selection separate from brokered provider egress', () => {
    const source = read('packages/desktop/src/process/monitor/analyzerAgent.ts');

    expect(source).toContain('listReadyProviders');
    expect(source).toContain("from '@process/services/agentChat'");
    expect(source).toContain('createProviderChat');
    expect(source).not.toContain('api_key');
    expect(source).not.toContain('fetch(');
  });

  it('keeps Testing Scenario model selection separate from brokered provider egress', () => {
    const source = read('packages/desktop/src/process/testing/scenarioGenerator.ts');

    expect(source).toContain('listReadyProviders');
    expect(source).toContain("from '@process/services/agentChat'");
    expect(source).toContain('createProviderChat');
    expect(source).not.toContain('api_key');
    expect(source).not.toContain('fetch(');
  });

  it('contains MakeVideo image egress until opaque binary transport is available', () => {
    const source = read('packages/desktop/src/process/makevideo/makeVideoBridge.ts');

    expect(source).toContain("from '@process/services/agentChat'");
    expect(source).toContain('createProviderChat');
    expect(source).toContain('MAKEVIDEO_IMAGE_REMOTE_TRANSPORT_DISABLED');
    expect(source).not.toContain('listReadyProviders');
    expect(source).not.toContain('api_key');
    expect(source).not.toContain('fetch(');
  });

  it('keeps Testing App Detector model selection separate from brokered provider egress', () => {
    const source = read('packages/desktop/src/process/testing/appDetector.ts');

    expect(source).toContain('listReadyProviders');
    expect(source).toContain("from '@process/services/agentChat'");
    expect(source).toContain('createProviderChat');
    expect(source).not.toContain('api_key');
    expect(source).not.toContain('fetch(');
  });

  it('requires Automation AI execution and chat to use the shared provider execution broker without direct provider credentials or fetch', () => {
    for (const relativePath of [
      'packages/desktop/src/process/automation/nodeExecutors.ts',
      'packages/desktop/src/process/automation/automationChatBridge.ts',
    ]) {
      const source = read(relativePath);

      expect(source, relativePath).toContain("from '@process/services/agentChat'");
      expect(source, relativePath).not.toContain('listReadyProviders');
      expect(source, relativePath).not.toContain('api_key');
      expect(source, relativePath).not.toContain('fetch(');
    }
  });

  it('requires IDE chat and knowledge graph to use the shared broker without direct provider credentials or fetch', () => {
    const ideProvider = read('packages/package-apps/ide/src/process/workspace/ideProvider.ts');
    const knowledgeGraph = read('packages/package-apps/ide/src/process/knowledge/graph/knowledgeGraphBridge.ts');

    expect(ideProvider).toContain("from '@process/services/agentChat'");
    expect(knowledgeGraph).toContain("from '@package-apps/ide/process/workspace/ideProvider'");
    for (const [relativePath, source] of [
      ['packages/package-apps/ide/src/process/workspace/ideProvider.ts', ideProvider],
      ['packages/package-apps/ide/src/process/knowledge/graph/knowledgeGraphBridge.ts', knowledgeGraph],
    ] as const) {
      expect(source, relativePath).not.toContain('listReadyProviders');
      expect(source, relativePath).not.toContain('api_key');
      expect(source, relativePath).not.toContain('fetch(');
    }
  });

  it('keeps the compatibility-import boundary isolated and legacy migrations free of provider credentials', () => {
    expect(read('packages/desktop/src/process/services/tomnyProviderBridge.ts')).toContain('readLegacyCatalog');
    const migration = read('packages/desktop/src/process/utils/runBackendMigrations.ts');
    expect(migration).not.toContain("httpRequest<IProvider[]>('GET', '/api/providers')");
    expect(migration).not.toContain('resolveImageGenerationMcpEnv');
    expect(migration).not.toContain('TOMNY_IMG_API_KEY');
  });
});
