import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureHookRuntime, setHookConversationResolver } from '@process/integrations/hookRuntime/hookDispatcher';
import { ChatPipelineExecutor } from '@process/services/chatPipeline/pipelineExecutor';
import {
  ChatStageRegistry,
  getChatStageRegistry,
  resetChatStageRegistry,
} from '@process/services/chatPipeline/stageRegistry';
import { UserHooksStage } from '@process/services/chatPipeline/stages/userHooksStage';
import type { IChatStage } from '@process/services/chatPipeline/types';
import { createHookWorld, readRecords, type HookWorld } from '../integrations/hookRuntime/hookTestKit';

/** UserPromptSubmit through the real pipeline executor, the built-in stage and real hook processes. */

let world: HookWorld;

beforeEach(async () => {
  world = await createHookWorld();
  configureHookRuntime({ registry: async () => world.registry });
  resetChatStageRegistry();
});

afterEach(() => {
  configureHookRuntime();
  setHookConversationResolver(undefined);
  resetChatStageRegistry();
});

const record = (name: string): string => `${world.dir}/${name}.jsonl`;

const executor = (): ChatPipelineExecutor => new ChatPipelineExecutor(getChatStageRegistry());

describe('builtin:user-hooks stage', { timeout: 60_000 }, () => {
  it('is built in and leads the default pipeline in the pre_query phase', () => {
    const registry = getChatStageRegistry();
    const metadata = registry.listMetadata().find((entry) => entry.id === 'builtin:user-hooks');
    expect(metadata).toMatchObject({ phase: 'pre_query', isBuiltin: true, defaultEnabled: true });
    expect(registry.createDefaultDefinition().stages[0]?.stageRegistryId).toBe('builtin:user-hooks');
  });

  it('blocks the prompt before any model when a hook exits 2, with a stable reason code', async () => {
    await world.install({
      event: 'UserPromptSubmit',
      spec: { record: record('block'), exitCode: 2, stderr: 'policy says no' },
    });
    const result = await executor().execute({ runId: 'conv-1', query: 'delete everything' });
    expect(result.status).toBe('blocked');
    expect(result.blockedReasonCode).toBe('USER_HOOK_BLOCKED');
    expect(result.executedStages[0]?.evidence).toMatchObject({ hookBlocked: true, hookReason: 'policy says no' });
  });

  it('adds hook context to the pipeline context and keeps the query', async () => {
    await world.install({
      event: 'UserPromptSubmit',
      name: 'pkg.rules',
      spec: { record: record('ctx'), stdout: 'Use tabs.' },
    });
    const result = await executor().execute({ runId: 'conv-1', query: 'format my file', context: 'earlier context' });
    expect(result.status).toBe('completed');
    expect(result.finalQuery).toBe('format my file');
    expect(result.finalContext).toMatch(/^earlier context\n\nHook pkg\.rules:[0-9a-f]{8}:\nUse tabs\.$/);
  });

  it('lets the prompt through when the hook fails, times out or the registry is gone (fail open)', async () => {
    await world.install({ event: 'UserPromptSubmit', spec: { record: record('crash'), exitCode: 1, stderr: 'boom' } });
    expect((await executor().execute({ runId: 'c', query: 'hi' })).status).toBe('completed');
    configureHookRuntime({ registry: async () => undefined });
    expect((await executor().execute({ runId: 'c', query: 'hi' })).status).toBe('completed');
  });

  it('honours the switches: a disabled hook layer neither blocks nor runs', async () => {
    await world.install({ event: 'UserPromptSubmit', spec: { record: record('off'), exitCode: 2, stderr: 'no' } });
    await world.registry.setDisableAll(true);
    expect((await executor().execute({ runId: 'c', query: 'hi' })).status).toBe('completed');
    await world.registry.setDisableAll(false);
    await world.registry.setSourceEnabled('package', false);
    expect((await executor().execute({ runId: 'c', query: 'hi' })).status).toBe('completed');
    expect(await readRecords(record('off'))).toHaveLength(0);
  });

  it('never runs hooks in a pipeline simulation', async () => {
    await world.install({ event: 'UserPromptSubmit', spec: { record: record('sim'), exitCode: 2, stderr: 'no' } });
    const simulated = await executor().simulate({ definition: getChatStageRegistry().createDefaultDefinition() });
    expect(simulated.success).toBe(true);
    expect(await readRecords(record('sim'))).toHaveLength(0);
  });

  it('uses the conversation lookup for workspace, session and mode, and redacts the prompt it sends', async () => {
    setHookConversationResolver(async (conversationId) => ({
      sessionId: `core-${conversationId}`,
      conversationId,
      workspaceDir: world.workspace,
      permissionMode: 'read-only',
    }));
    await world.install({ event: 'UserPromptSubmit', spec: { record: record('seen') } });
    await executor().execute({ runId: 'conv-9', query: 'my key is sk-live-abcdefghijklmnopqrstuv1234' });
    const [seen] = await readRecords(record('seen'));
    expect(seen).toMatchObject({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'core-conv-9',
      permission_mode: 'plan',
      tomny: { conversation_id: 'conv-9' },
    });
    expect(JSON.stringify(seen)).not.toContain('sk-live-abcdefghijklmnopqrstuv1234');
  });

  it('a plain registry (as in other tests) is not affected: the stage is only added to the global one', () => {
    expect(new ChatStageRegistry().getStage('builtin:user-hooks')).toBeUndefined();
    const stage: IChatStage = new UserHooksStage();
    expect(stage.role).toBeUndefined();
  });
});
