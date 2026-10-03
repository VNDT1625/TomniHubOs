import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createVisualBox, scanImageForSensitiveText } from '../../../packages/desktop/src/process/visualArtifact';

describe('image security OCR gate', () => {
  it('blocks an image when local OCR finds a Vietnamese password', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'image-security-'));
    const imagePath = join(directory, 'secret.png');
    try {
      await sharp({
        create: { width: 800, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
      })
        .png()
        .toFile(imagePath);

      const result = await scanImageForSensitiveText(imagePath, {
        textAnalyzer: async ({ width, height }) => [
          {
            id: 'ocr-1',
            text: 'mat khau : 0329108079',
            box: createVisualBox(20, 20, 300, 40, width, height),
            confidence: 0.96,
            source: 'test-ocr',
          },
        ],
      });

      expect(result.decision).toBe('block');
      expect(result.safeText).toBe('mat khau : [REDACTED]');
      expect(result.findings).toEqual([{ name: 'mat khau', type: 'password', confidence: 'high' }]);
      expect(JSON.stringify(result)).not.toContain('0329108079');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
