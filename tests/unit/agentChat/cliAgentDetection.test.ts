import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CORE_ADAPTER_DEFINITIONS,
  detectCoreTargets,
} from '../../../packages/desktop/src/process/experimentalCore/coreRegistry';
import { createAgentCatalogStore } from '../../../packages/desktop/src/process/resources/agentCatalogStore';

describe('CLI agent detection and catalog integration', () => {
  it('detects available core targets on the host machine without crashing', async () => {
    const targets = await detectCoreTargets();
    expect(Array.isArray(targets)).toBe(true);
    expect(targets.length).toBe(CORE_ADAPTER_DEFINITIONS.length);

    for (const target of targets) {
      expect(typeof target.id).toBe('string');
      expect(typeof target.name).toBe('string');
      expect(typeof target.protocol).toBe('string');
      expect(typeof target.detected).toBe('boolean');
      expect(typeof target.available).toBe('boolean');

      if (target.detected) {
        expect(typeof target.command).toBe('string');
        expect(target.command!.length).toBeGreaterThan(0);
      } else {
        expect(target.available).toBe(false);
      }
    }

    const detectedTargets = targets.filter((t) => t.detected);
    console.log(
      '[cliAgentDetection.test] Detected targets on host:',
      detectedTargets.map((t) => t.name)
    );
    expect(detectedTargets.length).toBeGreaterThan(0);
  });

  it('correctly maps target detection state to AgentMetadata in agent catalog store', async () => {
    const testDir = await mkdtemp(path.join(tmpdir(), 'tomni-agent-test-'));
    try {
      const storeFile = path.join(testDir, 'agents.json');
      const store = createAgentCatalogStore(storeFile);

      const agentList = await store.list();
      expect(Array.isArray(agentList)).toBe(true);
      expect(agentList.length).toBeGreaterThanOrEqual(CORE_ADAPTER_DEFINITIONS.length);

      const codexAgent = agentList.find((a) => a.id === 'codex');
      expect(codexAgent).toBeDefined();
      expect(codexAgent!.agent_source).toBe('builtin');
      expect(codexAgent!.enabled).toBe(true);

      // Verify custom agent addition, toggle, and deletion
      const created = await store.create({
        name: 'Custom Test Agent',
        command: 'node',
        args: ['-v'],
      });
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Custom Test Agent');
      expect(created.agent_source).toBe('custom');

      const updatedList = await store.list();
      expect(updatedList.some((a) => a.id === created.id)).toBe(true);

      const disabled = await store.setEnabled(created.id, false);
      expect(disabled.enabled).toBe(false);

      const deleted = await store.remove(created.id);
      expect(deleted).toBe(true);

      const finalList = await store.list();
      expect(finalList.some((a) => a.id === created.id)).toBe(false);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('handles custom resolvers deterministically for red/green target detection', async () => {
    const mockResolver = vi.fn(async (candidates: string[]) => {
      if (candidates.includes('codex')) return 'C:\\mock\\codex.cmd';
      if (candidates.includes('opencode')) return 'C:\\mock\\opencode.cmd';
      return null;
    });

    const targets = await detectCoreTargets(mockResolver);

    const codex = targets.find((t) => t.id === 'codex')!;
    const opencode = targets.find((t) => t.id === 'opencode')!;
    const claude = targets.find((t) => t.id === 'claude')!;

    expect(codex.detected).toBe(true);
    expect(codex.available).toBe(true);
    expect(codex.command).toBe('C:\\mock\\codex.cmd');

    expect(opencode.detected).toBe(true);
    expect(opencode.available).toBe(true);
    expect(opencode.command).toBe('C:\\mock\\opencode.cmd');

    expect(claude.detected).toBe(false);
    expect(claude.available).toBe(false);
    expect(claude.command).toBeUndefined();
  });

  it('caches built-in detection on subsequent store.list calls and flushes on store.refresh', async () => {
    const testDir = await mkdtemp(path.join(tmpdir(), 'tomni-agent-cache-test-'));
    try {
      const storeFile = path.join(testDir, 'agents.json');
      const store = createAgentCatalogStore(storeFile);

      // First call populates cache
      const first = await store.list();
      expect(first.length).toBeGreaterThan(0);

      // Second call should return quickly from cache
      const start = Date.now();
      const second = await store.list();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50); // In-memory cache is sub-millisecond, easily <50ms
      expect(second.length).toBe(first.length);

      // Refresh invalidates cache and succeeds
      const refreshed = await store.refresh();
      expect(refreshed.length).toBe(first.length);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
