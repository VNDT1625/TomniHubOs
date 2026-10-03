import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceAssertion = Readonly<{
  path: string;
  requiredMarkers: readonly string[];
}>;

type UnprovenSecretRoute = Readonly<{
  id: string;
  containment: 'admission-only' | 'local-fallback-only' | 'direct-feature-transport';
  source: string;
  directSecretMarkers: readonly string[];
}>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = 'packages/desktop/src/process';

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C3 secret-boundary inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

const hasSharedFoundationGovernanceMarker = (content: string): boolean =>
  /\b(?:executeFoundationHubRun|getFoundationKernel|new RunKernel)\b/.test(content);

/**
 * This is bounded static inventory evidence, not an assertion that the scanner
 * detects every secret representation or that every Main transport is known.
 * It preserves the demonstrated Foundation/RunKernel protections separately
 * from the named feature transports which still require a shared Trust, final
 * egress, and receipt migration before C3-02 can be considered universal.
 */
const CURRENT_SECRET_BOUNDARY_GUARDS: readonly SourceAssertion[] = [
  {
    path: `${PROCESS_ROOT}/agentRuntime/agentMesh/security/secretFirewall.ts`,
    requiredMarkers: [
      'const createScanView = (input: string): ScanView => {',
      'if (isInvisibleFormatCharacter(character)) continue;',
      "const REDACTED = '[REDACTED]';",
      "name: 'OPENAI_API_KEY'",
      'export const redactSecretText = (input: string): SecretFirewallResult => redact(input, false);',
    ],
  },
  {
    path: `${PROCESS_ROOT}/bridge/foundationBridge.ts`,
    requiredMarkers: [
      "import { redactSecretText } from '../agentRuntime/agentMesh/security/secretFirewall';",
      'export const redactFoundationTextForRenderer = (text: string): string => redactSecretText(text).text;',
      'text: redactFoundationTextForRenderer(result.text),',
      'text: redactFoundationTextForRenderer(',
      "console.error('[foundationBridge] Foundation execution rejected.');",
    ],
  },
  {
    path: `${PROCESS_ROOT}/foundation/runKernel.ts`,
    requiredMarkers: [
      "import { redactSecretText } from '../agentRuntime/agentMesh/security/secretFirewall';",
      'const sanitizeExecutorEvidenceRefs = (evidenceRefs: readonly string[]): readonly string[] =>',
      'evidenceRefs = sanitizeExecutorEvidenceRefs([...result.evidenceRefs, ...delegatedEvidenceRefs]);',
      "failureReason = 'EXECUTION_THREW_ERROR';",
    ],
  },
] as const;

const NAMED_UNPROVEN_SECRET_ROUTES: readonly UnprovenSecretRoute[] = [] as const;

const CONTAINED_REMOTE_SECRET_ROUTES: readonly SourceAssertion[] = [
  {
    path: `${PROCESS_ROOT}/services/contentExtract/speechTranscription.ts`,
    requiredMarkers: ["throw new Error('STT_REMOTE_TRANSPORT_DISABLED');"],
  },
  {
    path: `${PROCESS_ROOT}/knowledge/rtkEmbedder.ts`,
    requiredMarkers: ['export const createProviderEmbedder = async', 'null;'],
  },
  {
    path: `${PROCESS_ROOT}/makevideo/voiceGen.ts`,
    requiredMarkers: ['VOICE_EGRESS_AUTHORITY_REQUIRED'],
  },
  {
    path: `${PROCESS_ROOT}/makevideo/videoClipGen.ts`,
    requiredMarkers: ['VIDEO_CLIP_EGRESS_AUTHORITY_REQUIRED'],
  },
] as const;

describe('C3 secret boundary inventory', () => {
  it('keeps the demonstrated scanner, renderer redaction, and receipt sanitization guards pinned', () => {
    for (const guard of CURRENT_SECRET_BOUNDARY_GUARDS) {
      const content = readSource(guard.path);
      for (const marker of guard.requiredMarkers) expect(content, guard.path + ': ' + marker).toContain(marker);
    }
  });

  it('names the known feature transports with direct secret use that remain outside the shared Foundation seam', () => {
    expect(NAMED_UNPROVEN_SECRET_ROUTES).toEqual([]);

    for (const route of NAMED_UNPROVEN_SECRET_ROUTES) {
      const content = readSource(route.source);
      for (const marker of route.directSecretMarkers) expect(content, route.id + ': ' + marker).toContain(marker);
      expect(hasSharedFoundationGovernanceMarker(content), route.id).toBe(false);
    }
  });

  it('keeps explicitly disabled remote feature routes fail-closed until a shared Trust transport exists', () => {
    for (const route of CONTAINED_REMOTE_SECRET_ROUTES) {
      const content = readSource(route.path);
      for (const marker of route.requiredMarkers) expect(content, route.path + ': ' + marker).toContain(marker);
      expect(content).not.toContain('config.api_key');
      expect(content).not.toContain('await fetch(');
    }
  });
});
