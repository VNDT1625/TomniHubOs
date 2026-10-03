/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for process/makevideo/videoClipGen. The legacy direct fal.ai
 * transport is deliberately disabled. A future Main-only authority receives
 * secret-free request data and owns provider transport.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateVideoClip } from '@/process/makevideo/videoClipGen';
import type {
  VideoClipEgressAuthority,
  VideoClipEgressRequest,
  VideoClipEgressResult,
} from '@/process/makevideo/videoClipGen';
import type { VideoClipConfigFal } from '@/process/makevideo/makeVideoTypes';

let frameDir: string;
let framePath: string;

beforeAll(async () => {
  frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mkv-clip-'));
  framePath = path.join(frameDir, 'frame.png');
  await fs.promises.writeFile(framePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterAll(async () => {
  await fs.promises.rm(frameDir, { recursive: true, force: true });
});

const CONFIG: VideoClipConfigFal = {
  type: 'fal',
  api_key: 'fal-key-must-not-reach-authority',
  model_id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
  duration: 5,
};

/** Output fs that records writes without touching disk. */
const outFs = () => {
  const writes: string[] = [];
  return {
    writes,
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (filePath: string) => {
      writes.push(filePath);
    }),
  };
};

const createAuthority = (result: VideoClipEgressResult = { videoBytes: new Uint8Array([9, 9, 9]) }) => {
  const generateVideoClip = vi.fn(async (_request: VideoClipEgressRequest) => result);
  return {
    authority: { generateVideoClip } satisfies VideoClipEgressAuthority,
    generateVideoClip,
  };
};

describe('generateVideoClip — Main-only egress containment', () => {
  it('fails closed before source reads, authority invocation, or artifact writes when no authority exists', async () => {
    const fsOut = outFs();

    await expect(
      generateVideoClip('/does-not-exist.png', null, 'pan left', CONFIG, 'p1', 's1', {
        fs: fsOut,
        clipsDir: '/clips',
      })
    ).rejects.toThrow('MAKEVIDEO_VIDEO_CLIP_EGRESS_AUTHORITY_REQUIRED');

    expect(fsOut.mkdir).not.toHaveBeenCalled();
    expect(fsOut.writeFile).not.toHaveBeenCalled();
  });

  it('passes only secret-free request data to the authority and writes its bounded artifact', async () => {
    const fsOut = outFs();
    const { authority, generateVideoClip: authorityGenerate } = createAuthority({
      videoBytes: new Uint8Array([1, 2, 3]),
      contentType: 'video/mp4',
    });

    const outputPath = await generateVideoClip(framePath, null, 'pan left', CONFIG, 'p1', 's1', {
      fs: fsOut,
      clipsDir: '/clips',
      egressAuthority: authority,
      timeoutMs: 10_000,
      maxOutputBytes: 32,
    });

    expect(outputPath).toMatch(/clip-p1-s1\.mp4$/);
    expect(fsOut.writes).toHaveLength(1);
    expect(authorityGenerate).toHaveBeenCalledTimes(1);

    const request = authorityGenerate.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      modelId: CONFIG.model_id,
      prompt: 'pan left',
      duration: 5,
      timeoutMs: 10_000,
      maxOutputBytes: 32,
    });
    expect(request?.imageDataUri).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(request)).not.toContain(CONFIG.api_key);
    expect(request).not.toHaveProperty('api_key');
    expect(request).not.toHaveProperty('providerUrl');
  });

  it('returns a stable redacted error and leaves no artifact when the authority fails', async () => {
    const fsOut = outFs();
    const authority: VideoClipEgressAuthority = {
      generateVideoClip: vi.fn(async () => {
        throw new Error('provider replied with secret fal-key-must-not-reach-authority');
      }),
    };

    await expect(
      generateVideoClip(framePath, null, 'pan left', CONFIG, 'p1', 's2', {
        fs: fsOut,
        clipsDir: '/clips',
        egressAuthority: authority,
      })
    ).rejects.toThrow('MAKEVIDEO_VIDEO_CLIP_EGRESS_FAILED');

    expect(fsOut.mkdir).not.toHaveBeenCalled();
    expect(fsOut.writeFile).not.toHaveBeenCalled();
  });

  it('does not write an oversized authority result', async () => {
    const fsOut = outFs();
    const { authority } = createAuthority({ videoBytes: new Uint8Array([1, 2, 3]) });

    await expect(
      generateVideoClip(framePath, null, 'pan left', CONFIG, 'p1', 's3', {
        fs: fsOut,
        clipsDir: '/clips',
        egressAuthority: authority,
        maxOutputBytes: 2,
      })
    ).rejects.toThrow('MAKEVIDEO_VIDEO_CLIP_OUTPUT_TOO_LARGE');

    expect(fsOut.mkdir).not.toHaveBeenCalled();
    expect(fsOut.writeFile).not.toHaveBeenCalled();
  });

  it('cancels before any authority call or artifact write', async () => {
    const fsOut = outFs();
    const { authority, generateVideoClip: authorityGenerate } = createAuthority();
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateVideoClip(
        framePath,
        null,
        'pan left',
        CONFIG,
        'p1',
        's4',
        {
          fs: fsOut,
          clipsDir: '/clips',
          egressAuthority: authority,
        },
        controller.signal
      )
    ).rejects.toThrow('MAKEVIDEO_VIDEO_CLIP_ABORTED');

    expect(authorityGenerate).not.toHaveBeenCalled();
    expect(fsOut.mkdir).not.toHaveBeenCalled();
    expect(fsOut.writeFile).not.toHaveBeenCalled();
  });

  it('aborts an authority that exceeds the bounded deadline and writes no artifact', async () => {
    const fsOut = outFs();
    let authoritySignal: AbortSignal | undefined;
    const authority: VideoClipEgressAuthority = {
      generateVideoClip: vi.fn(
        (request: VideoClipEgressRequest) =>
          new Promise<VideoClipEgressResult>(() => {
            authoritySignal = request.signal;
          })
      ),
    };

    await expect(
      generateVideoClip(framePath, null, 'pan left', CONFIG, 'p1', 's5', {
        fs: fsOut,
        clipsDir: '/clips',
        egressAuthority: authority,
        timeoutMs: 1,
      })
    ).rejects.toThrow('MAKEVIDEO_VIDEO_CLIP_TIMED_OUT');

    expect(authoritySignal?.aborted).toBe(true);
    expect(fsOut.mkdir).not.toHaveBeenCalled();
    expect(fsOut.writeFile).not.toHaveBeenCalled();
  });
});
