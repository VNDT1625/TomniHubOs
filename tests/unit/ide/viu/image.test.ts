/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeImageProject } from '@package-apps/design/process/viu/image';

describe('Viu image reconstruction evidence', () => {
  it('keeps the raster reference and emits editable regions with explicit z-confidence limits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tomny-viu-image-'));
    const imagePath = join(directory, 'landing.png');
    try {
      await sharp({
        create: { width: 360, height: 240, channels: 4, background: { r: 18, g: 32, b: 64, alpha: 1 } },
      })
        .composite([
          {
            input: Buffer.from('<svg width="180" height="120"><rect width="180" height="120" fill="#f97316"/></svg>'),
            left: 150,
            top: 60,
          },
        ])
        .png()
        .toFile(imagePath);

      const project = await analyzeImageProject({ path: imagePath }, new Date('2026-07-22T00:00:00.000Z'));
      const document = project.documents[0];
      const depthNodes = document?.nodes.filter((node) => node.id.startsWith('depth-')) ?? [];

      expect(project.referencePreviewDataUrl).toMatch(/^data:image\/png;base64,/u);
      expect(document?.page).toMatchObject({ width: 360, height: 240 });
      expect(depthNodes).toHaveLength(16);
      expect(depthNodes.every((node) => node.fidelity.confidence < 0.8)).toBe(true);
      expect(document?.limitations.join(' ')).toContain('does not reveal hidden layers');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects non-image extensions before decoding bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tomny-viu-image-'));
    const textPath = join(directory, 'reference.txt');
    try {
      await writeFile(textPath, 'not an image', 'utf8');
      await expect(analyzeImageProject({ path: textPath })).rejects.toThrow('Viu supports PNG');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
