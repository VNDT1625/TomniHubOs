/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  createPremiumStarterProject,
  createViuNode,
  normalizeViuImageTransform,
  type ViuProjectState,
  type ViuTransaction,
} from '@/common/viu';
import { registerViuTools } from '@package-apps/design/process/viu/agentTools';
import { ViuV2SessionService } from '@package-apps/design/process/viu/v2SessionService';

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

const titleTransaction = (
  state: ViuProjectState,
  actor: ViuTransaction['actor'],
  origin: ViuTransaction['origin']
): ViuTransaction => ({
  transactionId: `tx-${actor.kind}-title`,
  documentId: state.projectId,
  baseRevision: state.revision,
  actor,
  origin,
  commands: [{ type: 'updateNode', nodeId: 'node-home-title', patch: { name: 'Shared authoring result' } }],
  mode: 'commit',
  summary: 'Apply the same title edit',
});

const createComponentProject = (projectId: string): ViuProjectState => {
  const project = createPremiumStarterProject(projectId);
  const source = structuredClone(project.nodes['node-home-cta']!);
  source.id = 'node-component-source';
  source.parentId = 'node-home-root';
  source.childIds = [];
  source.componentInstance = undefined;
  source.style.fills = [{ id: 'agent-fill', type: 'solid', visible: true, opacity: 1, color: '#123456' }];
  source.style.effects = [
    {
      id: 'agent-shadow',
      type: 'drop-shadow',
      visible: true,
      x: 0,
      y: 4,
      blur: 12,
      spread: 0,
      color: 'rgba(0, 0, 0, 0.3)',
    },
  ];
  project.nodes[source.id] = source;
  const hoverSource = structuredClone(source);
  hoverSource.id = 'node-component-source-hover';
  hoverSource.content = { ...hoverSource.content, text: 'Hover label' };
  project.nodes[hoverSource.id] = hoverSource;
  project.components['component-button-default'] = {
    id: 'component-button-default',
    version: 1,
    name: 'Button / Default',
    rootNodeId: source.id,
    componentSetId: 'component-set-button',
    variantProperties: { state: 'default' },
    propertyDefinitions: {
      label: {
        id: 'label',
        name: 'Label',
        type: 'text',
        targetNodeId: source.id,
        targetProperty: 'content.text',
        defaultValue: 'Default label',
      },
      visible: {
        id: 'visible',
        name: 'Visible',
        type: 'boolean',
        targetNodeId: source.id,
        targetProperty: 'visible',
        defaultValue: true,
      },
    },
  };
  project.components['component-button-hover'] = {
    id: 'component-button-hover',
    version: 1,
    name: 'Button / Hover',
    rootNodeId: hoverSource.id,
    componentSetId: 'component-set-button',
    variantProperties: { state: 'hover' },
    propertyDefinitions: {
      label: {
        id: 'label',
        name: 'Label',
        type: 'text',
        targetNodeId: hoverSource.id,
        targetProperty: 'content.text',
        defaultValue: 'Hover label',
      },
      visible: {
        id: 'visible',
        name: 'Visible',
        type: 'boolean',
        targetNodeId: hoverSource.id,
        targetProperty: 'visible',
        defaultValue: true,
      },
    },
  };
  project.componentSets['component-set-button'] = {
    id: 'component-set-button',
    version: 1,
    name: 'Button',
    componentIds: ['component-button-default', 'component-button-hover'],
    variantAxes: { state: ['default', 'hover'] },
  };
  project.nodes['node-component-instance'] = {
    ...structuredClone(source),
    id: 'node-component-instance',
    name: 'Button instance',
    type: 'component-instance',
    parentId: 'node-home-root',
    componentInstance: {
      componentId: 'component-button-default',
      variantSelection: { state: 'default' },
      propertyValues: { label: 'Agent-visible label', visible: false },
    },
  };
  project.nodes['node-home-root']!.childIds.push(
    'node-component-source',
    'node-component-source-hover',
    'node-component-instance'
  );
  return project;
};

describe('VIU structured agent query', () => {
  it('returns descendant geometry and computed style without mutating the session', async () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'query-project' });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);
    const workspaceKey = 'workspace-query';
    const before = service.inspect(workspaceKey);

    const result = await tools.get('viu_query')!.handler({
      workspaceKey,
      query: {
        descendantsOf: 'node-showcase-card',
        nodeTypes: ['text'],
        source: 'starter',
      },
    });
    const data = parseResult(result).data as {
      revision: number;
      entityIds: string[];
      nodes: Array<{
        id: string;
        absoluteGeometry: { x: number; y: number };
        computedStyle: { fontSize?: number; color?: string };
      }>;
    };

    expect(data).toMatchObject({ revision: 0, entityIds: ['node-showcase-copy'] });
    expect(data.nodes[0]).toMatchObject({
      id: 'node-showcase-copy',
      absoluteGeometry: { x: 152, y: 362 },
      computedStyle: { fontSize: 58, color: '#f0fff7' },
    });
    expect(service.inspect(workspaceKey)).toEqual(before);
  });

  it('projects component identity, resolved variant, and effective property overrides', async () => {
    const service = new ViuV2SessionService({
      createProjectId: () => 'component-query-project',
      createProject: createComponentProject,
    });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);

    const result = await tools.get('viu_query')!.handler({
      workspaceKey: 'workspace-component-query',
      query: { nodeIds: ['node-component-instance'] },
    });
    const payload = parseResult(result);
    expect(payload).toMatchObject({ ok: true });
    const data = payload.data as {
      nodes: Array<{
        componentInstance: {
          componentId: string;
          resolvedComponentId: string;
          componentSetName: string;
          variantSelection: Record<string, string>;
          properties: Array<{ id: string; value: string | boolean; overridden: boolean }>;
          effectiveStyle: { fills?: Array<{ id: string }>; effects?: Array<{ id: string }> };
        };
      }>;
    };

    expect(data.nodes[0]?.componentInstance).toMatchObject({
      componentId: 'component-button-default',
      resolvedComponentId: 'component-button-default',
      componentSetName: 'Button',
      variantSelection: { state: 'default' },
      effectiveStyle: { fills: [{ id: 'agent-fill' }], effects: [{ id: 'agent-shadow' }] },
    });
    expect(data.nodes[0]?.componentInstance.properties).toEqual([
      expect.objectContaining({ id: 'label', value: 'Agent-visible label', overridden: true }),
      expect.objectContaining({ id: 'visible', value: false, overridden: true }),
    ]);
  });

  it('reports missing IDs and redacts workspace or filesystem data in successful projections', async () => {
    const workspaceKey = 'C:\\private\\customer\\repository';
    const service = new ViuV2SessionService({
      createProjectId: () => 'redaction-project',
      createProject: (projectId) => {
        const project = createPremiumStarterProject(projectId);
        project.nodes['node-home-title']!.name = `${workspaceKey}\\secret-title`;
        project.nodes['node-home-title']!.style.background = 'url(file:///C:/Users/customer/private.png)';
        return project;
      },
    });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);

    const result = await tools.get('viu_query')!.handler({
      workspaceKey,
      query: { nodeIds: ['node-home-title', 'missing-node'] },
    });
    const payload = parseResult(result);
    const data = payload.data as {
      diagnostics: Array<{ code: string; entityId?: string }>;
    };

    expect(data.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'node-not-found', entityId: 'missing-node' })
    );
    expect(result.content[0]?.text).not.toContain(workspaceKey);
    expect(result.content[0]?.text).not.toContain('C:/Users/customer');
  });

  it('filters and projects image framing, structured strokes, and canonical quality diagnostics', async () => {
    const service = new ViuV2SessionService({
      createProjectId: () => 'quality-query-project',
      createProject: (projectId) => {
        const project = createPremiumStarterProject(projectId);
        const image = createViuNode({
          id: 'node-quality-image',
          name: 'Quality image',
          type: 'image',
          parentId: 'node-home-root',
          semantics: { role: 'image', label: '' },
        });
        image.imageTransform = normalizeViuImageTransform({ crop: { x: 0.1, width: 0.8 }, rotation: 12 });
        image.style.strokes = [
          {
            id: 'image-stroke',
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
        ];
        project.nodes[image.id] = image;
        project.nodes['node-home-root']!.childIds.push(image.id);
        return project;
      },
    });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);

    const result = await tools.get('viu_query')!.handler({
      workspaceKey: 'workspace-quality-query',
      query: {
        hasImageTransform: true,
        hasStructuredStrokes: true,
        qualityCodes: ['missing-image-label'],
      },
    });
    const data = parseResult(result).data as {
      entityIds: string[];
      nodes: Array<{
        imageTransform: { rotation: number };
        strokes: Array<{ id: string }>;
        qualityDiagnostics: Array<{ code: string }>;
      }>;
    };

    expect(data.entityIds).toEqual(['node-quality-image']);
    expect(data.nodes[0]).toMatchObject({
      imageTransform: { rotation: 12 },
      strokes: [{ id: 'image-stroke' }],
      qualityDiagnostics: [{ code: 'missing-image-label' }],
    });
  });

  it('resolves breakpoint and variable-mode values through the same design-system path as Present', async () => {
    const service = new ViuV2SessionService({
      createProjectId: () => 'responsive-query-project',
      createProject: (projectId) => {
        const project = createPremiumStarterProject(projectId);
        project.variableCollections = {
          ...project.variableCollections,
          'collection-theme': {
            id: 'collection-theme',
            name: 'Theme',
            defaultModeId: 'mode-light',
            modeIds: ['mode-light', 'mode-dark'],
            modes: {
              'mode-light': { id: 'mode-light', name: 'Light', kind: 'light' },
              'mode-dark': { id: 'mode-dark', name: 'Dark', kind: 'dark' },
            },
          },
        };
        project.activeVariableModes = {
          ...project.activeVariableModes,
          'collection-theme': 'mode-light',
        };
        project.variables['surface-color'] = {
          id: 'surface-color',
          name: 'Surface',
          collectionId: 'collection-theme',
          type: 'color',
          valuesByMode: { 'mode-light': '#ffffff', 'mode-dark': '#111111' },
        };
        const title = project.nodes['node-home-title']!;
        title.variableBindings = { 'style.background': { variableId: 'surface-color' } };
        title.responsiveOverrides = {
          mobile: { size: { width: 280 }, style: { fontSize: 24 } },
        };
        return project;
      },
    });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);

    const result = await tools.get('viu_query')!.handler({
      workspaceKey: 'workspace-responsive-query',
      query: {
        nodeIds: ['node-home-title'],
        viewportWidth: 390,
        modeOverrides: { 'collection-theme': 'mode-dark' },
      },
    });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    const data = parseResult(result).data as {
      designResolution: { viewportWidth: number; modeOverrides: Record<string, string> };
      nodes: Array<{
        localGeometry: { width: number };
        computedStyle: { background?: string; fontSize?: number };
        resolvedDesign: {
          breakpoint: { id: string };
          properties: Array<{ property: string; source: string; value: unknown }>;
        };
      }>;
    };

    expect(data.designResolution).toEqual({
      viewportWidth: 390,
      modeOverrides: { 'collection-theme': 'mode-dark' },
    });
    expect(data.nodes[0]).toMatchObject({
      localGeometry: { width: 280 },
      computedStyle: { background: '#111111', fontSize: 24 },
      resolvedDesign: { breakpoint: { id: 'mobile' } },
    });
    expect(data.nodes[0]!.resolvedDesign.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'style.background', source: 'variable', value: '#111111' }),
        expect.objectContaining({ property: 'style', source: 'breakpoint', value: { fontSize: 24 } }),
      ])
    );
  });

  it('filters and projects authored timeline tracks with scroll bindings', async () => {
    const service = new ViuV2SessionService({
      createProjectId: () => 'motion-query-project',
      createProject: (projectId) => {
        const project = createPremiumStarterProject(projectId);
        project.timelines['timeline-query-hero'] = {
          id: 'timeline-query-hero',
          name: 'Query hero motion',
          durationMs: 1_000,
          loop: true,
          tracks: [
            {
              id: 'track-query-hero-opacity',
              nodeId: 'node-home-title',
              property: 'opacity',
              keyframes: [
                { offsetMs: 0, value: 0 },
                { offsetMs: 1_000, value: 1, easing: 'ease-out' },
              ],
            },
          ],
        };
        project.scrollBindings = {
          'binding-query-hero': {
            id: 'binding-query-hero',
            nodeId: 'node-home-title',
            timelineId: 'timeline-query-hero',
            start: 0.15,
            end: 0.85,
            pin: true,
            parallax: 0.25,
          },
        };
        return project;
      },
    });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);

    const result = await tools.get('viu_query')!.handler({
      workspaceKey: 'workspace-motion-query',
      query: { hasTimelineTrack: true, hasScrollBinding: true },
    });
    const data = parseResult(result).data as {
      entityIds: string[];
      nodes: Array<{
        timelineTracks: Array<{ timelineId: string; track: { property: string } }>;
        scrollBindings: Array<{ id: string; pin: boolean; timeline: { id: string } }>;
      }>;
    };

    expect(data.entityIds).toEqual(['node-home-title']);
    expect(data.nodes[0]).toMatchObject({
      timelineTracks: [{ timelineId: 'timeline-query-hero', track: { property: 'opacity' } }],
      scrollBindings: [
        {
          id: 'binding-query-hero',
          pin: true,
          timeline: { id: 'timeline-query-hero' },
        },
      ],
    });
  });

  it('rejects oversized and unknown selectors at the MCP boundary', () => {
    const { server, tools } = fakeServer();
    registerViuTools(server, new ViuV2SessionService());
    const schema = tools.get('viu_query')!.schema.query;

    expect(schema.safeParse({ nodeIds: Array.from({ length: 101 }, (_, index) => `node-${index}`) }).success).toBe(
      false
    );
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
    expect(schema.safeParse({ arbitrarySelector: true }).success).toBe(false);
  });
});

describe('VIU agent runtime scenarios', () => {
  it('produces a deterministic trace digest while leaving project state unchanged', async () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'runtime-agent-project' });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);
    const workspaceKey = 'workspace-runtime';
    const before = service.inspect(workspaceKey);
    const scenario = {
      events: [
        { type: 'activateNode', nodeId: 'node-home-cta' },
        { type: 'setViewport', width: 390, height: 844 },
        { type: 'activateNode', nodeId: 'node-showcase-back' },
      ],
    };

    const first = parseResult(await tools.get('viu_run_runtime_scenario')!.handler({ workspaceKey, scenario }))
      .data as {
      revision: number;
      eventCount: number;
      finalState: { currentRoute: string; viewport: { breakpoint: string } };
      trace: Array<{ sequence: number; status: string }>;
      traceDigest: string;
    };
    const second = parseResult(await tools.get('viu_run_runtime_scenario')!.handler({ workspaceKey, scenario }))
      .data as typeof first;

    expect(first).toMatchObject({
      revision: 0,
      eventCount: 3,
      finalState: { currentRoute: '/', viewport: { breakpoint: 'mobile' } },
    });
    expect(first.trace).toHaveLength(3);
    expect(first.traceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.traceDigest).toBe(first.traceDigest);
    expect(service.inspect(workspaceKey)).toEqual(before);
  });

  it('enforces serializable event and contract bounds', () => {
    const { server, tools } = fakeServer();
    registerViuTools(server, new ViuV2SessionService());
    const schema = tools.get('viu_run_runtime_scenario')!.schema.scenario;

    expect(
      schema.safeParse({
        events: Array.from({ length: 65 }, () => ({ type: 'consumeEffect' })),
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        events: [{ type: 'setViewport', width: 0, height: 900 }],
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        events: [],
        contract: {
          schemaVersion: 1,
          interactions: {
            oversized: {
              action: { type: 'setVariable', variableId: 'variable-a', value: 'x'.repeat(16_385) },
            },
          },
        },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        events: [{ type: 'setScrollProgress', bindingId: 'hero-scroll', progress: 0.5 }],
        contract: {
          schemaVersion: 1,
          nodes: {
            hero: {
              layout: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 24 },
              effects: { backdropBlur: 16, rotateY: 8 },
              responsive: {
                mobile: { layout: { display: 'flex', flexDirection: 'column' } },
              },
              motion: { preset: 'reveal', trigger: 'in-view', durationMs: 480 },
            },
          },
        },
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        events: [{ type: 'executeJavaScript', source: 'alert(1)' }],
      }).success
    ).toBe(false);
  });
});

describe('VIU user and agent authoring parity', () => {
  it('creates a reusable component and instance through one bounded agent transaction', async () => {
    const service = new ViuV2SessionService({ createProjectId: () => 'agent-component-project' });
    const { server, tools } = fakeServer();
    registerViuTools(server, service);
    const workspaceKey = 'workspace-agent-component';
    const before = service.inspect(workspaceKey);
    const source = before.nodes['node-home-cta']!;
    const instance = {
      ...structuredClone(source),
      id: 'node-agent-component-instance',
      version: 1,
      name: 'Agent button instance',
      type: 'component-instance' as const,
      parentId: 'node-home-root',
      childIds: [],
      componentInstance: {
        componentId: 'component-agent-button',
        variantSelection: {},
        propertyValues: { label: 'Created by agent' },
      },
    };
    const transaction: ViuTransaction = {
      transactionId: 'tx-agent-create-component',
      documentId: before.projectId,
      baseRevision: before.revision,
      actor: { id: 'agent-component-author', kind: 'agent' },
      origin: 'agent-tool',
      mode: 'commit',
      summary: 'Create a reusable button and its first instance',
      commands: [
        {
          type: 'createComponent',
          component: {
            id: 'component-agent-button',
            version: 1,
            name: 'Agent button',
            rootNodeId: source.id,
            variantProperties: {},
            propertyDefinitions: {
              label: {
                id: 'label',
                name: 'Label',
                type: 'text',
                targetNodeId: source.id,
                targetProperty: 'content.text',
                defaultValue: 'Default label',
              },
            },
          },
        },
        { type: 'insertNode', node: instance, parentId: 'node-home-root' },
      ],
    };

    const commit = parseResult(await tools.get('viu_commit_transaction')!.handler({ workspaceKey, transaction }))
      .data as { accepted: boolean; revision: number };
    expect(commit).toMatchObject({ accepted: true, revision: 1 });

    const query = parseResult(
      await tools.get('viu_query')!.handler({
        workspaceKey,
        query: { nodeIds: ['node-agent-component-instance'] },
      })
    ).data as { nodes: Array<{ componentInstance: { componentId: string; properties: unknown[] } }> };
    expect(query.nodes[0]?.componentInstance).toMatchObject({
      componentId: 'component-agent-button',
      properties: [expect.objectContaining({ id: 'label', value: 'Created by agent' })],
    });
  });

  it('applies identical commands to identical project state through the shared sequencer', async () => {
    const agentService = new ViuV2SessionService({ createProjectId: () => 'parity-project' });
    const userService = new ViuV2SessionService({ createProjectId: () => 'parity-project' });
    const { server, tools } = fakeServer();
    registerViuTools(server, agentService);
    const workspaceKey = 'parity-workspace';
    const agentBefore = agentService.inspect(workspaceKey);
    const userBefore = userService.inspect(workspaceKey);

    const agentPayload = parseResult(
      await tools.get('viu_commit_transaction')!.handler({
        workspaceKey,
        transaction: titleTransaction(agentBefore, { id: 'agent-designer', kind: 'agent' }, 'agent-tool'),
      })
    ).data as { state: ViuProjectState };
    const userResult = userService.commitTransaction(
      workspaceKey,
      titleTransaction(userBefore, { id: 'user-designer', kind: 'user' }, 'canvas')
    );

    expect(agentPayload.state).toEqual(userResult.state);
    expect(agentService.inspect(workspaceKey)).toEqual(userService.inspect(workspaceKey));
  });

  it('reports exact shipped paths, bounds, and visual limitations', async () => {
    const { server, tools } = fakeServer();
    registerViuTools(server, new ViuV2SessionService({ createProjectId: () => 'capabilities-project' }));

    const result = parseResult(
      await tools.get('viu_get_capabilities')!.handler({ workspaceKey: 'capabilities-workspace' })
    );
    const data = result.data as {
      stateParity: { sharedAuthoritativeDocument: boolean; userMutationPath: string[]; agentMutationPath: string[] };
      agentTools: string[];
      limits: { queryResults: number; runtimeEvents: number };
      limitations: string[];
      componentAuthoring: { commands: string[]; rendererParity: string };
      designSystem: { operations: string[]; variables: string[]; responsive: string; userAgentParity: string };
      prototypeMotion: {
        authoringCommands: string[];
        actions: string[];
        conditions: string[];
        timelines: string[];
        rendererParity: string;
      };
      runtimeScenario: { events: string[]; outputs: string[] };
      query: { projection: string[] };
    };

    expect(data.stateParity).toMatchObject({ sharedAuthoritativeDocument: true });
    expect(data.stateParity.userMutationPath).toContain('ide.viu.v2.commit');
    expect(data.stateParity.agentMutationPath).toContain('viu_commit_transaction');
    expect(data.agentTools).toContain('viu_run_runtime_scenario');
    expect(data.componentAuthoring.commands).toContain('createComponent');
    expect(data.componentAuthoring.rendererParity).toContain('resolveViuComponentInstance');
    expect(data.designSystem.operations).toContain('setResponsiveOverride');
    expect(data.designSystem.operations).toContain('snapPoint');
    expect(data.designSystem.variables).toEqual(['color', 'number', 'string', 'boolean']);
    expect(data.designSystem.userAgentParity).toContain('same authoritative commands');
    expect(data.prototypeMotion.authoringCommands).toContain('upsertScrollBinding');
    expect(data.prototypeMotion.actions).toContain('seekTimeline');
    expect(data.prototypeMotion.conditions).toContain('truthy');
    expect(data.prototypeMotion.timelines).toContain('scroll-scrub');
    expect(data.prototypeMotion.rendererParity).toContain('same project');
    expect(data.runtimeScenario.events).toContain('setScrollProgress');
    expect(data.runtimeScenario.outputs).toContain('timeline and scroll-linked state');
    expect(data.query.projection).toContain('component, variant, and effective property values');
    expect(data.query.projection).toContain('timeline tracks and scroll bindings');
    expect(data.limits).toEqual(expect.objectContaining({ queryResults: 200, runtimeEvents: 64 }));
    expect(data.limitations.some((item) => item.includes('raster screenshot'))).toBe(true);
  });
});
