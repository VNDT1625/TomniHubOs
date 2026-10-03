import { describe, expect, it } from 'vitest';
import {
  ChatPipelineExecutor,
  ChatStageRegistry,
  DirectActionStage,
  type ChatPipelineDefinition,
} from '@/process/services/chatPipeline';
import type { LayaPredictor } from '@/process/services/security';

describe('DirectActionStage (Zero-LLM Direct Action)', () => {
  it('detects raw GitHub URL via pattern and returns direct_action decision', async () => {
    const stage = new DirectActionStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-1',
      stageId: 'builtin:direct-action',
      query: 'https://github.com/facebook/react',
    });

    expect(result.decision).toBe('direct_action');
    expect(result.grounding?.directAction).toEqual({
      actionType: 'open_url',
      target: 'https://github.com/facebook/react',
      provider: 'system_browser',
      metadata: { isGitHub: true },
    });
  });

  it('detects Vietnamese GitHub phrase "mở link github abc/xyz"', async () => {
    const stage = new DirectActionStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-2',
      stageId: 'builtin:direct-action',
      query: 'mở link github.com/VNDT1625/tomni-hub-agent-os',
    });

    expect(result.decision).toBe('direct_action');
    expect(result.grounding?.directAction).toMatchObject({
      actionType: 'open_url',
      target: 'https://github.com/VNDT1625/tomni-hub-agent-os',
      metadata: { isGitHub: true },
    });
  });

  it('detects local file opening request', async () => {
    const stage = new DirectActionStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-3',
      stageId: 'builtin:direct-action',
      query: 'mở file src/process/index.ts',
    });

    expect(result.decision).toBe('direct_action');
    expect(result.grounding?.directAction).toEqual({
      actionType: 'open_file',
      target: 'src/process/index.ts',
      provider: 'system_ide',
    });
  });

  it('passes through normal conversational question as continue', async () => {
    const stage = new DirectActionStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-4',
      stageId: 'builtin:direct-action',
      query: 'hãy giải thích cơ chế event loop trong javascript',
    });

    expect(result.decision).toBe('continue');
    expect(result.grounding?.directAction).toBeUndefined();
  });

  it('uses Laya neural predictor to classify direct action intent', async () => {
    const mockPredictor: LayaPredictor = async () => ({
      answers: {
        directAction: { choice: 'open_github', confidence: 0.98 },
      },
    });

    const stage = new DirectActionStage(mockPredictor);
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-5',
      stageId: 'builtin:direct-action',
      query: 'ghé thăm kho chứa https://github.com/torvalds/linux nhé',
    });

    expect(result.decision).toBe('direct_action');
    expect(result.evidence?.method).toBe('laya_neural');
  });

  it('detects /repotopackage slash command with remote url and returns 4-step visualization metadata', async () => {
    const stage = new DirectActionStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-repo-1',
      stageId: 'builtin:direct-action',
      query: '/repotopackage https://github.com/facebook/react',
    });

    expect(result.decision).toBe('direct_action');
    expect(result.grounding?.directAction).toMatchObject({
      actionType: 'repotopackage',
      target: 'https://github.com/facebook/react',
      metadata: {
        isRepoToPackage: true,
        steps: expect.arrayContaining([
          expect.stringContaining('1. Fetch and scan'),
          expect.stringContaining('2. Classify package archetype'),
          expect.stringContaining('3. Run Laya static'),
          expect.stringContaining('4. Generate Ed25519 signed'),
        ]),
      },
    });
  });

  it('detects /repotopackage slash command with local path', async () => {
    const stage = new DirectActionStage();
    const result = await stage.execute({
      schemaVersion: 1,
      runId: 'run-da-repo-2',
      stageId: 'builtin:direct-action',
      query: '/repotopackage ./packages/package-apps/ide',
    });

    expect(result.decision).toBe('direct_action');
    expect(result.grounding?.directAction).toMatchObject({
      actionType: 'repotopackage',
      target: './packages/package-apps/ide',
    });
  });

  it('short-circuits pipeline execution in ChatPipelineExecutor when direct action is detected', async () => {
    const registry = new ChatStageRegistry();
    const directActionStage = new DirectActionStage();
    registry.registerBuiltin(directActionStage);

    let secondStageExecuted = false;
    registry.registerBuiltin({
      id: 'mock:second-stage',
      displayName: 'Second Stage',
      description: 'Should be bypassed by short-circuit',
      phase: 'pre_model',
      defaultEnabled: true,
      async execute() {
        secondStageExecuted = true;
        return { decision: 'continue' };
      },
    });

    const pipelineDef: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'pipeline-da',
      name: 'Direct Action Pipeline',
      enabled: true,
      stages: [
        { id: 's1', stageRegistryId: 'builtin:direct-action', phase: 'pre_model', enabled: true },
        { id: 's2', stageRegistryId: 'mock:second-stage', phase: 'pre_model', enabled: true },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      definition: pipelineDef,
      query: 'https://github.com/microsoft/typescript',
      runId: 'run-da-shortcircuit',
    });

    expect(result.status).toBe('direct_action');
    expect(result.directActionPayload).toMatchObject({
      actionType: 'open_url',
      target: 'https://github.com/microsoft/typescript',
    });
    expect(secondStageExecuted).toBe(false);
    expect(result.executedStages).toHaveLength(1);
  });
});
