/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';
import { analyzeVisualArtifact } from '@process/visualArtifact';
import type { VisualArtifact, VisualArtifactRegion } from '@process/visualArtifact/types';
import type { ViuDocument, ViuImageRequest, ViuNode, ViuProject, ViuRect } from './types';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const DEPTH_SAMPLE_SIZE = 96;
const DEPTH_GRID_SIZE = 6;

type DepthTile = {
  id: string;
  rect: ViuRect;
  color: string;
  contrast: number;
  zIndex: number;
  confidence: number;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const toHex = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

const safeMime = (path: string): string => MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? '';

const depthTiles = async (path: string, width: number, height: number): Promise<DepthTile[]> => {
  const { data, info } = await sharp(path)
    .resize({ width: DEPTH_SAMPLE_SIZE, height: DEPTH_SAMPLE_SIZE, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tileWidth = Math.floor(info.width / DEPTH_GRID_SIZE);
  const tileHeight = Math.floor(info.height / DEPTH_GRID_SIZE);
  const values: Omit<DepthTile, 'zIndex' | 'confidence'>[] = [];
  for (let row = 0; row < DEPTH_GRID_SIZE; row += 1) {
    for (let column = 0; column < DEPTH_GRID_SIZE; column += 1) {
      const colors: [number, number, number][] = [];
      const luminance: number[] = [];
      const startX = column * tileWidth;
      const startY = row * tileHeight;
      const endX = column === DEPTH_GRID_SIZE - 1 ? info.width : startX + tileWidth;
      const endY = row === DEPTH_GRID_SIZE - 1 ? info.height : startY + tileHeight;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * info.width + x) * info.channels;
          const red = data[offset] ?? 0;
          const green = data[offset + 1] ?? 0;
          const blue = data[offset + 2] ?? 0;
          colors.push([red, green, blue]);
          luminance.push(red * 0.2126 + green * 0.7152 + blue * 0.0722);
        }
      }
      const count = Math.max(1, colors.length);
      const mean = luminance.reduce((total, value) => total + value, 0) / count;
      const variance = luminance.reduce((total, value) => total + (value - mean) ** 2, 0) / count;
      const average = colors.reduce(
        (result, value) =>
          [result[0] + value[0], result[1] + value[1], result[2] + value[2]] as [number, number, number],
        [0, 0, 0] as [number, number, number]
      );
      values.push({
        id: `depth-${row}-${column}`,
        rect: {
          x: Math.round((column / DEPTH_GRID_SIZE) * width),
          y: Math.round((row / DEPTH_GRID_SIZE) * height),
          width: Math.ceil(width / DEPTH_GRID_SIZE),
          height: Math.ceil(height / DEPTH_GRID_SIZE),
        },
        color: toHex(average[0] / count, average[1] / count, average[2] / count),
        contrast: Math.sqrt(variance) / 128,
      });
    }
  }
  const ordered = values.toSorted((left, right) => right.contrast - left.contrast);
  const selected = ordered.slice(0, 16);
  return selected.map((item, index) => ({
    id: item.id,
    rect: item.rect,
    color: item.color,
    contrast: item.contrast,
    zIndex: 10 + selected.length - index,
    confidence: Math.max(0.25, Math.min(0.72, 0.25 + item.contrast * 0.55)),
  }));
};

const regionNode = (region: VisualArtifactRegion, artifact: VisualArtifact, index: number): ViuNode => {
  const colors = artifact.colors.palette;
  const fill = colors[index % Math.max(1, colors.length)]?.hex ?? artifact.colors.dominant?.hex ?? '#ffffff';
  const roleZ: Record<VisualArtifactRegion['role'], number> = {
    canvas: 0,
    content: 10,
    sidebar: 20,
    header: 30,
    footer: 30,
    unknown: 12,
  };
  const rect = { x: region.box.x, y: region.box.y, width: region.box.width, height: region.box.height };
  return {
    id: `region-${region.id}`,
    parentId: region.role === 'canvas' ? null : 'region-canvas',
    name: region.label,
    kind: 'frame',
    rect,
    zIndex: roleZ[region.role],
    content: '',
    visible: true,
    locked: region.role === 'canvas',
    style: { fill, opacity: region.role === 'canvas' ? 1 : 0.2, overflow: 'hidden' },
    sourceTrace: { source: 'image', imagePath: artifact.source.path, originalRect: rect },
    fidelity: {
      strategy: region.role === 'canvas' ? 'raster' : 'native',
      confidence: region.confidence,
      editableDepth: region.role === 'canvas' ? 'surface' : 'properties',
      notes:
        region.role === 'canvas'
          ? ['The original raster remains the visual source of truth.']
          : ['Region role is inferred from one image.'],
    },
  };
};

const tileNode = (tile: DepthTile, imagePath: string): ViuNode => ({
  id: tile.id,
  parentId: 'region-canvas',
  name: `Depth evidence ${tile.id.slice('depth-'.length)}`,
  kind: 'shape',
  rect: tile.rect,
  zIndex: tile.zIndex,
  content: '',
  visible: true,
  locked: false,
  style: { fill: tile.color, opacity: 0.12, borderColor: tile.color, borderWidth: 1 },
  sourceTrace: { source: 'image', imagePath, originalRect: tile.rect },
  fidelity: {
    strategy: 'native',
    confidence: tile.confidence,
    editableDepth: 'properties',
    notes: [
      'Z-order is inferred from local contrast and occlusion evidence; a single raster cannot prove hidden geometry.',
    ],
  },
});

export const analyzeImageProject = async (request: ViuImageRequest, now = new Date()): Promise<ViuProject> => {
  const path = request.path.trim();
  const mimeType = safeMime(path);
  if (!mimeType) throw new Error('Viu supports PNG, JPEG, WebP, GIF and AVIF reference images.');
  const file = await stat(path);
  if (!file.isFile()) throw new Error('The selected Viu reference is not a file.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('The selected Viu image exceeds the 16 MB analysis limit.');
  const [artifact, bytes] = await Promise.all([
    analyzeVisualArtifact(path, { mimeType, generatedAt: now }),
    readFile(path),
  ]);
  const inferredDepth = await depthTiles(path, artifact.image.width, artifact.image.height);
  const nodes = [
    ...artifact.regions.map((region, index) => regionNode(region, artifact, index)),
    ...inferredDepth.map((tile) => tileNode(tile, path)),
  ];
  const projectId = `viu-image-${randomUUID()}`;
  const documentId = `${projectId}-reference`;
  const createdAt = now.toISOString();
  const colors = artifact.colors.palette.map((color) => color.hex);
  const previewDataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  const document: ViuDocument = {
    schemaVersion: '1',
    id: documentId,
    title: 'Image reference',
    sourceKind: 'image',
    sourceLabel: path,
    viewport: {
      width: Math.max(320, Math.min(3840, artifact.image.width)),
      height: Math.max(240, Math.min(2160, artifact.image.height)),
    },
    page: {
      width: artifact.image.width,
      height: artifact.image.height,
      background: artifact.colors.dominant?.hex ?? '#ffffff',
    },
    nodes,
    tokens: {
      colors,
      fontFamilies: [],
      spacing: [4, 8, 12, 16, 24, 32, 48, 64],
      radii: [0, 4, 8, 12, 16, 24],
    },
    interactions: [],
    motion: [],
    limitations: [
      ...artifact.notes,
      'One image does not reveal hidden layers, DOM semantics, responsive rules, hover states or motion timelines.',
      'Viu keeps the raster as reference evidence while exposing inferred regions and depth tiles for progressive editing.',
    ],
    referencePreviewDataUrl: previewDataUrl,
    createdAt,
  };
  return {
    schemaVersion: '1',
    id: projectId,
    title: path.split(/[\\/]/u).pop() ?? 'Image reference',
    sourceKind: 'image',
    prompt: 'Reconstruct the selected image as an editable Visual UI.',
    improvedPrompt: `Reconstruct the supplied ${artifact.image.width}x${artifact.image.height} reference. Preserve the raster as fidelity evidence, expose inferred regions and z-order with confidence, and validate responsive behavior rather than inventing hidden states.`,
    improveMode: 'faithful',
    documents: [document],
    activeDocumentId: documentId,
    referencePreviewDataUrl: previewDataUrl,
    referencePath: path,
    createdAt,
    updatedAt: createdAt,
  };
};
