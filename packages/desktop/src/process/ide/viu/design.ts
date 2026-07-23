/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  ViuCreateRequest,
  ViuDocument,
  ViuImproveMode,
  ViuNode,
  ViuProject,
  ViuRect,
  ViuSourceKind,
} from './types';

const MAX_PROMPT_CHARS = 12_000;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizePrompt = (prompt: string): string => {
  const value = prompt.normalize('NFKC').trim();
  if (!value) throw new Error('A Viu prompt is required.');
  if (value.length > MAX_PROMPT_CHARS)
    throw new Error(`A Viu prompt may contain at most ${MAX_PROMPT_CHARS} characters.`);
  return value;
};

const slug = (value: string, fallback: string): string => {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
};

const paletteFor = (prompt: string, mode: ViuImproveMode): string[] => {
  const lower = prompt.toLowerCase();
  if (/luxury|premium|cao cấp|sang trọng/u.test(lower)) return ['#0d0d0f', '#f4efe4', '#c7a86b', '#ffffff', '#6d675e'];
  if (/nature|green|eco|thiên nhiên|xanh lá/u.test(lower))
    return ['#eef4ec', '#18352a', '#3f7d5a', '#ffffff', '#91b6a0'];
  if (/dark|cyber|gaming|tối|neon/u.test(lower)) return ['#0b0d12', '#f4f7ff', '#29d3c2', '#161b25', '#7e8ba3'];
  if (mode === 'creative') return ['#f7f1e8', '#16191f', '#e7603b', '#fffaf3', '#3d68d8'];
  if (mode === 'professional') return ['#f4f6f8', '#17202a', '#2563eb', '#ffffff', '#64748b'];
  return ['#f5f4ef', '#181a1f', '#335dff', '#ffffff', '#737780'];
};

const node = (
  id: string,
  name: string,
  kind: ViuNode['kind'],
  rect: ViuRect,
  zIndex: number,
  content: string,
  style: ViuNode['style'],
  sourceKind: ViuSourceKind,
  parentId: string | null = null
): ViuNode => ({
  id,
  parentId,
  name,
  kind,
  rect,
  zIndex,
  content,
  visible: true,
  locked: false,
  style,
  sourceTrace: { source: sourceKind, originalRect: rect },
  fidelity: { strategy: 'native', confidence: sourceKind === 'prompt' ? 0.82 : 0.96, editableDepth: 'full', notes: [] },
});

const titleFromPrompt = (prompt: string): string => {
  const first =
    prompt
      .split(/[.!?\n]/u)
      .map((part) => part.trim())
      .find(Boolean) ?? 'Visual UI';
  return first.slice(0, 80);
};

export const createPromptProject = (request: ViuCreateRequest, now = new Date()): ViuProject => {
  const prompt = normalizePrompt(request.prompt);
  const mode = request.mode ?? 'professional';
  const width = clamp(Math.round(request.viewport?.width ?? 1440), 320, 3840);
  const height = clamp(Math.round(request.viewport?.height ?? 900), 240, 2160);
  const colors = paletteFor(prompt, mode);
  const title = titleFromPrompt(prompt);
  const projectId = `viu-${slug(title, randomUUID().slice(0, 8))}-${randomUUID().slice(0, 8)}`;
  const documentId = `${projectId}-home`;
  const heroHeight = Math.max(470, Math.round(height * 0.68));
  const pageHeight = Math.max(height, heroHeight + 620);
  const cardWidth = Math.round((width - 160 - 48) / 3);
  const nodes: ViuNode[] = [
    node(
      'page-background',
      'Page background',
      'frame',
      { x: 0, y: 0, width, height: pageHeight },
      0,
      '',
      { fill: colors[0] },
      'prompt'
    ),
    node(
      'nav',
      'Navigation',
      'frame',
      { x: 48, y: 24, width: width - 96, height: 64 },
      10,
      '',
      { fill: colors[3], radius: 18, shadow: '0 12px 40px rgba(0,0,0,.08)' },
      'prompt'
    ),
    node(
      'brand',
      'Brand',
      'text',
      { x: 76, y: 43, width: 220, height: 28 },
      11,
      title.split(' ').slice(0, 3).join(' '),
      { color: colors[1], fontSize: 20, fontWeight: 700 },
      'prompt',
      'nav'
    ),
    node(
      'nav-cta',
      'Navigation action',
      'button',
      { x: width - 220, y: 36, width: 144, height: 40 },
      12,
      'Get started',
      { fill: colors[2], color: colors[3], radius: 12, fontSize: 14, fontWeight: 650 },
      'prompt',
      'nav'
    ),
    node(
      'hero-kicker',
      'Hero eyebrow',
      'text',
      { x: 80, y: 150, width: 420, height: 28 },
      20,
      mode === 'creative' ? 'A DIFFERENT POINT OF VIEW' : 'DESIGNED WITH INTENT',
      { color: colors[2], fontSize: 13, fontWeight: 700 },
      'prompt'
    ),
    node(
      'hero-title',
      'Hero title',
      'text',
      { x: 80, y: 194, width: Math.round(width * 0.52), height: 170 },
      20,
      title,
      { color: colors[1], fontSize: width > 900 ? 72 : 48, fontWeight: 760, lineHeight: 1.02 },
      'prompt'
    ),
    node(
      'hero-copy',
      'Hero description',
      'text',
      { x: 84, y: 390, width: Math.round(width * 0.42), height: 92 },
      20,
      prompt.slice(0, 260),
      { color: colors[4], fontSize: 18, lineHeight: 1.55 },
      'prompt'
    ),
    node(
      'hero-action',
      'Primary action',
      'button',
      { x: 84, y: 514, width: 176, height: 52 },
      22,
      'Explore experience',
      { fill: colors[2], color: colors[3], radius: 16, fontSize: 15, fontWeight: 700 },
      'prompt'
    ),
    node(
      'hero-visual',
      'Hero visual',
      'shape',
      { x: Math.round(width * 0.61), y: 138, width: Math.round(width * 0.31), height: 420 },
      18,
      '',
      {
        fill: colors[3],
        radius: mode === 'creative' ? 88 : 32,
        shadow: '0 28px 90px rgba(0,0,0,.14)',
        transform: mode === 'creative' ? 'rotate(4deg)' : undefined,
      },
      'prompt'
    ),
    node(
      'hero-orbit',
      'Depth accent',
      'shape',
      { x: Math.round(width * 0.68), y: 210, width: 250, height: 250 },
      19,
      '',
      {
        fill: colors[2],
        radius: 125,
        opacity: 0.88,
        transform: mode === 'creative' ? 'translate(26px,-18px)' : undefined,
      },
      'prompt',
      'hero-visual'
    ),
    node(
      'features-title',
      'Features heading',
      'text',
      { x: 80, y: heroHeight + 90, width: width - 160, height: 54 },
      20,
      'A clear system before code',
      { color: colors[1], fontSize: 38, fontWeight: 720 },
      'prompt'
    ),
    ...['Structure', 'Experience', 'Delivery'].flatMap((label, index) => {
      const x = 80 + index * (cardWidth + 24);
      const id = `feature-${index + 1}`;
      return [
        node(
          id,
          `${label} card`,
          'frame',
          { x, y: heroHeight + 180, width: cardWidth, height: 260 },
          10,
          '',
          { fill: colors[3], radius: 24, borderColor: colors[0], borderWidth: 1 },
          'prompt'
        ),
        node(
          `${id}-index`,
          `${label} index`,
          'text',
          { x: x + 24, y: heroHeight + 208, width: 60, height: 24 },
          11,
          `0${index + 1}`,
          { color: colors[2], fontSize: 13, fontWeight: 750 },
          'prompt',
          id
        ),
        node(
          `${id}-title`,
          `${label} title`,
          'text',
          { x: x + 24, y: heroHeight + 258, width: cardWidth - 48, height: 38 },
          11,
          label,
          { color: colors[1], fontSize: 25, fontWeight: 700 },
          'prompt',
          id
        ),
        node(
          `${id}-copy`,
          `${label} copy`,
          'text',
          { x: x + 24, y: heroHeight + 314, width: cardWidth - 48, height: 96 },
          11,
          [
            'A responsive layout with explicit constraints.',
            'States, motion and interaction are visible before implementation.',
            'The approved Viu contract guides the coding agent.',
          ][index] ?? '',
          { color: colors[4], fontSize: 15, lineHeight: 1.5 },
          'prompt',
          id
        ),
      ];
    }),
  ];
  const createdAt = now.toISOString();
  const document: ViuDocument = {
    schemaVersion: '1',
    id: documentId,
    title: 'Home',
    sourceKind: 'prompt',
    sourceLabel: prompt,
    viewport: { width, height },
    page: { width, height: pageHeight, background: colors[0] },
    nodes,
    tokens: {
      colors,
      fontFamilies: ['Manrope', 'Newsreader'],
      spacing: [4, 8, 12, 16, 24, 32, 48, 64, 80],
      radii: [8, 12, 16, 24, 32],
    },
    interactions: [
      { id: 'nav-cta-click', nodeId: 'nav-cta', trigger: 'click', action: 'scrollTo', target: 'features-title' },
      {
        id: 'hero-action-click',
        nodeId: 'hero-action',
        trigger: 'click',
        action: 'scrollTo',
        target: 'features-title',
      },
    ],
    motion: [
      {
        id: 'hero-reveal',
        nodeId: 'hero-title',
        trigger: 'load',
        property: 'opacity',
        from: '0',
        to: '1',
        durationMs: 520,
      },
      {
        id: 'hero-depth',
        nodeId: 'hero-orbit',
        trigger: 'scroll',
        property: 'transform',
        from: 'translateY(0)',
        to: 'translateY(72px)',
        durationMs: 900,
      },
    ],
    limitations: ['Prompt-created structure is a design proposal and must be reviewed before code generation.'],
    createdAt,
  };
  const improvedPrompt = `${prompt}\n\nViu direction: ${mode}; preserve responsive hierarchy, explicit states, depth, motion, accessibility and measurable visual acceptance criteria.`;
  return {
    schemaVersion: '1',
    id: projectId,
    title,
    sourceKind: 'prompt',
    prompt,
    improvedPrompt,
    improveMode: mode,
    documents: [document],
    activeDocumentId: documentId,
    createdAt,
    updatedAt: createdAt,
  };
};

const sortSerializableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortSerializableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortSerializableValue(entry)])
  );
};

/** Stable JSON used as the immutable contract payload and digest source. */
export const canonicalProjectJson = (project: ViuProject): string =>
  JSON.stringify(sortSerializableValue(project), null, 2);

export const projectDigest = (project: ViuProject): string =>
  createHash('sha256').update(canonicalProjectJson(project), 'utf8').digest('hex');

export const buildViuAgentPrompt = (project: ViuProject, contractPath: string, digest: string): string => {
  const active = project.documents.find((document) => document.id === project.activeDocumentId) ?? project.documents[0];
  if (!active) throw new Error('The Viu project has no active document.');
  return [
    '/viu code',
    '',
    'Implement the approved Visual UI contract in the current repository.',
    `Contract: ${contractPath}`,
    `SHA-256: ${digest}`,
    '',
    'Non-negotiable handoff rules:',
    '1. Read the contract before editing code. Recompute SHA-256 from the exact contract file bytes and stop if it differs from the digest above. Do not reinterpret the original prompt as a replacement design.',
    '2. Inspect the repository architecture, UI stack, routes and tests before choosing integration points.',
    '3. Preserve unrelated code and existing conventions. Reuse the project design system when it can express the contract without visual drift.',
    '4. Implement responsive layout, z-order, states, interactions, motion and runtime fallbacks recorded in the contract.',
    '5. Keep node IDs or an equivalent trace map so visual differences can be tied back to Viu layers.',
    '6. Run the application and compare the required viewports against the contract/reference. Report limitations instead of hiding them.',
    '',
    `Active design: ${active.title} (${active.viewport.width}x${active.viewport.height}), ${active.nodes.length} layers.`,
    `Design intent: ${project.improvedPrompt || project.prompt}`,
  ].join('\n');
};
