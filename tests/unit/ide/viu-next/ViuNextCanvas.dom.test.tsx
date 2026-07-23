/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject } from '@/common/viu';
import ViuNextCanvas, { type ViuNextLabels } from '@/renderer/pages/studio/ide/Viu/next';

const labels: ViuNextLabels = {
  productName: 'Viu Next',
  modes: {
    design: 'Design',
    prototype: 'Prototype',
    present: 'Present',
  },
  teamPreview: {
    publish: 'Publish to Team',
    publishing: 'Publishing...',
    published: 'Published',
    copyReference: 'Copy local reference',
    unavailable: 'Open a project folder',
    success: 'Published successfully',
    error: 'Publish failed',
    referenceCopied: 'Reference copied',
    purpose: 'Interactive preview',
  },

  sidebar: {
    pages: 'Pages',
    layers: 'Layers',
    assets: 'Assets',
    components: 'Components',
  },
  add: {
    frame: 'Frame',
    text: 'Text',
    button: 'Button',
    shape: 'Shape',
    pen: 'Pen',
  },
  canvas: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    panHint: 'Drag the canvas to pan',
  },
  vectorEdit: {
    enter: 'Edit vector',
    exit: 'Exit vector edit',
    openPath: 'Open path',
    closePath: 'Close path',
    union: 'Union',
    subtract: 'Subtract',
    intersect: 'Intersect',
    exclude: 'Exclude',
    clipMask: 'Clip mask',
    alphaMask: 'Alpha mask',
    releaseMask: 'Release mask',
    reorderMask: 'Reorder mask',
  },

  present: {
    back: 'Back',
    closeOverlay: 'Close overlay',
    empty: 'Nothing to present',
    route: 'Route',
    exit: 'Exit presentation',
  },
  authoring: {
    title: 'Authoring',
    selectionCount: (count) => `${count} selected`,
    mixed: 'Mixed',
    text: {
      section: 'Text',
      content: 'Content',
      placeholder: 'Enter text',
    },
    typography: {
      section: 'Typography',
      fontFamily: 'Font family',
      loadSystemFonts: 'Load system fonts',
      loadingSystemFonts: 'Loading fonts',
      systemFontsCount: (count) => `${count} fonts`,
      fontAccessDenied: 'Font access denied',
      fontUnsupported: 'Local fonts unsupported',
      fontSize: 'Font size',
      fontWeight: 'Font weight',
      fontStyle: 'Style',
      styleNormal: 'Normal',
      styleItalic: 'Italic',
      styleOblique: 'Oblique',
      lineHeight: 'Line height',
      letterSpacing: 'Letter spacing',
      decoration: 'Decoration',
      underline: 'Underline',
      strikethrough: 'Strikethrough',
      letterCase: 'Letter case',
      caseOriginal: 'Original',
      caseUppercase: 'Uppercase',
      caseLowercase: 'Lowercase',
      caseCapitalize: 'Capitalize',
      horizontalAlignment: 'Horizontal alignment',
      verticalAlignment: 'Vertical alignment',
      alignLeft: 'Align left',
      alignCenter: 'Align center',
      alignRight: 'Align right',
      alignJustify: 'Justify',
      alignTop: 'Align top',
      alignMiddle: 'Align middle',
      alignBottom: 'Align bottom',
    },
    vector: {
      section: 'Vector',
      pathData: 'SVG path',
      invalidPath: 'Invalid SVG path',
      closed: 'Closed path',
      fillRule: 'Fill rule',
      nonzero: 'Non-zero',
      evenodd: 'Even-odd',
      strokeCap: 'Stroke cap',
      strokeJoin: 'Stroke join',
      miterLimit: 'Miter limit',
      butt: 'Butt',
      round: 'Round',
      square: 'Square',
      miter: 'Miter',
      bevel: 'Bevel',
      anchors: 'Anchors',
      addAnchor: 'Add anchor',
      removeAnchor: 'Remove anchor',
      removeHandle: 'Remove handle',
      pointType: 'Point type',
      corner: 'Corner',
      smooth: 'Smooth',
      symmetric: 'Symmetric',
      handleIn: 'Incoming handle',
      handleOut: 'Outgoing handle',
      x: 'X',
      y: 'Y',
    },
    component: {
      section: 'Components',
      createComponent: 'Create component',
      createInstance: 'Create instance',
      combineVariants: 'Combine variants',
      mainComponent: 'Main component',
      instance: 'Instance',
      variant: 'Variant',
      stateAxis: 'State',
      properties: 'Properties',
      resetOverrides: 'Reset overrides',
      detachInstance: 'Detach instance',
      emptyProperties: 'No properties',
      missingComponent: 'Missing component',
      componentSet: 'Component set',
      defaultVariant: 'Default variant',
    },
    prototype: {
      section: 'Prototype',
      bindings: 'Interaction',
      addInteraction: 'Add interaction',
      noSelection: 'Select one object',
      noFlow: 'Create a flow',
      trigger: 'Trigger',
      click: 'Click',
      hover: 'Hover',
      focus: 'Focus',
      submit: 'Submit',
      scroll: 'Scroll',
      load: 'Load',
      action: 'Action',
      navigate: 'Navigate',
      openOverlay: 'Open overlay',
      scrollTo: 'Scroll to',
      closeOverlay: 'Close overlay',
      back: 'Back',
      setVariable: 'Set variable',
      toggleVariable: 'Toggle variable',
      playTimeline: 'Play timeline',
      pauseTimeline: 'Pause timeline',
      seekTimeline: 'Seek timeline',
      value: 'Value',
      condition: 'Condition',
      conditionNone: 'No condition',
      conditionTruthy: 'Truthy',
      conditionFalsy: 'Falsy',
      conditionEq: 'Equals',
      conditionNeq: 'Not equal',
      conditionGt: 'Greater than',
      conditionGte: 'Greater or equal',
      conditionLt: 'Less than',
      conditionLte: 'Less or equal',
      addAction: 'Add action',
      moveUp: 'Move up',
      moveDown: 'Move down',
      timeline: 'Timeline',
      keyframes: 'Keyframes',
      position: 'Position',
      destination: 'Destination',
      transition: 'Transition',
      presetNone: 'Instant',
      presetFade: 'Fade',
      presetRise: 'Rise',
      presetScale: 'Scale',
      presetSlideLeft: 'Slide left',
      presetSlideRight: 'Slide right',
      presetBlur: 'Blur in',
      presetReveal: 'Reveal',
      presetSmartAnimate: 'Smart animate',
      duration: 'Duration',
      easing: 'Easing',
      easingLinear: 'Linear',
      easingEase: 'Ease',
      easingIn: 'Ease in',
      easingOut: 'Ease out',
      easingInOut: 'Ease in-out',
      easingSpring: 'Soft spring',
      remove: 'Remove interaction',
      disconnectedScreens: (count) => `${count} disconnected`,
    },
    layout: {
      section: 'Auto layout',
      mode: 'Direction',
      none: 'None',
      horizontal: 'Horizontal',
      vertical: 'Vertical',
      grid: 'Grid',
      gap: 'Gap',
      padding: 'Padding',
      top: 'Top',
      right: 'Right',
      bottom: 'Bottom',
      left: 'Left',
      alignment: 'Alignment',
      distribution: 'Distribution',
      start: 'Start',
      center: 'Center',
      end: 'End',
      stretch: 'Stretch',
      spaceBetween: 'Space between',
      wrap: 'Wrap',
      columns: 'Columns',
      childSizing: 'Child sizing',
      position: 'Position',
      flow: 'Flow',
      absolute: 'Absolute',
      width: 'Width',
      height: 'Height',
      fixed: 'Fixed',
      fill: 'Fill',
      hug: 'Hug',
      minWidth: 'Min width',
      maxWidth: 'Max width',
      minHeight: 'Min height',
      maxHeight: 'Max height',
      constraints: 'Constraints',
      designSystem: 'Design system',
      activeMode: 'Active mode',
      responsive: 'Responsive',
      breakpoint: 'Breakpoint',
      base: 'Base',
      computed: 'Computed',
      backgroundToken: 'Background token',
      gapToken: 'Gap token',
      noVariable: 'No variable',
      rotation: 'Rotation',
      cornerRadii: 'Corner radii',
      strokeAlignment: 'Stroke alignment',
      strokeInside: 'Inside',
      strokeCenter: 'Center',
      strokeOutside: 'Outside',
      snapping: 'Snapping',
      guideCount: (count) => `${count} guides`,
      pixelGrid: 'Pixel grid',
      snapThreshold: 'Snap threshold',
      snapToGuides: 'Snap to guides',
      snapToObjects: 'Snap to objects',
      addHorizontalGuide: 'Add horizontal guide',
      addVerticalGuide: 'Add vertical guide',
      removeGuide: 'Remove guide',
      responsiveVisible: 'Visible at breakpoint',
    },
    appearance: {
      section: 'Appearance',
      fillStack: 'Fill layers',
      effectStack: 'Effect layers',
      addFill: 'Add fill',
      addEffect: 'Add effect',
      moveUp: 'Move up',
      moveDown: 'Move down',
      remove: 'Remove',
      visible: 'Visible',
      legacyFallback: 'Raw CSS fallback',
      effectDropShadow: 'Drop shadow',
      effectInnerShadow: 'Inner shadow',
      effectLayerBlur: 'Layer blur',
      effectBackdropBlur: 'Background blur',
      radialCenterX: 'Center X',
      radialCenterY: 'Center Y',
      radialRadius: 'Radius',
      textColor: 'Text color',
      background: 'Background',

      fillType: 'Fill type',
      fillSolid: 'Solid',
      fillLinear: 'Linear gradient',
      fillRadial: 'Radial gradient',
      fillStart: 'Start color',
      fillEnd: 'End color',
      gradientAngle: 'Angle',
      cssValue: 'CSS value',
      borderColor: 'Border color',
      borderWidth: 'Border width',

      borderStyle: 'Stroke style',
      borderNone: 'None',
      borderSolid: 'Solid',
      borderDashed: 'Dashed',
      borderDotted: 'Dotted',
      borderDouble: 'Double',
      overflow: 'Overflow',
      overflowVisible: 'Visible',
      overflowHidden: 'Hidden',
      overflowScroll: 'Scroll',
      opacity: 'Opacity',
      radius: 'Radius',
      shadow: 'Shadow',
      shadowPlaceholder: 'CSS box shadow',

      shadowX: 'X',
      shadowY: 'Y',
      shadowBlur: 'Blur',
      shadowSpread: 'Spread',
      shadowColor: 'Shadow color',
      layerBlur: 'Layer blur',
      backdropBlur: 'Background blur',
    },
    units: {
      pixels: 'px',
      percent: '%',
    },
  },
  authoringActions: {
    undo: 'Undo',
    redo: 'Redo',
    duplicate: 'Duplicate',
    delete: 'Delete',
    group: 'Group',
    ungroup: 'Ungroup',
    alignLeft: 'Align left',
    alignCenter: 'Align center',
    alignRight: 'Align right',
    alignTop: 'Align top',
    alignMiddle: 'Align middle',
    alignBottom: 'Align bottom',
    distributeHorizontal: 'Distribute horizontally',
    distributeVertical: 'Distribute vertically',
  },
  inspector: {
    title: 'Inspector',
    empty: 'Select a layer',
    name: 'Name',
    position: 'Position',
    size: 'Size',
    x: 'X',
    y: 'Y',
    width: 'Width',
    height: 'Height',
    type: 'Type',
    visible: 'Visible',
    locked: 'Locked',
  },
  assets: {
    title: 'Local assets',
    empty: 'Link assets without uploading.',
    linkAction: 'Link asset',

    insertAction: 'Insert asset',
  },
  componentLibrary: {
    title: 'Component library',
    searchPlaceholder: 'Search components and variants',
    empty: 'Create a component first',
    noResults: 'No matching components',
    component: 'Component',
    componentSet: 'Component set',
    variants: (count) => `${count} variants`,
    properties: (count) => `${count} properties`,
    insert: 'Insert instance',
    targetScreen: (name) => `Insert into ${name}`,
    targetUnavailable: 'Choose a screen',
    missingVariant: 'Variant unavailable',
    insertError: 'Could not insert instance',
  },
  agent: {
    title: 'Design agent',
    placeholder: 'Ask the agent to edit this design',
    send: 'Send',
  },
};

const renderCanvas = (props: Partial<React.ComponentProps<typeof ViuNextCanvas>> = {}) => {
  const onProjectChange = vi.fn();
  const result = render(
    <ConfigProvider>
      <div style={{ width: 1600, height: 1000 }}>
        <ViuNextCanvas labels={labels} onProjectChange={onProjectChange} {...props} />
      </div>
    </ConfigProvider>
  );
  return { ...result, onProjectChange };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ViuNextCanvas', () => {
  it('publishes the current design to Team and exposes its opaque local reference', () => {
    const onPublishPreview = vi.fn();
    const onCopyPreviewReference = vi.fn();
    renderCanvas({
      teamPreviewReference: 'viu-preview://team-test/preview-home',
      onPublishPreview,
      onCopyPreviewReference,
    });

    fireEvent.click(screen.getByTestId('viu-team-preview-publish'));
    expect(onPublishPreview).toHaveBeenCalledOnce();
    expect(screen.getByText('Published')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('viu-team-preview-copy'));
    expect(onCopyPreviewReference).toHaveBeenCalledOnce();
  });

  it('opens directly on a canvas with editable starter artboards', () => {
    renderCanvas();

    expect(screen.getByTestId('viu-next-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('viu-next-screen-screen-home')).toBeInTheDocument();
    expect(screen.getByTestId('viu-next-screen-screen-showcase')).toBeInTheDocument();
  });

  it('adds and selects a layer through one document transaction', () => {
    const { container, onProjectChange } = renderCanvas();
    const beforeCount = container.querySelectorAll('[data-viu-node-id]').length;

    fireEvent.click(screen.getByTestId('viu-add-text'));

    expect(container.querySelectorAll('[data-viu-node-id]')).toHaveLength(beforeCount + 1);
    expect(container.querySelector('[data-selected="true"]')).toBeInTheDocument();
    expect(onProjectChange).toHaveBeenCalledOnce();
    expect(onProjectChange.mock.calls[0]?.[1].normalizedCommands[0]?.type).toBe('insertNode');
  });

  it('collapses both property panels to create a focused canvas workspace', () => {
    renderCanvas();

    fireEvent.click(screen.getByTestId('viu-toggle-left-panel'));
    expect(screen.getByTestId('viu-left-panel')).toHaveAttribute('data-collapsed', 'true');

    fireEvent.click(screen.getByTestId('viu-toggle-right-panel'));
    expect(screen.queryByTestId('viu-right-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('viu-toggle-right-panel'));
    expect(screen.getByTestId('viu-right-panel')).toBeInTheDocument();
  });

  it('selects an existing layer and exposes resize handles in Design mode', () => {
    renderCanvas();

    fireEvent.pointerDown(screen.getByTestId('viu-next-node-node-home-cta'), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    expect(screen.getByTestId('viu-next-node-node-home-cta')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('viu-next-resize-se')).toBeInTheDocument();
  });

  it('commits edited text content and renders the new copy on the canvas', () => {
    const { onProjectChange } = renderCanvas();
    const title = screen.getByTestId('viu-next-node-node-home-title');

    fireEvent.pointerDown(title, { pointerId: 1, clientX: 100, clientY: 100 });
    const editor = screen.getByTestId('viu-authoring-text-content');
    fireEvent.change(editor, { target: { value: 'V?t ch?t, v??t gi?i h?n.' } });
    fireEvent.blur(editor);

    expect(onProjectChange).toHaveBeenCalledOnce();
    expect(onProjectChange.mock.calls[0]?.[0].nodes['node-home-title'].content?.text).toBe('V?t ch?t, v??t gi?i h?n.');
    expect(title).toHaveTextContent('V?t ch?t, v??t gi?i h?n.');
  });

  it('keeps sibling layers selected when Shift-selecting on the canvas', () => {
    renderCanvas();
    const title = screen.getByTestId('viu-next-node-node-home-title');
    const copy = screen.getByTestId('viu-next-node-node-home-copy');

    fireEvent.pointerDown(title, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(copy, { pointerId: 2, clientX: 120, clientY: 120, shiftKey: true });

    expect(title).toHaveAttribute('data-selected', 'true');
    expect(copy).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('duplicates the selected layer and restores the exact document with Undo', () => {
    const starter = createPremiumStarterProject();
    const initialNodeIds = Object.keys(starter.nodes).toSorted();
    const { onProjectChange } = renderCanvas({ project: starter });

    fireEvent.pointerDown(screen.getByTestId('viu-next-node-node-home-title'), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(screen.getByTestId('viu-authoring-duplicate'));

    const duplicatedProject = onProjectChange.mock.calls[0]?.[0];
    const duplicateId = Object.keys(duplicatedProject.nodes).find((nodeId) => !initialNodeIds.includes(nodeId));
    expect(duplicateId).toBeDefined();
    expect(screen.getByTestId(`viu-next-node-${duplicateId}`)).toHaveTextContent('Matter, made impossible.');

    fireEvent.click(screen.getByTestId('viu-authoring-undo'));

    const restoredProject = onProjectChange.mock.calls[1]?.[0];
    expect(Object.keys(restoredProject.nodes).toSorted()).toEqual(initialNodeIds);
    expect(screen.queryByTestId(`viu-next-node-${duplicateId}`)).not.toBeInTheDocument();
  });

  it('renders auto-layout containers and flow children directly on the design canvas', () => {
    const project = createPremiumStarterProject();
    const rootId = project.screens['screen-home']!.rootNodeId;
    project.nodes[rootId]!.layout = {
      mode: 'vertical',
      gap: 20,
      padding: [12, 16, 12, 16],
      align: 'center',
      justify: 'space-between',
      wrap: false,
    };
    project.nodes['node-home-title']!.positionMode = 'flow';
    renderCanvas({ project });

    expect(screen.getByTestId('viu-next-artboard-screen-home')).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      padding: '12px 16px 12px 16px',
    });
    expect(screen.getByTestId('viu-next-node-node-home-title')).toHaveStyle({ position: 'relative' });
  });

  it('runs the website runtime and click navigation in Present mode', () => {
    const { container } = renderCanvas();

    fireEvent.click(screen.getByTestId('viu-mode-present'));
    expect(screen.getByTestId('viu-next-editor')).toHaveAttribute('data-mode', 'present');
    expect(screen.queryByTestId('viu-next-toolbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-screen-id=screen-home]')).toBeInTheDocument();
    expect(container.querySelector('[data-screen-id=screen-showcase]')).not.toBeInTheDocument();

    const cta = container.querySelector<HTMLElement>('[data-viu-runtime-node-id=node-home-cta]');
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta!);

    expect(container.querySelector('[data-screen-id=screen-showcase]')).toBeInTheDocument();
    expect(container.querySelector('[data-screen-id=screen-home]')).not.toBeInTheDocument();
  });

  it('lists linked local assets and delegates linking to the host picker', () => {
    const onLinkAsset = vi.fn();
    renderCanvas({
      localAssets: [{ id: 'hero-model', displayName: 'Hero model', kind: 'glb', missing: true }],
      onLinkAsset,
    });

    fireEvent.click(screen.getByRole('button', { name: labels.sidebar.assets }));
    expect(screen.getByTestId('viu-local-asset-hero-model')).toHaveAttribute('data-missing', 'true');
    expect(screen.getByText('Hero model')).toBeInTheDocument();
    expect(screen.getByText('glb')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: labels.assets.linkAction }));
    expect(onLinkAsset).toHaveBeenCalledOnce();
  });

  it('drops a linked local asset onto the editable canvas without uploading it', () => {
    const { container, onProjectChange } = renderCanvas({
      localAssets: [
        {
          id: 'hero-image',
          protocolUrl: 'viu-asset://hero-image',
          displayName: 'Hero image',
          kind: 'image',
          missing: false,
        },
      ],
    });
    const dataTransfer = {
      types: ['application/x-viu-asset-id'],
      getData: () => 'hero-image',
      dropEffect: 'none',
    } as unknown as DataTransfer;

    fireEvent.drop(screen.getByTestId('viu-next-canvas'), {
      clientX: 420,
      clientY: 320,
      dataTransfer,
    });

    expect(onProjectChange).toHaveBeenCalledOnce();
    const nextProject = onProjectChange.mock.calls[0]?.[0];
    expect(Object.values(nextProject.nodes).some((node) => node.content?.assetId === 'hero-image')).toBe(true);
    expect(container.querySelector('img[src="viu-asset://hero-image"]')).toBeInTheDocument();
  });

  it('forwards a trimmed design request through the agent dock', () => {
    const onAgentRequest = vi.fn();
    renderCanvas({ onAgentRequest });

    fireEvent.click(screen.getByTestId('viu-next-agent-launcher'));

    fireEvent.change(screen.getByPlaceholderText(labels.agent.placeholder), {
      target: { value: '  Refine the hero rhythm  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: labels.agent.send }));

    expect(onAgentRequest).toHaveBeenCalledWith('Refine the hero rhythm');
    expect(screen.getByPlaceholderText(labels.agent.placeholder)).toHaveValue('');
  });

  it('inserts a library component into the active screen rather than beside its source', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.positionMode = 'flow';
    project.components['component-hero-title'] = {
      id: 'component-hero-title',
      version: 1,
      name: 'Hero title',
      rootNodeId: 'node-home-title',
      variantProperties: {},
      propertyDefinitions: {},
    };
    const { onProjectChange } = renderCanvas({ project });

    fireEvent.pointerDown(screen.getByTestId('viu-next-artboard-screen-showcase'));
    fireEvent.click(screen.getByTestId('viu-sidebar-components'));
    expect(screen.getByText('Insert into Collection')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('viu-component-library-insert-component-hero-title'));

    expect(onProjectChange.mock.calls[0]?.[1].normalizedCommands).toEqual([
      expect.objectContaining({
        type: 'insertNode',
        parentId: 'node-showcase-root',
        node: expect.objectContaining({
          parentId: 'node-showcase-root',
          type: 'component-instance',
          positionMode: 'absolute',
          componentInstance: expect.objectContaining({ componentId: 'component-hero-title' }),
        }),
      }),
    ]);
  });

  it('edits vector anchors directly with add, delete, multi-select, and symmetric Bezier handles', () => {
    const { container, onProjectChange } = renderCanvas();
    fireEvent.click(screen.getByTestId('viu-add-pen'));
    const insertedProject = onProjectChange.mock.calls.at(-1)?.[0];
    const vectorNode = Object.values(insertedProject.nodes).find(
      (node) => node.type === 'vector' && node.name === labels.add.pen
    );
    expect(vectorNode).toBeDefined();

    fireEvent.keyDown(window, { key: 'Enter' });
    const editor = screen.getByTestId('viu-vector-editor');
    const svg = editor.querySelector('svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 140,
      width: 240,
      height: 140,
      toJSON: () => ({}),
    });
    const contour = editor.querySelector('[data-testid^=viu-vector-contour-]')!;
    const initialPointCount = vectorNode!.vector!.points.length;

    fireEvent.doubleClick(contour, { clientX: 120, clientY: 70 });
    const afterAdd = onProjectChange.mock.calls.at(-1)?.[0].nodes[vectorNode!.id];
    expect(afterAdd.vector.points).toHaveLength(initialPointCount + 1);

    fireEvent.keyDown(window, { key: 'Delete' });
    const afterDelete = onProjectChange.mock.calls.at(-1)?.[0].nodes[vectorNode!.id];
    expect(afterDelete.vector.points).toHaveLength(initialPointCount);

    const anchors = container.querySelectorAll<SVGCircleElement>('[data-testid^=viu-vector-anchor-]');
    const firstId = anchors[0]!.getAttribute('data-testid')!.replace('viu-vector-anchor-', '');
    const secondId = anchors[1]!.getAttribute('data-testid')!.replace('viu-vector-anchor-', '');
    const beforeDrag = afterDelete.vector.points;
    fireEvent.pointerDown(anchors[0]!, { pointerId: 10 });
    fireEvent.pointerUp(svg, { pointerId: 10 });
    fireEvent.pointerDown(anchors[1]!, { pointerId: 11, shiftKey: true });
    fireEvent.pointerUp(svg, { pointerId: 11 });
    fireEvent.pointerDown(anchors[0]!, { pointerId: 12 });
    fireEvent.pointerMove(svg, { pointerId: 12, clientX: 72, clientY: 64 });
    fireEvent.pointerUp(svg, { pointerId: 12 });
    const afterMultiDrag = onProjectChange.mock.calls.at(-1)?.[0].nodes[vectorNode!.id].vector;
    const firstBefore = beforeDrag.find((point) => point.id === firstId)!;
    const secondBefore = beforeDrag.find((point) => point.id === secondId)!;
    const firstAfter = afterMultiDrag.points.find((point) => point.id === firstId)!;
    const secondAfter = afterMultiDrag.points.find((point) => point.id === secondId)!;
    expect(firstAfter.x - firstBefore.x).toBeCloseTo(secondAfter.x - secondBefore.x);
    expect(firstAfter.y - firstBefore.y).toBeCloseTo(secondAfter.y - secondBefore.y);

    const refreshedAnchor = container.querySelector<SVGCircleElement>(`[data-testid=viu-vector-anchor-${firstId}]`)!;
    fireEvent.pointerDown(refreshedAnchor, { pointerId: 13, altKey: true });
    fireEvent.pointerMove(svg, { pointerId: 13, clientX: 96, clientY: 28 });
    fireEvent.pointerUp(svg, { pointerId: 13 });
    const afterHandle = onProjectChange.mock.calls.at(-1)?.[0].nodes[vectorNode!.id].vector;
    const editedPoint = afterHandle.points.find((point) => point.id === firstId)!;
    expect(editedPoint.pointType).toBe('symmetric');
    expect(editedPoint.handleIn).toEqual({
      x: -editedPoint.handleOut.x,
      y: -editedPoint.handleOut.y,
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('viu-vector-editor')).not.toBeInTheDocument();
  }, 30_000);

  it('creates, reorders, releases, and undoes a user-authored clip mask', () => {
    const { container, onProjectChange } = renderCanvas();
    fireEvent.click(screen.getByTestId('viu-add-shape'));
    const firstSelected = container.querySelector<HTMLElement>('[data-selected=true]')!;
    fireEvent.click(screen.getByTestId('viu-add-shape'));
    fireEvent.pointerDown(firstSelected, { pointerId: 20, shiftKey: true });

    expect(container.querySelectorAll('[data-selected=true]')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('viu-vector-mask-clip'));
    const maskedProject = onProjectChange.mock.calls.at(-1)?.[0];
    const maskedNode = Object.values(maskedProject.nodes).find((node) => node.vector?.maskOperation);
    expect(maskedNode?.vector?.maskOperation).toMatchObject({ kind: 'clip' });
    const firstMaskOperand = maskedNode!.vector!.maskOperation!.maskOperandId;

    fireEvent.click(screen.getByTestId('viu-vector-mask-reorder'));
    const reordered = onProjectChange.mock.calls.at(-1)?.[0].nodes[maskedNode!.id].vector;
    expect(reordered.maskOperation.maskOperandId).not.toBe(firstMaskOperand);

    fireEvent.click(screen.getByTestId('viu-vector-mask-release'));
    const released = onProjectChange.mock.calls.at(-1)?.[0].nodes[maskedNode!.id].vector;
    expect(released.maskOperation).toBeUndefined();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    const restored = onProjectChange.mock.calls.at(-1)?.[0].nodes[maskedNode!.id].vector;
    expect(restored.maskOperation).toBeDefined();
  }, 30_000);

  it('keeps the document unchanged when no target screen is available', () => {
    const starter = createPremiumStarterProject();
    const emptyProject = {
      ...starter,
      screenOrder: [],
      screens: {},
    };
    const { onProjectChange } = renderCanvas({ project: emptyProject });

    fireEvent.click(screen.getByTestId('viu-add-frame'));

    expect(onProjectChange).not.toHaveBeenCalled();
  });
});
