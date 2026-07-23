import type { SurfaceCapabilityBinding, SurfaceManifest, SurfacePermissionMode } from './types';

const ALL_PERMISSION_MODES: SurfacePermissionMode[] = ['read-only', 'workspace-write', 'full-access'];
const BASE_CONTEXT = ['agent', 'personal', 'conversation', 'surface'] as const;
const AGENT_ORCHESTRATOR_TOOLS = [
  'agent_targets',
  'agent_spawn',
  'agent_research_plan',
  'agent_research_spawn',
  'agent_execute',
  'agent_track',
  'agent_result',
  'agent_resume',
  'agent_message',
  'agent_cancel',
  'agent_sessions',
  'agent_close',
];

const createSecretContextCapability = (): SurfaceCapabilityBinding => ({
  id: 'core.secret-context',
  label: 'Tomny Core Secret Firewall',
  kind: 'mcp',
  providerId: 'builtin.secret-context',
  serverName: 'aionui-secret-context',
  toolPatterns: ['agent_secret_context_use', 'secret_context_capture', 'secret_context_generate'],
  optional: true,
  minimumPermissionMode: 'workspace-write',
  // The trusted host enforces exact source/destination policies. Repeated UI
  // approval would make unattended workflows impossible without adding a
  // second security boundary.
  requireExplicitGrant: false,
});

const createCoreCapabilities = (options: { requireOrchestrator?: boolean } = {}): SurfaceCapabilityBinding[] => [
  {
    id: 'core.skill-workflow',
    label: 'Tomny Skill Workflow',
    kind: 'mcp',
    providerId: 'builtin.tool-selector',
    serverName: 'aionui-tool-selector',
    toolPatterns: ['tools_search', 'tools_recall', 'skills_*'],
    optional: true,
    minimumPermissionMode: 'read-only',
    requireExplicitGrant: false,
  },
  {
    id: 'core.agent-orchestrator',
    label: 'Tomny Core subagents',
    kind: 'mcp',
    providerId: 'builtin.agent-orchestrator',
    serverName: 'aionui-agent-orchestrator',
    toolPatterns: AGENT_ORCHESTRATOR_TOOLS,
    optional: !options.requireOrchestrator,
    minimumPermissionMode: 'read-only',
    requireExplicitGrant: false,
  },
  {
    id: 'core.testing',
    label: 'Tomny Core testing',
    kind: 'mcp',
    providerId: 'builtin.testing',
    serverName: 'aionui-testing',
    toolPatterns: ['test_*'],
    optional: true,
    minimumPermissionMode: 'read-only',
    requireExplicitGrant: false,
  },
  createSecretContextCapability(),
];

const createIdeCapability = (): SurfaceCapabilityBinding => ({
  id: 'surface.ide',
  label: 'Tomny IDE tools',
  kind: 'mcp',
  providerId: 'builtin.ide',
  serverName: 'aionui-ide',
  toolPatterns: ['ide_*', 'tomny_*', 'terminal_*', 'git_*', 'team_*', 'db_*', 'exp_*'],
  minimumPermissionMode: 'workspace-write',
  requiredPermissionScopes: ['workspace.read', 'workspace.write'],
  requireExplicitGrant: true,
});

const createBrowserCapability = (): SurfaceCapabilityBinding => ({
  id: 'surface.browser',
  label: 'Browser Control tools',
  kind: 'mcp',
  providerId: 'builtin.browser-control',
  serverName: 'aionui-browser-control',
  toolPatterns: ['browser_*', 'quick_test_*', 'extract_content', 'editor_*'],
  minimumPermissionMode: 'full-access',
  requiredPermissionScopes: ['browser.control'],
  requireExplicitGrant: true,
});

const createOfficeCapability = (): SurfaceCapabilityBinding => ({
  id: 'surface.office',
  label: 'Office Editor tools',
  kind: 'mcp',
  providerId: 'builtin.office-editor',
  serverName: 'aionui-office-editor',
  toolPatterns: ['office_*'],
  minimumPermissionMode: 'workspace-write',
  requiredPermissionScopes: ['office.read', 'office.write'],
  requireExplicitGrant: true,
});

export const BUILTIN_SURFACE_MANIFESTS: SurfaceManifest[] = [
  {
    schemaVersion: 1,
    id: 'chat',
    label: 'Chat',
    description: 'Transport-neutral conversational surface without a required live application harness.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 0,
    context: {
      required: [...BASE_CONTEXT],
      includeOpaqueSecretHandles: false,
      maxCharacters: 12_000,
    },
    permissions: {
      minimumMode: 'read-only',
      allowedModes: [...ALL_PERMISSION_MODES],
      requireExplicitGrant: false,
    },
    capabilities: createCoreCapabilities(),
  },
  {
    schemaVersion: 1,
    id: 'ide',
    label: 'IDE',
    description: 'Coding harness backed by the live workspace, repository intelligence and Tomny IDE tools.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 100,
    context: {
      required: [...BASE_CONTEXT, 'workspace'],
      includeOpaqueSecretHandles: true,
      allowedSecretCapabilities: ['core.secret-context'],
      maxCharacters: 12_000,
    },
    permissions: {
      minimumMode: 'workspace-write',
      allowedModes: ['workspace-write', 'full-access'],
      requiredScopes: ['workspace.read', 'workspace.write'],
      requireExplicitGrant: true,
    },
    capabilities: [...createCoreCapabilities(), createIdeCapability()],
    fallbackSurfaceIds: ['chat'],
  },
  {
    schemaVersion: 1,
    id: 'browser',
    label: 'Browser',
    description: 'Live embedded-browser research, interaction and Quick Test harness.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 90,
    context: {
      required: [...BASE_CONTEXT],
      includeOpaqueSecretHandles: true,
      allowedSecretCapabilities: ['core.secret-context'],
      maxCharacters: 12_000,
    },
    permissions: {
      minimumMode: 'full-access',
      allowedModes: ['full-access'],
      requiredScopes: ['browser.control'],
      requireExplicitGrant: true,
    },
    capabilities: [...createCoreCapabilities(), createBrowserCapability()],
    fallbackSurfaceIds: ['chat'],
  },
  {
    schemaVersion: 1,
    id: 'office',
    label: 'Office',
    description: 'Live document, spreadsheet and presentation editing harness.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 80,
    context: {
      required: [...BASE_CONTEXT, 'workspace'],
      includeOpaqueSecretHandles: false,
      maxCharacters: 12_000,
    },
    permissions: {
      minimumMode: 'workspace-write',
      allowedModes: ['workspace-write', 'full-access'],
      requiredScopes: ['office.read', 'office.write'],
      requireExplicitGrant: true,
    },
    capabilities: [...createCoreCapabilities(), createOfficeCapability()],
    fallbackSurfaceIds: ['chat'],
  },
  {
    schemaVersion: 1,
    id: 'deliverables',
    label: 'Deliverables',
    description: 'One-prompt repository research, evidence verification and Office deliverable production surface.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 110,
    context: {
      required: [...BASE_CONTEXT, 'workspace'],
      includeOpaqueSecretHandles: true,
      allowedSecretCapabilities: ['core.secret-context'],
      maxCharacters: 24_000,
    },
    permissions: {
      minimumMode: 'full-access',
      allowedModes: ['full-access'],
      requiredScopes: ['workspace.read', 'workspace.write', 'browser.control', 'office.read', 'office.write'],
      requireExplicitGrant: true,
    },
    capabilities: [
      ...createCoreCapabilities({ requireOrchestrator: true }),
      createIdeCapability(),
      createBrowserCapability(),
      createOfficeCapability(),
    ],
    fallbackSurfaceIds: ['office', 'ide', 'browser', 'chat'],
  },
  {
    schemaVersion: 1,
    id: 'make-film',
    label: 'Make Film',
    description: 'Agent-driven film, image, narration, video-clip and final-export production surface.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 75,
    context: {
      required: [...BASE_CONTEXT, 'workspace'],
      includeOpaqueSecretHandles: true,
      allowedSecretCapabilities: ['core.secret-context'],
      maxCharacters: 12_000,
    },
    permissions: {
      minimumMode: 'workspace-write',
      allowedModes: ['workspace-write', 'full-access'],
      requiredScopes: ['make-film.read', 'make-film.write'],
      requireExplicitGrant: true,
    },
    capabilities: [
      ...createCoreCapabilities(),
      {
        id: 'surface.make-film',
        label: 'Make Film tools',
        kind: 'mcp',
        providerId: 'builtin.make-film',
        serverName: 'aionui-make-film',
        toolPatterns: ['make_film_*', 'image_*', 'video_*'],
        minimumPermissionMode: 'workspace-write',
        requiredPermissionScopes: ['make-film.read', 'make-film.write'],
        requireExplicitGrant: true,
      },
    ],
    fallbackSurfaceIds: ['chat'],
  },
  {
    schemaVersion: 1,
    id: 'music',
    label: 'Music',
    description: 'Music production harness sharing the active project and audio analysis engine.',
    source: { kind: 'builtin', id: 'tomny-core' },
    priority: 70,
    context: {
      required: [...BASE_CONTEXT, 'workspace'],
      includeOpaqueSecretHandles: false,
      maxCharacters: 12_000,
    },
    permissions: {
      minimumMode: 'workspace-write',
      allowedModes: ['workspace-write', 'full-access'],
      requiredScopes: ['music.read', 'music.write'],
      requireExplicitGrant: true,
    },
    capabilities: [
      ...createCoreCapabilities(),
      {
        id: 'surface.music',
        label: 'Music tools',
        kind: 'mcp',
        providerId: 'builtin.music',
        serverName: 'aionui-music',
        toolPatterns: ['music_*'],
        minimumPermissionMode: 'workspace-write',
        requiredPermissionScopes: ['music.read', 'music.write'],
        requireExplicitGrant: true,
      },
    ],
    fallbackSurfaceIds: ['chat'],
  },
];

/** Return detached manifests so plugin wiring cannot mutate the built-in policy constants. */
export const createBuiltinSurfaceManifests = (): SurfaceManifest[] => structuredClone(BUILTIN_SURFACE_MANIFESTS);
