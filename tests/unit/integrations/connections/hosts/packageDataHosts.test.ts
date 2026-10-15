/* oxlint-disable no-await-in-loop -- each lifecycle assertion depends on the previous operation */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry, type LoadedPackage } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { missingPackageEnv, requiredConnectionEnv } from '@process/integrations/connections/core/envValues';
import { createSkillHost } from '@process/integrations/connections/hosts/data/skillHost';
import { createAgentHost } from '@process/integrations/connections/hosts/data/agentHost';
import { createAssistantCatalogStore } from '@process/resources/assistantCatalogStore';
import { NativeSkillCatalog } from '@process/resources/nativePlatform/skillCatalog';

const roots: string[] = [];
const temp = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-datahosts-'));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const PACKAGE = 'com.community.test-data';
const SKILL_KEY = 'skill:source/skills/demo';
const AGENT_KEY = 'agent:reviewer';
const skill = { kind: 'skill', path: 'source/skills/demo' };
const agent = {
  kind: 'agent',
  id: 'reviewer',
  title: 'Review Agent',
  description: 'Review code',
  path: 'source/agents/reviewer.md',
  format: 'claude-md',
  tools: ['shell'],
  model: 'inherit',
};
const SKILL = '---\nname: demo-skill\ndescription: demo\n---\n# Skill\n';
const AGENT = '---\nname: reviewer\nmodel: inherit\n---\nReview this code. Do not execute anything.';

const setup = async (extra?: { userSkill?: boolean; env?: boolean }) => {
  const root = await temp();
  const pkgDir = path.join(root, 'package');
  const userDir = path.join(root, 'user-skills');
  await mkdir(path.join(pkgDir, 'source', 'skills', 'demo'), { recursive: true });
  await mkdir(path.join(pkgDir, 'source', 'agents'), { recursive: true });
  await writeFile(path.join(pkgDir, 'source', 'skills', 'demo', 'SKILL.md'), SKILL);
  await writeFile(path.join(pkgDir, 'source', 'agents', 'reviewer.md'), AGENT);
  if (extra?.userSkill) {
    await mkdir(path.join(userDir, 'my-skill'), { recursive: true });
    await writeFile(path.join(userDir, 'my-skill', 'SKILL.md'), SKILL);
  }
  const skillCatalog = new NativeSkillCatalog(userDir, [], path.join(root, 'materialized'));
  const assistants = createAssistantCatalogStore(path.join(root, 'assistants.json'));
  const store = createJsonConnectionStateStore(path.join(root, 'connections.json'));
  await store.initialize();
  const adapter = parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: [skill, agent],
    ...(extra?.env
      ? {
          openItems: [
            { kind: 'env-value', name: 'API_TOKEN', connection: 'reviewer', note: 'Set API_TOKEN', required: true },
          ],
        }
      : {}),
  });
  let loaded: LoadedPackage | undefined = {
    packageId: PACKAGE,
    packageVersion: '1.0.0',
    packageDirectory: pkgDir,
    adapter,
  };
  const values: Record<string, string> = {};
  const port = {
    list: async () =>
      Object.keys(values).map((name) => ({
        handle: 'secret://test',
        label: 'test',
        fields: [name],
        origin: 'own' as const,
        updatedAt: 1,
      })),
    resolve: async (_handle: string, fields: readonly string[]) =>
      Object.fromEntries(fields.map((name) => [name, values[name] ?? ''])),
  };
  const registry = createConnectionRegistry({
    store,
    hosts: [
      createSkillHost({ catalog: async () => skillCatalog }),
      createAgentHost({ catalog: async () => assistants }),
    ],
    loadPackage: async (id) => (id === PACKAGE ? loaded : undefined),
    listInstalledPackageIds: async () => (loaded ? [PACKAGE] : []),
    missingRequiredEnv: (_packageId, names) => missingPackageEnv(port, names),
  });
  const turnOn = async (key: string) => {
    const { approvalHash } = await registry.describe(PACKAGE, key);
    return registry.enable(PACKAGE, key, approvalHash);
  };
  return {
    root,
    pkgDir,
    userDir,
    registry,
    skillCatalog,
    assistants,
    values,
    store,
    turnOn,
    uninstall: () => {
      loaded = undefined;
    },
  };
};

describe('package-owned data hosts T2.1/T2.4', () => {
  it('does not import a skill or Assistant before approval, and cleans only its own entries', async () => {
    const run = await setup();
    expect((await run.registry.syncPackage(PACKAGE)).map((item) => item.state.status)).toEqual(['off', 'off']);
    expect(await run.skillCatalog.list()).toEqual([]);
    expect(await run.assistants.list()).toEqual([]);
    expect((await run.turnOn(SKILL_KEY)).installed).toEqual(['demo-skill']);
    expect((await run.turnOn(AGENT_KEY)).installed).toEqual([`package:${PACKAGE}:reviewer`]);
    const imported = (await run.skillCatalog.list()).find((item) => item.name === 'demo-skill');
    expect(imported).toMatchObject({ source: 'package', packageId: PACKAGE });
    const assistant = (await run.assistants.list()).find((item) => item.source === 'package');
    expect(assistant).toMatchObject({
      name: 'Review Agent',
      context: 'Review this code. Do not execute anything.',
      models: [],
      enabled_skills: [],
      packageConnectionKey: AGENT_KEY,
    });
    await expect(run.assistants.update({ id: assistant!.id, name: 'edited' })).rejects.toThrow('read-only');
    await expect(run.assistants.remove(assistant!.id)).rejects.toThrow('read-only');
    const clone = await run.assistants.create({ name: 'My editable clone', context: assistant?.context });
    await run.registry.disable(PACKAGE, AGENT_KEY);
    await run.registry.disable(PACKAGE, SKILL_KEY);
    expect(await run.skillCatalog.list()).toEqual([]);
    expect((await run.assistants.list()).map((row) => row.id)).toEqual([clone.id]);
  });

  it('reports a name collision as needs-input, never overwriting a user skill', async () => {
    const run = await setup({ userSkill: true });
    const result = await run.registry.syncPackage(PACKAGE);
    expect(result.find((entry) => entry.key === SKILL_KEY)?.state).toMatchObject({
      enabled: false,
      status: 'needs-input',
    });
    await expect(run.turnOn(SKILL_KEY)).rejects.toThrow();
    expect(await readFile(path.join(run.userDir, 'my-skill', 'SKILL.md'), 'utf8')).toBe(SKILL);
    expect((await run.skillCatalog.list()).filter((item) => item.source === 'package')).toEqual([]);
  });

  it('reconciles orphaned Skill and Assistant when a package is removed', async () => {
    const run = await setup();
    await run.registry.syncPackage(PACKAGE);
    await run.turnOn(SKILL_KEY);
    await run.turnOn(AGENT_KEY);
    run.uninstall();
    await run.registry.reconcile();
    expect((await run.skillCatalog.list()).filter((item) => item.source === 'package')).toEqual([]);
    expect((await run.assistants.list()).filter((item) => item.source === 'package')).toEqual([]);
    expect(run.store.list()).toEqual([]);
  });

  it('a restarted catalog still sees package origin and cannot edit its assistant', async () => {
    const run = await setup();
    await run.registry.syncPackage(PACKAGE);
    await run.turnOn(SKILL_KEY);
    await run.turnOn(AGENT_KEY);
    const catalogAgain = new NativeSkillCatalog(run.userDir, [], path.join(run.root, 'materialized'));
    const agentsAgain = createAssistantCatalogStore(path.join(run.root, 'assistants.json'));
    expect((await catalogAgain.list())[0]?.source).toBe('package');
    await expect(agentsAgain.setState({ id: `package:${PACKAGE}:reviewer`, enabled: false })).rejects.toThrow(
      'read-only'
    );
  });
});

describe('required environment values T2.5', () => {
  it('does not block inert data connections on unrelated global environment requirements', () => {
    const document = parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: [
        skill,
        agent,
        { kind: 'mcp', id: 'remote', title: 'Remote', transport: 'http', url: 'https://mcp.example.com' },
      ],
      openItems: [{ kind: 'env-value', name: 'GLOBAL_TOKEN', note: 'Configure the service' }],
    });
    expect(requiredConnectionEnv(document, document.connections[0]!)).toEqual([]);
    expect(requiredConnectionEnv(document, document.connections[1]!)).toEqual([]);
    expect(requiredConnectionEnv(document, document.connections[2]!)).toEqual(['GLOBAL_TOKEN']);
  });

  it('stays needs-input until a valid package secret exists; values never reach connection state', async () => {
    const run = await setup({ env: true });
    const initial = await run.registry.syncPackage(PACKAGE);
    expect(initial.find((item) => item.key === AGENT_KEY)?.state).toMatchObject({
      status: 'needs-input',
      enabled: false,
      reason: expect.stringContaining('API_TOKEN'),
    });
    await expect(run.turnOn(AGENT_KEY)).rejects.toThrow();
    run.values.API_TOKEN = '[REDACTED]';
    const ready = await run.registry.view(PACKAGE);
    expect(ready.find((item) => item.key === AGENT_KEY)?.state.status).toBe('off');
    await run.turnOn(AGENT_KEY);
    run.values.API_TOKEN = '';
    const expired = await run.registry.view(PACKAGE);
    expect(expired.find((item) => item.key === AGENT_KEY)?.state.status).toBe('needs-input');
    expect((await run.assistants.list()).filter((row) => row.source === 'package')).toEqual([]);
    expect(JSON.stringify(run.store.list())).not.toContain('private-token');
  });

  it('does not treat an inaccessible, empty or revoked secret as filled', async () => {
    const port = {
      list: async () => [
        { handle: 'secret://denied', label: 'x', fields: ['API_TOKEN'], origin: 'own' as const, updatedAt: 1 },
      ],
      resolve: async (): Promise<Record<string, string>> => {
        throw new Error('revoked');
      },
    };
    expect(await missingPackageEnv(port, ['API_TOKEN'])).toEqual(['API_TOKEN']);
    expect(await missingPackageEnv(port, ['NOT_THERE'])).toEqual(['NOT_THERE']);
  });
});
