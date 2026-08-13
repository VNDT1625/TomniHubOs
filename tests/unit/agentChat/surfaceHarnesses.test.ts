import { describe, expect, it } from 'vitest';
import { buildSurfaceHarnessPrompt } from '../../../packages/desktop/src/process/agentRuntime/surfaceRegistry/harnesses';
import type { ResolvedSurface } from '../../../packages/desktop/src/process/agentRuntime/surfaceRegistry/types';

const resolvedSurface = (id: string): ResolvedSurface => ({
  manifest: {
    schemaVersion: 1,
    id,
    label: id,
    description: `${id} surface`,
    source: { kind: 'builtin' },
    context: {
      required: ['agent', 'personal', 'conversation', 'surface'],
      includeOpaqueSecretHandles: false,
    },
    permissions: {
      minimumMode: 'read-only',
      allowedModes: ['read-only'],
      requireExplicitGrant: false,
    },
    capabilities: [],
  },
  capabilities: [],
  omittedOptionalCapabilities: [],
  fallbackTrail: [],
});

describe('surface harness prompts', () => {
  it('adds a live Studio and PowerPoint workflow for the Office surface', () => {
    const prompt = buildSurfaceHarnessPrompt(resolvedSurface('office'));

    expect(prompt).toContain('[Studio Office Harness]');
    expect(prompt).toContain('office_read_document');
    expect(prompt).toContain('office_create_premium_deck');
    expect(prompt).toContain('office_review_premium_quality');
    expect(prompt).toContain('office_review_object_animations');
    expect(prompt).toContain('office_apply_object_animations');

    expect(prompt).toContain('office_structure_report');
    expect(prompt).toContain('office_open_visual_review');
    expect(prompt).toContain('agenda, comparison, timeline, process, metrics and architecture');
  });

  it('keeps the IDE surface prompt short and opens an action gate only for tool work', () => {
    const prompt = buildSurfaceHarnessPrompt(resolvedSurface('ide'));

    expect(prompt).toContain('[Tomny Surface: IDE]');
    expect(prompt).toContain('only for tool or external-action turns');
    expect(prompt).toContain('casual chat never use StartAction');
    expect(prompt).not.toContain('Open the current user action exactly once with StartAction');
    expect(prompt).toContain('After StartAction opens the gate');
    expect(prompt).toContain('Use ToolSearch');
    expect(prompt).toContain('call each loaded IDE or MCP tool directly');
    expect(prompt).toContain('Secret Context values remain hidden');
    expect(prompt.length).toBeLessThan(900);
    expect(prompt).toContain('persistent ToolMap summary');
    expect(prompt).not.toContain('surface-owned nested schema');
    expect(prompt).not.toContain('tomny-ide');
  });

  it('turns one Deliverables prompt into bounded specialist research jobs', () => {
    const prompt = buildSurfaceHarnessPrompt(resolvedSurface('deliverables'));

    expect(prompt).toContain('[Tomny Surface: Deliverables]');
    expect(prompt).toContain('Turn one user prompt into a verified local deliverable');
    expect(prompt).toContain('specialist subagent per material domain or section');
  });

  it('keeps original-source evidence and limits difficult-page access to an authorized browser session', () => {
    const prompt = buildSurfaceHarnessPrompt(resolvedSurface('deliverables'));

    expect(prompt).toContain('evidence ledger');
    expect(prompt).toContain('verify a claim from a summary alone');
    expect(prompt).toContain('user-authorized session');
    expect(prompt).toContain('never evade or weaken access controls');
  });

  it('requires factual and visual Office QA before returning the local artifact', () => {
    const prompt = buildSurfaceHarnessPrompt(resolvedSurface('deliverables'));

    expect(prompt).toContain('office_review_premium_quality');
    expect(prompt).toContain('office_open_visual_review');
    expect(prompt).toContain('confirm the local file exists');
  });

  it('does not leak Office instructions into unrelated surfaces', () => {
    expect(buildSurfaceHarnessPrompt(resolvedSurface('music'))).toBe('');
  });

  it('returns no harness when surface resolution is unavailable', () => {
    expect(buildSurfaceHarnessPrompt(undefined)).toBe('');
  });
});
