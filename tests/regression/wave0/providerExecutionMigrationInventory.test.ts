import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type DirectProviderBoundary = Readonly<{
  id: string;
  source: string;
  kind: 'runtime-direct' | 'guarded-direct' | 'configuration-discovery' | 'standalone-mcp';
  requiredMarkers: readonly string[];
}>;

type ContainedProviderBoundary = Readonly<{
  id: string;
  source: string;
  requiredMarkers: readonly string[];
}>;

const ROOT = process.cwd();

/**
 * Deliberately bounded inventory of Main-owned provider transports that still
 * handle a credential outside ProviderExecutionBroker. This is not a passing
 * C0/C3 claim: a route stays listed until its owned replacement preserves its
 * purpose (chat, media, embedding, discovery, or MCP child process) and has
 * equivalent identity, destination, egress, cancellation, and receipt proof.
 */
const DIRECT_PROVIDER_BOUNDARIES: readonly DirectProviderBoundary[] = [];

/**
 * These routes formerly handled provider credentials directly. They are retained
 * as explicit containment evidence rather than silently disappearing from C0/C3:
 * each is disabled before provider configuration, credential, or transport use
 * until a Main-owned authority can supply identity, final egress admission,
 * opaque secret lease, cancellation, and durable receipt.
 */
const CONTAINED_PROVIDER_BOUNDARIES: readonly ContainedProviderBoundary[] = [
  {
    id: 'make-video-image-provider-handoff',
    source: 'packages/desktop/src/process/makevideo/makeVideoBridge.ts',
    requiredMarkers: ['MAKEVIDEO_IMAGE_REMOTE_TRANSPORT_DISABLED'],
  },
  {
    id: 'make-video-voice',
    source: 'packages/desktop/src/process/makevideo/voiceGen.ts',
    requiredMarkers: ['VOICE_EGRESS_AUTHORITY_REQUIRED'],
  },
  {
    id: 'make-video-clip',
    source: 'packages/desktop/src/process/makevideo/videoClipGen.ts',
    requiredMarkers: ['MAKEVIDEO_VIDEO_CLIP_EGRESS_AUTHORITY_REQUIRED'],
  },
  {
    id: 'realtime-knowledge-embedding',
    source: 'packages/desktop/src/process/knowledge/rtkEmbedder.ts',
    requiredMarkers: ['Remote embedding remains unavailable', 'null;'],
  },
  {
    id: 'speech-transcription',
    source: 'packages/desktop/src/process/services/contentExtract/speechTranscription.ts',
    requiredMarkers: ['STT_REMOTE_TRANSPORT_DISABLED'],
  },
  {
    id: 'provider-model-discovery',
    source: 'packages/desktop/src/process/services/tomnyModelDiscovery.ts',
    requiredMarkers: ['PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED'],
  },
  {
    id: 'builtin-company-mcp-child',
    source: 'packages/desktop/src/process/resources/builtinMcp/companyServer.ts',
    requiredMarkers: ['COMPANY_GENERATOR_TRANSPORT_DISABLED'],
  },
  {
    id: 'builtin-image-generation-mcp-child',
    source: 'packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts',
    requiredMarkers: ['IMAGE_EGRESS_DISABLED_MESSAGE'],
  },
];

const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('C0/C3 direct provider boundary inventory', () => {
  it('keeps every known direct credential boundary explicit until its replacement is proven', () => {
    for (const boundary of DIRECT_PROVIDER_BOUNDARIES) {
      const source = read(boundary.source);
      for (const marker of boundary.requiredMarkers) {
        expect(source, `${boundary.id}: ${marker}`).toContain(marker);
      }
    }
  });

  it('keeps the inventory categories explicit so guarded or provisioning paths are not reported as brokered chat', () => {
    expect(DIRECT_PROVIDER_BOUNDARIES).toEqual([]);
  });

  it('keeps contained former credential routes explicit until a governed replacement is release-proven', () => {
    expect(CONTAINED_PROVIDER_BOUNDARIES.map((boundary) => boundary.id)).toEqual([
      'make-video-image-provider-handoff',
      'make-video-voice',
      'make-video-clip',
      'realtime-knowledge-embedding',
      'speech-transcription',
      'provider-model-discovery',
      'builtin-company-mcp-child',
      'builtin-image-generation-mcp-child',
    ]);
    for (const boundary of CONTAINED_PROVIDER_BOUNDARIES) {
      const source = read(boundary.source);
      for (const marker of boundary.requiredMarkers) {
        expect(source, `${boundary.id}: ${marker}`).toContain(marker);
      }
      expect(source, `${boundary.id}: direct API key`).not.toContain('api_key');
      expect(source, `${boundary.id}: direct fetch`).not.toContain('fetch(');
    }
  });
});
