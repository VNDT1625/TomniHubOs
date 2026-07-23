import { describe, expect, it } from 'vitest';

import {
  compileViuImageStyle,
  createPremiumStarterProject,
  createViuNode,
  normalizeViuImageTransform,
  validateViuImageTransform,
} from '@/common/viu';
import { createImageTransformViuBatch } from '@/common/viu/authoring';

const addImageNode = () => {
  const project = createPremiumStarterProject('image-transform-test');
  const image = createViuNode({
    id: 'image-hero',
    name: 'Hero image',
    type: 'image',
    parentId: 'node-home-root',
    width: 640,
    height: 360,
    semantics: { role: 'image', label: 'Hero product' },
  });
  project.nodes[image.id] = image;
  project.nodes['node-home-root']!.childIds.push(image.id);
  return project;
};

describe('VIU image framing', () => {
  it('compiles normalized crop, focal point, rotation and flips into deterministic CSS', () => {
    const transform = normalizeViuImageTransform({
      fit: 'contain',
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
      focalPoint: { x: 0.75, y: 0.2 },
      rotation: 90,
      flipHorizontal: true,
    });

    expect(compileViuImageStyle(transform)).toMatchObject({
      width: '200%',
      height: '125%',
      left: '-50%',
      top: '-12.5%',
      objectFit: 'contain',
      objectPosition: '75% 20%',
      transform: 'rotate(90deg) scale(-1, 1)',
    });
  });

  it('rejects crop bounds that extend beyond the source image', () => {
    const transform = normalizeViuImageTransform({ crop: { x: 0.8, y: 0, width: 0.4, height: 1 } });

    expect(validateViuImageTransform(transform)).toContain('crop bounds');
  });

  it('creates an atomic image-only authoring batch while preserving nested values', () => {
    const project = addImageNode();
    project.nodes['image-hero']!.imageTransform = normalizeViuImageTransform({
      crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    });

    const batch = createImageTransformViuBatch(
      project,
      { nodeIds: ['image-hero'], anchorId: 'image-hero' },
      { crop: { x: 0.15 }, focalPoint: { y: 0.3 }, flipVertical: true }
    );
    const command = batch.commands[0];

    expect(command?.type).toBe('updateNode');
    expect(command?.type === 'updateNode' ? command.patch.imageTransform : undefined).toMatchObject({
      crop: { x: 0.15, y: 0.2, width: 0.8, height: 0.7 },
      focalPoint: { x: 0.5, y: 0.3 },
      flipVertical: true,
    });
  });

  it('rejects mixed selections instead of silently applying image data to other nodes', () => {
    const project = addImageNode();

    expect(() =>
      createImageTransformViuBatch(
        project,
        { nodeIds: ['image-hero', 'node-home-title'], anchorId: 'image-hero' },
        { rotation: 45 }
      )
    ).toThrow('only accepts image nodes');
  });
});
