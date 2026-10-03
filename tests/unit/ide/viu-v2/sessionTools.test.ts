/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  createDefaultViuVectorGeometry,
  createViuMaskGeometry,
  viuFrameLeaseKey,
  type ViuProjectState,
  type ViuTransaction,
} from '@/common/viu';
import { registerViuTools, type ViuTeamWorkflowService } from '@package-apps/design/process/viu/agentTools';
import { ViuV2SessionService, type ViuV2SessionServiceApi } from '@package-apps/design/process/viu/v2SessionService';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler = (input: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

type RegisteredTool = {
  description: string;
  schema: Record<string, ZodTypeAny>;
  handler: ToolHandler;
};

const fakeServer = (): { server: McpServer; tools: Map<string, RegisteredTool> } => {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool: (name: string, description: string, schema: Record<string, ZodTypeAny>, handler: ToolHandler): void => {
      tools.set(name, { description, schema, handler });
    },
  };
  return { server: server as unknown as McpServer, tools };
};

const parseResult = (result: ToolResult): Record<string, unknown> =>
  JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;

const fakeTeamWorkflow = (): ViuTeamWorkflowService => {
  const leases = new Map<string, { relPath: string; agentId: string; expiresAt: number }>();
  return {
    claim: (_rootPath, agentId, relPath) => {
      const held = leases.get(relPath);
      if (held && held.agentId !== agentId) return { ok: false as const, reason: 'held' as const, lease: held };
      const lease = { relPath, agentId, expiresAt: Date.now() + 60_000 };
      leases.set(relPath, lease);
      return { ok: true as const, lease, renewed: Boolean(held) };
    },
    release: (_rootPath, agentId, relPath) => {
      if (leases.get(relPath)?.agentId !== agentId) return false;
      return leases.delete(relPath);
    },
    snapshot: () => ({
      leases: [...leases.values()],
      tasks: [
        {
          id: 'team-task-home',
          assigneeId: 'agent-home',
          pinnedAgentId: null,
          status: 'in_progress',
        },
      ],
    }),
  };
};

const updateTitleTransaction = (
  state: ViuProjectState,
  mode: ViuTransaction['mode'],
  baseRevision = state.revision
): ViuTransaction => ({
  transactionId: `tx-${mode}-${baseRevision}`,
  documentId: state.projectId,
  baseRevision,
  actor: { id: 'agent-designer', kind: 'agent' },
  origin: 'agent-tool',
  commands: [
    {
      type: 'updateNode',
      nodeId: 'node-home-title',
      patch: { name: `Agent title at revision ${baseRevision}` },
    },
  ],
  mode,
  summary: 'Refine the home hero title',
});

describe('VIU V2 session service', () => {
  it('creates isolated workspace sessions and never exposes mutable authoritative state', () => {
    let sequence = 0;
    const service = new ViuV2SessionService({ createProjectId: () => `project-${++sequence}` });
    const first = service.inspect('workspace-a');
    first.title = 'External mutation';

    const sameWorkspace = service.inspect('workspace-a');
    const otherWorkspace = service.inspect('workspace-b');

    expect(sameWorkspace.title).not.toBe('External mutation');
    expect(sameWorkspace.projectId).toBe('project-1');
    expect(otherWorkspace.projectId).toBe('project-2');
  });

  it('previews a complete candidate without mutating the authoritative revision', () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'preview-project' });
    const before = service.inspect('workspace-preview');
    const result = service.previewTransaction('workspace-preview', updateTitleTransaction(before, 'preview'));
    const after = service.inspect('workspace-preview');

    expect(result.accepted).toBe(true);
    expect(result.state.nodes['node-home-title']?.name).toBe('Agent title at revision 0');
    expect(after.nodes['node-home-title']?.name).toBe('Hero title');
    expect(after.revision).toBe(0);
  });

  it('commits once and rejects a stale transaction without changing accepted state', () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'commit-project' });
    const before = service.inspect('workspace-commit');
    const committed = service.commitTransaction('workspace-commit', updateTitleTransaction(before, 'commit'));
    const stale = service.commitTransaction('workspace-commit', updateTitleTransaction(before, 'commit', 0));
    const after = service.inspect('workspace-commit');

    expect(committed.accepted).toBe(true);
    expect(committed.revision).toBe(1);
    expect(stale).toMatchObject({ accepted: false, conflict: { kind: 'revision' } });
    expect(after.nodes['node-home-title']?.name).toBe('Agent title at revision 0');
    expect(after.revision).toBe(1);
  });

  it('rolls back a structurally applied transaction when product validation reports an error', () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'atomic-project' });
    const before = service.inspect('workspace-atomic');
    const transaction: ViuTransaction = {
      transactionId: 'tx-invalid-target',
      documentId: before.projectId,
      baseRevision: before.revision,
      actor: { id: 'agent-designer', kind: 'agent' },
      origin: 'agent-tool',
      commands: [
        {
          type: 'connectInteraction',
          interaction: {
            id: 'interaction-missing-target',
            version: 1,
            flowId: 'flow-primary',
            sourceNodeId: 'node-home-cta',
            trigger: 'click',
            action: { type: 'navigate', targetScreenId: 'screen-missing' },
          },
        },
      ],
      mode: 'commit',
      summary: 'Connect a deliberately invalid route',
    };

    const result = service.commitTransaction('workspace-atomic', transaction);
    const after = service.inspect('workspace-atomic');

    expect(result).toMatchObject({ accepted: false, conflict: { kind: 'validation' }, revision: 0 });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-interaction-target', severity: 'error' })
    );
    expect(after.interactions['interaction-missing-target']).toBeUndefined();
  });

  it('returns a compact validation status for the authoritative revision', () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'validate-project' });

    expect(service.validate('workspace-validate')).toEqual({ valid: true, revision: 0, diagnostics: [] });
  });

  it('stores only frame-scoped contributions and atomically commits a complete reviewed plan', () => {
    const service = new ViuV2SessionService({
      createProjectId: () => 'frame-session-project',
      now: () => 1_500,
    });
    const workspaceKey = 'workspace-frame-session';
    const state = service.inspect(workspaceKey);
    const leaseKey = viuFrameLeaseKey(state.projectId, 'screen-home');
    const session = service.createFramePlan(workspaceKey, {
      planId: 'plan-home',
      createdAt: 1_000,
      createdBy: 'user-owner',
      assignments: [
        {
          assignmentId: 'assignment-home',
          agentId: 'agent-home',
          screenId: 'screen-home',
          teamTaskId: 'task-home',
          lease: {
            leaseKey,
            holderId: 'agent-home',
            acquiredAt: 1_000,
            expiresAt: 10_000,
          },
        },
      ],
    });
    const transaction = (nodeId: string, transactionId: string): ViuTransaction => ({
      transactionId,
      documentId: state.projectId,
      baseRevision: state.revision,
      actor: { id: 'agent-home', kind: 'agent' },
      origin: 'agent-tool',
      commands: [{ type: 'updateNode', nodeId, patch: { name: 'Frame-authored title' } }],
      mode: 'commit',
      summary: 'Author assigned frame',
    });

    const rejected = service.submitFrameContribution(workspaceKey, session.plan.planId, {
      assignmentId: 'assignment-home',
      leaseKey,
      transaction: transaction('node-showcase-title', 'tx-outside-frame'),
    });
    expect(rejected.review).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: 'scope-violation' })],
    });
    expect(rejected.session.submittedAssignmentIds).toEqual([]);

    const submitted = service.submitFrameContribution(workspaceKey, session.plan.planId, {
      assignmentId: 'assignment-home',
      leaseKey,
      transaction: transaction('node-home-title', 'tx-home-frame'),
    });
    expect(submitted.review).toMatchObject({ accepted: true, complete: true });
    expect(service.inspect(workspaceKey).revision).toBe(0);

    const committed = service.commitFramePlan(workspaceKey, session.plan.planId);
    expect(committed).toMatchObject({ accepted: true, complete: true, revision: 1 });
    expect(service.inspect(workspaceKey).nodes['node-home-title']?.name).toBe('Frame-authored title');
    expect(service.getFramePlan(workspaceKey, session.plan.planId)).toMatchObject({
      status: 'committed',
      committedRevision: 1,
    });
  });
});

describe('VIU agent MCP tools', () => {
  it('registers transaction and frame-workflow tools with strict command validation', () => {
    const { server, tools } = fakeServer();
    registerViuTools(server, new ViuV2SessionService());
    const state = new ViuV2SessionService({ createProjectId: () => 'schema-project' }).inspect('schema-workspace');
    const previewSchema = tools.get('viu_preview_transaction')!.schema.transaction;

    expect([...tools.keys()]).toEqual([
      'viu_inspect',
      'viu_query',
      'viu_preview_transaction',
      'viu_commit_transaction',
      'viu_validate',
      'viu_run_runtime_scenario',
      'viu_get_capabilities',
      'viu_create_frame_plan',
      'viu_get_frame_plan',
      'viu_claim_frame',
      'viu_submit_frame_contribution',
      'viu_review_frame_plan',
      'viu_commit_frame_plan',
    ]);
    expect(previewSchema.safeParse(updateTitleTransaction(state, 'commit')).success).toBe(false);
    expect(
      previewSchema.safeParse({
        ...updateTitleTransaction(state, 'preview'),
        commands: [{ type: 'updateNode', patch: { name: 'Missing node id' } }],
      }).success
    ).toBe(false);

    const maskGeometry = createViuMaskGeometry(
      [
        { id: 'content', geometry: createDefaultViuVectorGeometry(120, 100) },
        { id: 'mask', geometry: createDefaultViuVectorGeometry(60, 60) },
      ],
      'alpha'
    );
    const validMaskTransaction = {
      ...updateTitleTransaction(state, 'preview'),
      commands: [{ type: 'updateNode', nodeId: 'node-home-title', patch: { vector: maskGeometry } }],
    };
    expect(previewSchema.safeParse(validMaskTransaction).success).toBe(true);

    const invalidMaskTransaction = structuredClone(validMaskTransaction);
    invalidMaskTransaction.commands[0]!.patch.vector.maskOperation!.maskOperandId = 'missing';
    expect(previewSchema.safeParse(invalidMaskTransaction).success).toBe(false);

    const oversizedGeometry = createDefaultViuVectorGeometry(120, 100);
    const templatePoint = oversizedGeometry.points[0]!;
    const oversizedContours = Array.from({ length: 2 }, (_, contourIndex) => ({
      id: `oversized-contour-${contourIndex}`,
      closed: true,
      points: Array.from({ length: 5_001 }, (_, pointIndex) => ({
        ...templatePoint,
        id: `oversized-point-${contourIndex}-${pointIndex}`,
        x: pointIndex,
        y: contourIndex,
      })),
    }));
    oversizedGeometry.contours = oversizedContours;
    oversizedGeometry.points = oversizedContours[0]!.points;
    const oversizedVectorTransaction = {
      ...updateTitleTransaction(state, 'preview'),
      commands: [{ type: 'updateNode', nodeId: 'node-home-title', patch: { vector: oversizedGeometry } }],
    };
    expect(previewSchema.safeParse(oversizedVectorTransaction).success).toBe(false);

    const qualityAuthoringTransaction = {
      ...updateTitleTransaction(state, 'preview'),
      commands: [
        {
          type: 'updateNode',
          nodeId: 'node-home-title',
          patch: {
            imageTransform: {
              fit: 'cover',
              crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
              focalPoint: { x: 0.5, y: 0.5 },
              rotation: 12,
              flipHorizontal: false,
              flipVertical: true,
            },
            style: {
              strokes: [
                {
                  id: 'agent-stroke',
                  visible: true,
                  opacity: 1,
                  color: '#123456',
                  width: 2,
                  alignment: 'outside',
                  cap: 'round',
                  join: 'bevel',
                  miterLimit: 4,
                  dashPattern: [8, 4],
                  dashOffset: 2,
                },
              ],
              borderRadii: [4, 8, 12, 16],
              strokeAlignment: 'outside',
            },
          },
        },
      ],
    };
    expect(previewSchema.safeParse(qualityAuthoringTransaction).success).toBe(true);

    const invalidQualityAuthoring = structuredClone(qualityAuthoringTransaction);
    invalidQualityAuthoring.commands[0]!.patch.imageTransform.crop.x = 0.5;
    invalidQualityAuthoring.commands[0]!.patch.imageTransform.crop.width = 0.8;
    invalidQualityAuthoring.commands[0]!.patch.style.strokes[0]!.dashPattern = [0, 0];
    expect(previewSchema.safeParse(invalidQualityAuthoring).success).toBe(false);

    const designSystemTransaction = {
      ...updateTitleTransaction(state, 'preview'),
      commands: [
        {
          type: 'upsertVariableCollection',
          collection: {
            id: 'collection-theme',
            name: 'Theme',
            defaultModeId: 'mode-light',
            modeIds: ['mode-light', 'mode-dark'],
            modes: {
              'mode-light': { id: 'mode-light', name: 'Light', kind: 'light' },
              'mode-dark': { id: 'mode-dark', name: 'Dark', kind: 'dark' },
            },
          },
        },
        {
          type: 'upsertVariable',
          variable: {
            id: 'surface-color',
            name: 'Surface',
            collectionId: 'collection-theme',
            type: 'color',
            valuesByMode: { 'mode-light': '#ffffff', 'mode-dark': '#111111' },
          },
        },
        {
          type: 'upsertBreakpoint',
          breakpoint: { id: 'wide', name: 'Wide', preset: 'desktop', minWidth: 1280 },
        },
        {
          type: 'setGuides',
          guides: [{ id: 'guide-center', axis: 'vertical', position: 720 }],
        },
      ],
    };
    expect(previewSchema.safeParse(designSystemTransaction).success).toBe(true);

    const orderedInteractionTransaction = {
      ...updateTitleTransaction(state, 'preview'),
      commands: [
        {
          type: 'connectInteraction',
          interaction: {
            id: 'interaction-agent-ordered',
            version: 1,
            flowId: 'flow-primary',
            sourceNodeId: 'node-home-cta',
            trigger: 'click',
            action: { type: 'setVariable', variableId: 'menu-open', value: true },
            actions: [
              { type: 'toggleVariable', variableId: 'menu-open' },
              { type: 'pauseTimeline', timelineId: 'timeline-hero' },
              { type: 'seekTimeline', timelineId: 'timeline-hero', offsetMs: 240 },
              { type: 'navigate', targetScreenId: 'screen-showcase' },
            ],
            condition: { variableId: 'menu-enabled', operator: 'truthy' },
            transition: { preset: 'smart-animate', durationMs: 320, easing: 'ease-out' },
          },
        },
      ],
    };
    expect(previewSchema.safeParse(orderedInteractionTransaction).success).toBe(true);

    const motionAuthoringTransaction = {
      ...updateTitleTransaction(state, 'preview'),
      commands: [
        {
          type: 'createTimeline',
          timeline: {
            id: 'timeline-agent-hero',
            name: 'Agent hero reveal',
            durationMs: 1_200,
            loop: true,
            tracks: [
              {
                id: 'track-agent-hero-y',
                nodeId: 'node-home-title',
                property: 'y',
                keyframes: [
                  { offsetMs: 0, value: 48, easing: 'ease-out' },
                  { offsetMs: 1_200, value: 0 },
                ],
              },
            ],
          },
        },
        {
          type: 'upsertScrollBinding',
          binding: {
            id: 'binding-agent-hero',
            nodeId: 'node-home-title',
            timelineId: 'timeline-agent-hero',
            start: 0.1,
            end: 0.9,
            pin: true,
            parallax: 0.35,
          },
        },
      ],
    };
    expect(previewSchema.safeParse(motionAuthoringTransaction).success).toBe(true);

    const invalidMotionAuthoring = structuredClone(motionAuthoringTransaction);
    invalidMotionAuthoring.commands[0]!.timeline.tracks[0]!.keyframes = [
      { offsetMs: 1_200, value: 0 },
      { offsetMs: 0, value: 48 },
    ];
    invalidMotionAuthoring.commands[1]!.binding.start = 0.9;
    invalidMotionAuthoring.commands[1]!.binding.end = 0.1;
    expect(previewSchema.safeParse(invalidMotionAuthoring).success).toBe(false);
  });

  it('returns JSON from inspect without echoing the workspace key', async () => {
    const { server, tools } = fakeServer();
    registerViuTools(server, new ViuV2SessionService({ createProjectId: () => 'tool-project' }));
    const workspaceKey = 'C:\\private\\customer\\repository';
    const result = await tools.get('viu_inspect')!.handler({ workspaceKey });
    const payload = parseResult(result);

    expect(payload.ok).toBe(true);
    expect(payload).toHaveProperty('data.schemaVersion', 3);
    expect(result.content[0]?.text).not.toContain(workspaceKey);
  });

  it('keeps preview read-only and commits through the injected session service', async () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'tool-transaction-project' });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);
    const workspaceKey = 'workspace-tools';
    const initial = service.inspect(workspaceKey);

    const previewTransaction = updateTitleTransaction(initial, 'preview');
    const preview = parseResult(
      await tools.get('viu_preview_transaction')!.handler({ workspaceKey, transaction: previewTransaction })
    );
    expect(preview).toHaveProperty('data.accepted', true);
    expect(service.inspect(workspaceKey).revision).toBe(0);

    const commitTransaction = updateTitleTransaction(initial, 'commit');
    const committed = parseResult(
      await tools.get('viu_commit_transaction')!.handler({ workspaceKey, transaction: commitTransaction })
    );
    expect(committed).toHaveProperty('data.revision', 1);
    expect(service.inspect(workspaceKey).revision).toBe(1);
  });

  it('coordinates a Team task and frame lease through the MCP plan workflow', async () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'mcp-frame-project' });
    const team = fakeTeamWorkflow();
    const { server, tools } = fakeServer();
    registerViuTools(server, service, team);
    const workspaceKey = 'workspace-mcp-frame';
    const state = service.inspect(workspaceKey);

    const created = parseResult(
      await tools.get('viu_create_frame_plan')!.handler({
        workspaceKey,
        planId: 'plan-mcp-home',
        createdBy: 'user-owner',
        assignments: [
          {
            assignmentId: 'assignment-mcp-home',
            agentId: 'agent-home',
            screenId: 'screen-home',
            teamTaskId: 'team-task-home',
          },
        ],
      })
    );
    expect(created).toHaveProperty('data.plan.assignments.0.teamTaskId', 'team-task-home');

    const leaseKey = viuFrameLeaseKey(state.projectId, 'screen-home');
    const contribution = {
      assignmentId: 'assignment-mcp-home',
      leaseKey,
      transaction: {
        transactionId: 'tx-mcp-frame',
        documentId: state.projectId,
        baseRevision: state.revision,
        actor: { id: 'agent-home', kind: 'agent' as const },
        origin: 'agent-tool' as const,
        commands: [
          {
            type: 'updateNode' as const,
            nodeId: 'node-home-title',
            patch: { content: { text: 'Team-authored home' } },
          },
        ],
        mode: 'commit' as const,
        summary: 'Author Team home frame',
      },
    };
    const submitted = parseResult(
      await tools.get('viu_submit_frame_contribution')!.handler({
        workspaceKey,
        planId: 'plan-mcp-home',
        contribution,
      })
    );
    expect(submitted).toHaveProperty('data.review.accepted', true);

    const reviewed = parseResult(
      await tools.get('viu_review_frame_plan')!.handler({ workspaceKey, planId: 'plan-mcp-home' })
    );
    expect(reviewed).toHaveProperty('data.complete', true);
    expect(service.inspect(workspaceKey).revision).toBe(0);

    const committed = parseResult(
      await tools.get('viu_commit_frame_plan')!.handler({ workspaceKey, planId: 'plan-mcp-home' })
    );
    expect(committed).toHaveProperty('data.revision', 1);
    expect(service.inspect(workspaceKey).nodes['node-home-title']?.content?.text).toBe('Team-authored home');
  });

  it('fails closed when the reviewed Design lifecycle has been cancelled', async () => {
    const { server, tools } = fakeServer();
    let active = true;
    registerViuTools(server, new ViuV2SessionService(), undefined, () => active);

    active = false;
    const result = await tools.get('viu_inspect')!.handler({ workspaceKey: 'revoked-design-session' });
    const payload = parseResult(result);

    expect(result.isError).toBe(true);
    expect(payload).toHaveProperty('error.code', 'viu_tool_error');
    expect(result.content[0]?.text).toContain('no longer active');
  });

  it('returns redacted JSON errors from an injected service', async () => {
    const workspaceKey = 'C:\\private\\customer\\repo';
    const fail = (): never => {
      throw new Error(`Unable to open ${workspaceKey}\\secret.glb`);
    };
    const failingService: ViuV2SessionServiceApi = {
      inspect: fail,
      previewTransaction: fail,
      commitTransaction: fail,
      validate: fail,
      createFramePlan: fail,
      getFramePlan: fail,
      refreshFrameLease: fail,
      submitFrameContribution: fail,
      reviewFramePlan: fail,
      commitFramePlan: fail,
    };
    const { server, tools } = fakeServer();
    registerViuTools(server, failingService);

    const result = await tools.get('viu_validate')!.handler({ workspaceKey });
    const payload = parseResult(result);

    expect(result.isError).toBe(true);
    expect(payload).toHaveProperty('error.code', 'viu_tool_error');
    expect(result.content[0]?.text).not.toContain(workspaceKey);
    expect(result.content[0]?.text).toContain('[workspace]');
  });
});
