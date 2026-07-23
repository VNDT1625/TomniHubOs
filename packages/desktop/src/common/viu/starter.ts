/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CreateViuNodeInput, ViuNode, ViuProjectState, ViuSemantics } from './types';

const DEFAULT_SEMANTICS: ViuSemantics = { role: 'none', label: '' };

/** Creates a complete node with editor-safe defaults. */
export function createViuNode(input: CreateViuNodeInput): ViuNode {
  return {
    id: input.id,
    version: 1,
    name: input.name,
    type: input.type,
    parentId: input.parentId ?? null,
    childIds: [],
    localTransform: [1, 0, 0, 1, input.x ?? 0, input.y ?? 0],
    size: { width: input.width ?? 160, height: input.height ?? 48 },
    positionMode: 'absolute',
    sizing: { horizontal: 'fixed', vertical: 'fixed' },
    constraints: { horizontal: 'left', vertical: 'top' },
    style: { opacity: 1, ...input.style },
    content: input.text === undefined ? undefined : { text: input.text },
    vector: input.vector,
    semantics: { ...DEFAULT_SEMANTICS, label: input.name, ...input.semantics },
    behaviorBindings: [],
    visible: true,
    locked: false,
    provenance: input.provenance ?? { source: 'user' },
  };
}

function attach(nodes: Record<string, ViuNode>, parentId: string, ...childIds: string[]): void {
  nodes[parentId]!.childIds.push(...childIds);
}

/** Builds an immediately presentable, fully editable two-screen native VIU starter. */
export function createPremiumStarterProject(projectId = 'viu-premium-starter'): ViuProjectState {
  const provenance = { source: 'starter' } as const;
  const nodes: Record<string, ViuNode> = {
    'node-home-root': createViuNode({
      id: 'node-home-root',
      name: 'Obsidian Home',
      type: 'frame',
      width: 1440,
      height: 1024,
      style: {
        background: 'linear-gradient(145deg, #0b1020 0%, #171b36 52%, #071017 100%)',
        overflow: 'hidden',
      },
      semantics: { role: 'region', label: 'Home screen' },
      provenance,
    }),
    'node-home-kicker': createViuNode({
      id: 'node-home-kicker',
      name: 'Kicker',
      type: 'text',
      parentId: 'node-home-root',
      x: 96,
      y: 112,
      width: 520,
      height: 32,
      text: 'A NEW DIMENSION OF FORM',
      style: { color: 'rgba(199, 255, 228, 0.82)', fontSize: 14, fontWeight: 600, letterSpacing: 4 },
      semantics: { role: 'paragraph', label: 'Product introduction' },
      provenance,
    }),
    'node-home-title': createViuNode({
      id: 'node-home-title',
      name: 'Hero title',
      type: 'text',
      parentId: 'node-home-root',
      x: 88,
      y: 168,
      width: 790,
      height: 260,
      text: 'Matter, made\nimpossible.',
      style: { color: '#f5f7ff', fontSize: 104, fontWeight: 520, lineHeight: 0.94, letterSpacing: -5 },
      semantics: { role: 'heading', label: 'Matter, made impossible', headingLevel: 1 },
      provenance,
    }),
    'node-home-copy': createViuNode({
      id: 'node-home-copy',
      name: 'Hero copy',
      type: 'text',
      parentId: 'node-home-root',
      x: 96,
      y: 478,
      width: 480,
      height: 92,
      text: 'A cinematic material system shaped for spatial interfaces, product stories, and motion-led experiences.',
      style: { color: 'rgba(229, 235, 255, 0.7)', fontSize: 20, lineHeight: 1.5 },
      semantics: { role: 'paragraph', label: 'Product summary' },
      provenance,
    }),
    'node-home-cta': createViuNode({
      id: 'node-home-cta',
      name: 'Explore collection',
      type: 'control',
      parentId: 'node-home-root',
      x: 96,
      y: 620,
      width: 224,
      height: 60,
      text: 'Explore the collection \u2192',
      style: {
        background: '#c8ffe3',
        color: '#09120f',
        fontSize: 15,
        fontWeight: 650,
        borderRadius: 30,
        shadow: '0 18px 55px rgba(44, 255, 160, 0.18)',
      },
      semantics: { role: 'button', label: 'Explore the collection' },
      provenance,
    }),
    'node-home-orb': createViuNode({
      id: 'node-home-orb',
      name: 'Spatial object',
      type: 'model-3d',
      parentId: 'node-home-root',
      x: 770,
      y: 92,
      width: 590,
      height: 760,
      style: {
        background:
          'radial-gradient(circle at 38% 32%, rgba(203,255,229,.92), rgba(61,106,255,.58) 36%, rgba(10,16,35,0) 70%)',
        borderRadius: 296,
        opacity: 0.92,
      },
      semantics: { role: 'image', label: 'Iridescent spatial product form' },
      provenance,
    }),
    'node-showcase-root': createViuNode({
      id: 'node-showcase-root',
      name: 'Collection',
      type: 'frame',
      width: 1440,
      height: 1024,
      style: {
        background: 'linear-gradient(180deg, #f3efe6 0%, #dfe9e3 100%)',
        overflow: 'hidden',
      },
      semantics: { role: 'region', label: 'Collection screen' },
      provenance,
    }),
    'node-showcase-title': createViuNode({
      id: 'node-showcase-title',
      name: 'Collection title',
      type: 'text',
      parentId: 'node-showcase-root',
      x: 88,
      y: 92,
      width: 760,
      height: 120,
      text: 'Tactile futures.',
      style: { color: '#14211c', fontSize: 84, fontWeight: 540, letterSpacing: -4 },
      semantics: { role: 'heading', label: 'Tactile futures', headingLevel: 1 },
      provenance,
    }),
    'node-showcase-card': createViuNode({
      id: 'node-showcase-card',
      name: 'Material story',
      type: 'frame',
      parentId: 'node-showcase-root',
      x: 88,
      y: 292,
      width: 1264,
      height: 510,
      style: {
        background: 'linear-gradient(130deg, rgba(17,32,27,.98), rgba(42,72,61,.88))',
        borderRadius: 42,
        shadow: '0 28px 80px rgba(14,32,24,.2)',
      },
      semantics: { role: 'region', label: 'Featured material story' },
      provenance,
    }),
    'node-showcase-copy': createViuNode({
      id: 'node-showcase-copy',
      name: 'Story copy',
      type: 'text',
      parentId: 'node-showcase-card',
      x: 64,
      y: 70,
      width: 600,
      height: 190,
      text: 'Reactive surfaces\nfor living systems.',
      style: { color: '#f0fff7', fontSize: 58, fontWeight: 520, lineHeight: 1.04, letterSpacing: -2 },
      semantics: { role: 'heading', label: 'Reactive surfaces for living systems', headingLevel: 2 },
      provenance,
    }),
    'node-showcase-back': createViuNode({
      id: 'node-showcase-back',
      name: 'Back home',
      type: 'control',
      parentId: 'node-showcase-root',
      x: 88,
      y: 884,
      width: 170,
      height: 52,
      text: '\u2190 Back home',
      style: { background: '#14211c', color: '#effff7', fontSize: 15, fontWeight: 620, borderRadius: 26 },
      semantics: { role: 'button', label: 'Back home' },
      provenance,
    }),
  };
  attach(
    nodes,
    'node-home-root',
    'node-home-kicker',
    'node-home-title',
    'node-home-copy',
    'node-home-cta',
    'node-home-orb'
  );
  attach(nodes, 'node-showcase-root', 'node-showcase-title', 'node-showcase-card', 'node-showcase-back');
  attach(nodes, 'node-showcase-card', 'node-showcase-copy');
  nodes['node-home-cta']!.behaviorBindings.push('interaction-home-showcase');
  nodes['node-showcase-back']!.behaviorBindings.push('interaction-showcase-home');

  return {
    schemaVersion: 3,
    projectId,
    title: 'Obsidian Matter \u00b7 Premium Starter',
    revision: 0,
    canvasPages: {
      'page-main': { id: 'page-main', name: 'Website', screenIds: ['screen-home', 'screen-showcase'] },
    },
    pageOrder: ['page-main'],
    screens: {
      'screen-home': {
        id: 'screen-home',
        name: 'Home',
        route: '/',
        canvasPageId: 'page-main',
        rootNodeId: 'node-home-root',
        required: true,
        viewport: { name: 'desktop', width: 1440, height: 1024 },
      },
      'screen-showcase': {
        id: 'screen-showcase',
        name: 'Collection',
        route: '/collection',
        canvasPageId: 'page-main',
        rootNodeId: 'node-showcase-root',
        required: true,
        viewport: { name: 'desktop', width: 1440, height: 1024 },
      },
    },
    screenOrder: ['screen-home', 'screen-showcase'],
    nodes,
    components: {},
    componentSets: {},
    tokens: {
      colors: { ink: '#0b1020', paper: '#f3efe6', accent: '#c8ffe3' },
      typography: {
        display: { fontFamily: 'Inter, sans-serif', fontSize: 104, fontWeight: 520, lineHeight: 0.94 },
      },
      spacing: { xs: 8, sm: 16, md: 24, lg: 48, xl: 96 },
      radii: { control: 30, card: 42 },
    },
    variableCollections: {
      foundation: {
        id: 'foundation',
        name: 'Foundation',
        defaultModeId: 'light',
        modeIds: ['light', 'dark', 'brand'],
        modes: {
          light: { id: 'light', name: 'Light', kind: 'light' },
          dark: { id: 'dark', name: 'Dark', kind: 'dark' },
          brand: { id: 'brand', name: 'Brand', kind: 'brand' },
        },
      },
    },
    activeVariableModes: { foundation: 'dark' },
    variables: {
      'color-ink': {
        id: 'color-ink',
        name: 'Color / Ink',
        collectionId: 'foundation',
        type: 'color',
        valuesByMode: { light: '#0b1020', dark: '#f3efe6', brand: '#0b1020' },
      },
      'color-accent': {
        id: 'color-accent',
        name: 'Color / Accent',
        collectionId: 'foundation',
        type: 'color',
        valuesByMode: { light: '#86e8ba', dark: '#c8ffe3', brand: '#c8ffe3' },
      },
      'space-md': {
        id: 'space-md',
        name: 'Space / Medium',
        collectionId: 'foundation',
        type: 'number',
        valuesByMode: { light: 24, dark: 24, brand: 24 },
      },
    },
    breakpoints: {
      desktop: { id: 'desktop', name: 'Desktop', preset: 'desktop', minWidth: 1024 },
      tablet: { id: 'tablet', name: 'Tablet', preset: 'tablet', minWidth: 768, maxWidth: 1023 },
      mobile: { id: 'mobile', name: 'Mobile', preset: 'mobile', minWidth: 0, maxWidth: 767 },
    },
    guides: [],
    snapSettings: {
      enabled: true,
      pixelGrid: 1,
      threshold: 6,
      snapToGuides: true,
      snapToObjects: true,
    },
    flows: {
      'flow-primary': {
        id: 'flow-primary',
        name: 'Primary journey',
        startScreenId: 'screen-home',
        requiredScreenIds: ['screen-home', 'screen-showcase'],
        interactionIds: ['interaction-home-showcase', 'interaction-showcase-home'],
      },
    },
    interactions: {
      'interaction-home-showcase': {
        id: 'interaction-home-showcase',
        version: 1,
        flowId: 'flow-primary',
        sourceNodeId: 'node-home-cta',
        trigger: 'click',
        action: { type: 'navigate', targetScreenId: 'screen-showcase' },
      },
      'interaction-showcase-home': {
        id: 'interaction-showcase-home',
        version: 1,
        flowId: 'flow-primary',
        sourceNodeId: 'node-showcase-back',
        trigger: 'click',
        action: { type: 'navigate', targetScreenId: 'screen-home' },
      },
    },
    timelines: {},
    assets: {},
    dataSources: {},
    scenarios: {
      'scenario-primary': { id: 'scenario-primary', name: 'Explore collection', flowId: 'flow-primary' },
    },
  };
}
