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
  label: 'Tomny Secrets',
  kind: 'mcp',
  providerId: 'builtin.secret-context',
  serverName: 'tomny-secret-context',
  toolPatterns: [
    'tomny_secret_use',
    'tomny_secret_capture',
    'tomny_secret_generate',
    'tomny_secret_list',
    'tomny_secret_request',
    'tomny_secret_request_access',
  ],
  availability: 'core',
  optional: true,
  minimumPermissionMode: 'workspace-write',
  // The trusted host enforces exact source/destination policies. Repeated UI
  // approval would make unattended workflows impossible without adding a
  // second security boundary.
  requireExplicitGrant: false,
});

/**
 * Read-only access to the user's notification hub ("what did I miss"). Output is local, redacted and
 * contains no connector settings or secrets, so it needs no grant beyond read-only.
 */
const createNotificationHubCapability = (): SurfaceCapabilityBinding => ({
  id: 'core.notification-hub',
  label: 'Tomny notification hub (read-only)',
  kind: 'mcp',
  providerId: 'builtin.notification-hub',
  serverName: 'tomny-notification-hub',
  toolPatterns: ['notifications_recent', 'notifications_summary'],
  availability: 'core',
  optional: true,
  minimumPermissionMode: 'read-only',
  requireExplicitGrant: false,
});

const createCoreCapabilities = (options: { requireOrchestrator?: boolean } = {}): SurfaceCapabilityBinding[] => [
  {
    id: 'core.skill-workflow',
    label: 'Tomny Skill Workflow',
    kind: 'mcp',
    providerId: 'builtin.tool-selector',
    serverName: 'tomny-tool-selector',
    toolPatterns: ['tools_search', 'tools_recall', 'tools_guide', 'skills_*', 'plugin'],
    availability: 'core',
    optional: true,
    minimumPermissionMode: 'read-only',
    requireExplicitGrant: false,
  },
    {
    id: 'core.tool-workflow',
    label: 'Tomny multi-tool workflow',
    kind: 'mcp',
    providerId: 'builtin.workflow',
    serverName: 'tomny-workflow',
    toolPatterns: ['workflow_run', 'workflow_result_get', 'workflow_adapter_get', 'workflow_mailbox_poll'],
    availability: 'core',
    optional: true,
    minimumPermissionMode: 'read-only',
    requireExplicitGrant: false,
  },
  {
    id: 'core.agent-orchestrator',
    label: 'Tomny Core subagents',
    kind: 'mcp',
    providerId: 'builtin.agent-orchestrator',
    serverName: 'tomny-agent-orchestrator',
    toolPatterns: AGENT_ORCHESTRATOR_TOOLS,
    availability: 'core',
    optional: !options.requireOrchestrator,
    minimumPermissionMode: 'read-only',
    requireExplicitGrant: false,
  },
  createSecretContextCapability(),
  createNotificationHubCapability(),
];

/**
 * Read, search and list files of the conversation's workspace. Only surfaces without their own project tools get
 * it: the IDE surface already serves tomny_* names, and two servers must not offer the same tool.
 */
const createWorkspaceReadCapability = (): SurfaceCapabilityBinding => ({
  id: 'core.workspace-read',
  label: 'Tomny Core workspace (read-only)',
  kind: 'mcp',
  providerId: 'builtin.core-workspace-read',
  serverName: 'tomny-core-workspace',
  toolPatterns: [
    'tomny_read',
    'tomny_glob',
    'tomny_search',
    'tomny_wiki',
    'tomny_compass',
    'tomny_diff',
    'tomny_compact',
    'tomny_library_search',
  ],
  availability: 'core',
  optional: true,
  minimumPermissionMode: 'read-only',
  requireExplicitGrant: false,
});

const createIdeCapability = (): SurfaceCapabilityBinding => ({
  id: 'surface.ide',
  label: 'Tomny IDE tools',
  kind: 'mcp',
  providerId: 'builtin.ide',
  serverName: 'tomny-ide',
  toolPatterns: ['ide_*', 'tomny_*', 'terminal_*', 'git_*', 'team_*', 'db_*', 'exp_*'],
  availability: 'surface-only',
  minimumPermissionMode: 'workspace-write',
  requiredPermissionScopes: ['workspace.read', 'workspace.write'],
  requireExplicitGrant: true,
});

const createBrowserCapability = (): SurfaceCapabilityBinding => ({
  id: 'surface.browser',
  label: 'Browser Control tools',
  kind: 'mcp',
  providerId: 'builtin.browser-control',
  serverName: 'tomny-browser-control',
  toolPatterns: ['browser_*', 'quick_test_*', 'extract_content', 'editor_*'],
  availability: 'portable',
  minimumPermissionMode: 'full-access',
  requiredPermissionScopes: ['browser.control'],
  requireExplicitGrant: true,
});

const createOfficeCapability = (): SurfaceCapabilityBinding => ({
  id: 'surface.office',
  label: 'Office Editor tools',
  kind: 'mcp',
  providerId: 'builtin.office-editor',
  serverName: 'tomny-office-editor',
  toolPatterns: ['office_*'],
  availability: 'portable',
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
    capabilities: [...createCoreCapabilities(), createWorkspaceReadCapability()],
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
        serverName: 'tomny-make-film',
        toolPatterns: ['make_film_*', 'image_*', 'video_*'],
        availability: 'surface-only',
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
        serverName: 'tomny-music',
        toolPatterns: ['music_*'],
        availability: 'surface-only',
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
