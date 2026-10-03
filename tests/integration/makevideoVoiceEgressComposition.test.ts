import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error(`MakeVideo voice composition source missing: ${path}`);
  return readFileSync(absolutePath, 'utf8');
};

/**
 * The binary TTS seam deliberately cannot reuse the text-only chat broker. This
 * inventory makes the absent production composition explicit, preventing a
 * future bridge edit from silently treating a raw MakeVideo voice config as an
 * authority or wiring an incomplete transport.
 */
describe('MakeVideo VoiceEgressAuthority composition', () => {
  it('fails closed until Main composes account/run admission, opaque binary transport, and durable receipt ownership', () => {
    const bridge = readSource('packages/desktop/src/process/makevideo/makeVideoBridge.ts');
    const authority = readSource('packages/desktop/src/process/makevideo/voiceEgressAuthority.ts');
    const providerBroker = readSource(
      'packages/desktop/src/process/services/security/providerExecution/providerExecutionBroker.ts'
    );

    // The active bridge deliberately provides only a local output directory.
    // It has no Main-owned admission+transport implementation to inject.
    expect(bridge).toContain('generateVoice(req.text, req.voiceConfig, req.projectId, req.sceneId, { audioDir })');
    expect(bridge).not.toContain('createVoiceEgressAuthority');
    expect(bridge).not.toContain('egressAuthority:');

    // The TTS contract requires both halves of a binary capability, which are
    // unavailable in the shared chat broker. Its string completion result and
    // chat-only destination class cannot stand in for an MP3 transport receipt.
    expect(authority).toContain('admissionAuthority: VoiceEgressAdmissionAuthority;');
    expect(authority).toContain('transport: VoiceEgressTransport;');
    expect(authority).toContain('binds an account/run grant');
    expect(authority).toContain('persist a durable transport receipt');
    expect(providerBroker).toContain('messages: readonly ChatMessageInput[];');
    expect(providerBroker).toContain('content: string;');
    expect(providerBroker).toContain('/chat/completions');
    expect(providerBroker).not.toContain('audio/speech');
  });
});
