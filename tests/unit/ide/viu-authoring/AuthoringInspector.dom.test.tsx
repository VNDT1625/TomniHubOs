/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject, createViuNode } from '@/common/viu';

import { createDefaultViuVectorGeometry } from '@/common/viu/graphics/vector';
import AuthoringInspector, {
  type ViuAuthoringInspectorLabels,
  type ViuAuthoringInspectorProps,
} from '@/renderer/pages/studio/ide/Viu/next/authoring';

const labels: ViuAuthoringInspectorLabels = {
  title: 'Authoring inspector',
  selectionCount: (count) => `${count} selected`,
  mixed: 'Mixed',
  text: { section: 'Content', content: 'Text content', placeholder: 'Write text' },
  typography: {
    section: 'Typography',
    fontFamily: 'Font family',
    loadSystemFonts: 'Load system fonts',
    loadingSystemFonts: 'Loading fonts',
    systemFontsCount: (count) => `${count} fonts`,
    fontAccessDenied: 'Font access denied',
    fontUnsupported: 'Local fonts unsupported',
    fontSize: 'Font size',
    fontWeight: 'Weight',
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
    action: 'Action',
    navigate: 'Navigate',
    openOverlay: 'Open overlay',
    scrollTo: 'Scroll to',
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
  image: {
    section: 'Image framing',
    fit: 'Fit',
    fitCover: 'Cover',
    fitContain: 'Contain',
    fitFill: 'Fill',
    fitNone: 'None',
    fitScaleDown: 'Scale down',
    crop: 'Crop',
    focalPoint: 'Focal point',
    rotation: 'Rotation',
    flipHorizontal: 'Flip horizontally',
    flipVertical: 'Flip vertically',
    reset: 'Reset image framing',
  },
  stroke: {
    section: 'Strokes',
    add: 'Add stroke',
    remove: 'Remove stroke',
    visible: 'Visible',
    color: 'Color',
    width: 'Width',
    alignment: 'Alignment',
    inside: 'Inside',
    center: 'Center',
    outside: 'Outside',
    cap: 'Cap',
    butt: 'Butt',
    round: 'Round',
    square: 'Square',
    join: 'Join',
    miter: 'Miter',
    bevel: 'Bevel',
    miterLimit: 'Miter limit',
    dashPattern: 'Dash pattern',
    dashOffset: 'Dash offset',
  },
  quality: {
    section: 'Quality',
    issueCount: (count) => `${count} issues`,
    noIssues: 'No issues',
    error: 'Error',
    warning: 'Warning',
    issue: (code, entityId) => `${code}:${entityId ?? 'project'}`,
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
    shadowPlaceholder: 'Shadow value',

    shadowX: 'X',
    shadowY: 'Y',
    shadowBlur: 'Blur',
    shadowSpread: 'Spread',
    shadowColor: 'Shadow color',
    layerBlur: 'Layer blur',
    backdropBlur: 'Background blur',
  },
  units: { pixels: 'px', percent: '%' },
};

const renderInspector = (
  locked = false,
  projectOverride?: ReturnType<typeof createPremiumStarterProject>,
  selectionOverride?: { nodeIds: string[]; anchorId: string | null },
  fontCatalog?: ViuAuthoringInspectorProps['fontCatalog']
) => {
  const project = projectOverride ?? createPremiumStarterProject();
  project.nodes['node-home-title']!.locked = locked;
  const onCommit = vi.fn();
  const result = render(
    <ConfigProvider>
      <AuthoringInspector
        project={project}
        selection={selectionOverride ?? { nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
        labels={labels}
        fontOptions={[
          { value: 'Noto Sans', label: 'Noto Sans' },
          { value: 'Source Serif 4', label: 'Source Serif 4' },
        ]}
        fontWeightOptions={[
          { value: 400, label: 'Regular' },
          { value: 700, label: 'Bold' },
        ]}
        fontCatalog={fontCatalog}
        onCommit={onCommit}
      />
    </ConfigProvider>
  );
  return { ...result, onCommit };
};

const innerInput = (testId: string): HTMLInputElement => {
  const element = screen.getByTestId(testId);
  if (element instanceof HTMLInputElement) return element;
  const input = element.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input found for ${testId}`);
  return input;
};

const selectOption = async (testId: string, label: string): Promise<void> => {
  fireEvent.click(screen.getByTestId(testId));
  const matches = await screen.findAllByText(label);
  const option = matches.find((match) => match.closest('.arco-select-option'));
  if (!option) throw new Error(`No option ${label} found for ${testId}`);
  fireEvent.click(option.closest('.arco-select-option')!);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VIU AuthoringInspector', () => {
  it('renders localized labels supplied by its integration boundary', () => {
    renderInspector();

    expect(screen.getByText('Authoring inspector')).toBeInTheDocument();
    expect(screen.getByText('Typography')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });

  it('commits a Vietnamese IME session once after composition and blur', () => {
    const { onCommit } = renderInspector();
    const textarea = screen.getByTestId('viu-authoring-text-content');
    const vietnamese = 'Ti\u1ebfng Vi\u1ec7t ho\u00e0n ch\u1ec9nh';

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: vietnamese } });
    fireEvent.compositionEnd(textarea, { data: vietnamese, target: { value: vietnamese } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(textarea);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0].commands[0]).toMatchObject({
      type: 'updateNode',
      patch: { content: { text: vietnamese } },
    });
  });

  it('emits typography and alignment as typed authoring batches', () => {
    const { onCommit } = renderInspector();
    const fontSizeInput = innerInput('viu-authoring-font-size');

    fireEvent.change(fontSizeInput, { target: { value: '72' } });
    fireEvent.click(screen.getByTestId('viu-authoring-text-align-center'));
    fireEvent.click(screen.getByTestId('viu-authoring-decoration-underline'));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'typography',
      commands: [{ type: 'updateNode', patch: { style: { fontSize: 72 } } }],
    });
    expect(onCommit.mock.calls[1]?.[0].commands[0]).toMatchObject({
      patch: { style: { textAlign: 'center' } },
    });
    expect(onCommit.mock.calls.at(-1)?.[0].commands[0]).toMatchObject({
      patch: { style: { textDecoration: 'underline' } },
    });
  });

  it('discovers installed fonts when the family selector opens', () => {
    const onLoad = vi.fn();
    renderInspector(false, undefined, undefined, {
      status: 'idle',
      systemFontCount: 0,
      onLoad,
    });

    fireEvent.click(screen.getByTestId('viu-authoring-font-family'));

    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('creates a reusable component from the selected canvas node', () => {
    const { onCommit } = renderInspector();

    fireEvent.click(screen.getByTestId('viu-create-component'));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'component-create',
      commands: [{ type: 'createComponent', component: { rootNodeId: 'node-home-title', name: 'Hero title' } }],
    });
  });

  it('renders typed instance properties and emits a sparse override batch', () => {
    const project = createPremiumStarterProject();
    project.components['component-title'] = {
      id: 'component-title',
      version: 1,
      name: 'Reusable title',
      rootNodeId: 'node-home-title',
      variantProperties: {},
      propertyDefinitions: {
        title: {
          id: 'title',
          name: 'Title',
          type: 'text',
          targetNodeId: 'node-home-title',
          targetProperty: 'content.text',
          defaultValue: 'Matter, made\nimpossible.',
        },
      },
    };
    const instance = createViuNode({
      id: 'instance-title',
      name: 'Title instance',
      type: 'component-instance',
      parentId: 'node-home-root',
      width: 790,
      height: 260,
    });
    instance.componentInstance = {
      componentId: 'component-title',
      variantSelection: {},
      propertyValues: { title: 'Custom title' },
    };
    project.nodes[instance.id] = instance;
    project.nodes['node-home-root']!.childIds.push(instance.id);
    const { onCommit } = renderInspector(false, project, {
      nodeIds: [instance.id],
      anchorId: instance.id,
    });

    fireEvent.change(screen.getByDisplayValue('Custom title'), { target: { value: 'Updated instance title' } });

    expect(screen.getByTestId('viu-component-inspector')).toHaveAttribute('data-kind', 'instance');
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'component-property',
      commands: [{ type: 'updateNode', nodeId: 'instance-title' }],
    });
  });

  it('preserves rgba shadow geometry when one structured field changes', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.style.shadow = '4px 6px 12px 2px rgba(0, 0, 0, 0.4)';
    const { onCommit } = renderInspector(false, project);

    fireEvent.change(innerInput('viu-authoring-shadow-y'), { target: { value: '10' } });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0].commands[0]).toMatchObject({
      patch: { style: { shadow: '4px 10px 12px 2px rgba(0, 0, 0, 0.4)' } },
    });
  });

  it('toggles and reorders fill layers, then switches explicitly to raw CSS fallback', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.style.fills = [
      { id: 'base-fill', type: 'solid', visible: true, opacity: 1, color: '#111111' },
      { id: 'accent-fill', type: 'solid', visible: true, opacity: 0.5, color: '#eeeeee' },
    ];
    const { onCommit } = renderInspector(false, project);

    fireEvent.click(screen.getAllByLabelText('Visible')[0]!);
    fireEvent.click(screen.getAllByLabelText('Move down')[0]!);
    fireEvent.change(screen.getByTestId('viu-authoring-background-css'), {
      target: { value: 'conic-gradient(red, blue)' },
    });
    fireEvent.blur(screen.getByTestId('viu-authoring-background-css'));

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.style.fills[0]).toMatchObject({
      id: 'base-fill',
      visible: false,
    });
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.style.fills.map((fill: { id: string }) => fill.id)).toEqual([
      'accent-fill',
      'base-fill',
    ]);
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.style).toMatchObject({
      fills: undefined,
      background: 'conic-gradient(red, blue)',
    });
  });

  it('authors image rotation and flips through the same typed transaction batch used by agents', () => {
    const project = createPremiumStarterProject();
    const image = createViuNode({
      id: 'node-image-edit',
      name: 'Editable image',
      type: 'image',
      parentId: 'node-home-root',
      semantics: { role: 'image', label: 'Product photo' },
    });
    project.nodes[image.id] = image;
    project.nodes['node-home-root']!.childIds.push(image.id);
    const { onCommit } = renderInspector(false, project, { nodeIds: [image.id], anchorId: image.id });

    fireEvent.change(innerInput('viu-authoring-image-rotation'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('viu-authoring-image-flip-horizontal'));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'image-transform',
      commands: [{ type: 'updateNode', nodeId: image.id, patch: { imageTransform: { rotation: 45 } } }],
    });
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.imageTransform.flipHorizontal).toBe(true);
  });

  it('adds a structured stroke and exposes selected-node quality diagnostics', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.semantics.headingLevel = undefined;
    const { onCommit } = renderInspector(false, project);

    fireEvent.click(screen.getByTestId('viu-authoring-stroke-add'));

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.style.strokes[0]).toMatchObject({
      alignment: 'inside',
      cap: 'butt',
      join: 'miter',
      dashPattern: [],
    });
    expect(screen.getByText('missing-heading-level:node-home-title')).toBeInTheDocument();
  });

  it('authors crop, focal point, flip and reset for an image without replacing its asset', () => {
    const project = createPremiumStarterProject();
    const image = createViuNode({
      id: 'node-image-framing',
      name: 'Framed image',
      type: 'image',
      parentId: 'node-home-root',
      semantics: { role: 'image', label: 'Product render' },
    });
    project.nodes[image.id] = image;
    project.nodes['node-home-root']!.childIds.push(image.id);
    const { onCommit } = renderInspector(false, project, { nodeIds: [image.id], anchorId: image.id });

    fireEvent.change(innerInput('viu-authoring-image-crop-height'), { target: { value: '15' } });
    fireEvent.change(innerInput('viu-authoring-image-focal-x'), { target: { value: '72' } });
    fireEvent.click(screen.getByTestId('viu-authoring-image-flip-vertical'));
    fireEvent.click(screen.getByTestId('viu-authoring-image-reset'));

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.imageTransform.crop.height).toBe(0.15);
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.imageTransform.focalPoint.x).toBe(0.72);
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.imageTransform.flipVertical).toBe(true);
    expect(onCommit.mock.calls[3]?.[0].commands[0].patch.imageTransform).toMatchObject({
      fit: 'cover',
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
    });
  });

  it('validates and authors vector paths, anchors and stroke geometry from one selected shape', () => {
    const project = createPremiumStarterProject();
    const shape = createViuNode({
      id: 'node-vector-edit',
      name: 'Editable vector',
      type: 'vector',
      parentId: 'node-home-root',
    });
    shape.vector = createDefaultViuVectorGeometry(240, 160);
    project.nodes[shape.id] = shape;
    project.nodes['node-home-root']!.childIds.push(shape.id);
    const { onCommit } = renderInspector(false, project, { nodeIds: [shape.id], anchorId: shape.id });
    const pathEditor = screen.getByTestId('viu-authoring-vector-path');

    fireEvent.change(pathEditor, { target: { value: 'M 0 0 L' } });
    fireEvent.blur(pathEditor);
    expect(screen.getByText('Invalid SVG path')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(pathEditor, { target: { value: 'M 0 0 L 120 0 L 120 80 Z' } });
    fireEvent.blur(pathEditor);
    fireEvent.click(screen.getByTestId('viu-authoring-vector-closed'));
    fireEvent.change(innerInput('viu-authoring-vector-miter-limit'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('viu-authoring-vector-add-anchor'));

    const firstAnchor = screen.getAllByTestId(/^viu-authoring-vector-anchor-/u)[0]!;
    fireEvent.change(within(firstAnchor).getAllByRole('spinbutton')[0]!, { target: { value: '18' } });
    fireEvent.click(within(firstAnchor).getByRole('button', { name: 'Remove anchor' }));

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.vector.pathData).toBe('M 0 0 L 120 0 L 120 80 Z');
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.vector.miterLimit).toBe(8);
    expect(onCommit.mock.calls[3]?.[0].commands[0].patch.vector.points).toHaveLength(shape.vector.points.length + 1);
    expect(onCommit.mock.calls.at(-1)?.[0].commands[0].patch.vector.points).toHaveLength(
      shape.vector.points.length - 1
    );
  });

  it('edits and removes an existing structured stroke while rejecting an all-zero dash pattern', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.style.strokes = [
      {
        id: 'stroke-existing',
        visible: true,
        opacity: 1,
        color: '#112233',
        width: 2,
        alignment: 'inside',
        cap: 'butt',
        join: 'miter',
        miterLimit: 4,
        dashPattern: [4, 2],
        dashOffset: 0,
      },
    ];
    const { onCommit } = renderInspector(false, project);
    const strokeSection = screen.getByText('Strokes').closest('section');
    if (!strokeSection) throw new Error('Stroke section was not rendered');

    fireEvent.click(within(strokeSection).getByRole('switch', { name: 'Visible' }));
    const dashPattern = within(strokeSection).getByDisplayValue('4, 2');
    fireEvent.change(dashPattern, { target: { value: '0, 0' } });
    fireEvent.blur(dashPattern);
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.change(dashPattern, { target: { value: '8, 3' } });
    fireEvent.blur(dashPattern);
    fireEvent.click(within(strokeSection).getByRole('button', { name: 'Remove stroke' }));

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.style.strokes[0].visible).toBe(false);
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.style.strokes[0].dashPattern).toEqual([8, 3]);
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.style.strokes).toEqual([]);
  });

  it('authors advanced typography controls through typed batches', async () => {
    const { onCommit } = renderInspector();

    await selectOption('viu-authoring-font-family', 'Source Serif 4');
    await selectOption('viu-authoring-font-weight', 'Bold');
    fireEvent.change(innerInput('viu-authoring-line-height'), { target: { value: '1.5' } });
    fireEvent.change(innerInput('viu-authoring-letter-spacing'), { target: { value: '2' } });
    await selectOption('viu-authoring-font-style', 'Italic');
    await selectOption('viu-authoring-letter-case', 'Uppercase');
    fireEvent.click(screen.getByTestId('viu-authoring-decoration-strikethrough'));
    fireEvent.click(screen.getByTestId('viu-authoring-text-align-right'));
    fireEvent.click(screen.getByTestId('viu-authoring-vertical-align-bottom'));

    expect(onCommit.mock.calls.map((call) => call[0].commands[0].patch.style)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: 'Source Serif 4' }),
        expect.objectContaining({ fontWeight: 700 }),
        expect.objectContaining({ lineHeight: 1.5 }),
        expect.objectContaining({ letterSpacing: 2 }),
        expect.objectContaining({ fontStyle: 'italic' }),
        expect.objectContaining({ textTransform: 'uppercase' }),
        expect.objectContaining({ textAlign: 'right' }),
        expect.objectContaining({ verticalAlign: 'bottom' }),
      ])
    );
  });

  it('authors border, blur, shadow and overflow appearance controls', async () => {
    const { onCommit } = renderInspector();

    await selectOption('viu-authoring-border-style', 'Dashed');
    fireEvent.change(innerInput('viu-authoring-border-width'), { target: { value: '3' } });
    fireEvent.change(innerInput('viu-authoring-radius'), { target: { value: '18' } });
    fireEvent.change(innerInput('viu-authoring-shadow-x'), { target: { value: '7' } });
    fireEvent.change(innerInput('viu-authoring-shadow-blur'), { target: { value: '20' } });
    fireEvent.change(innerInput('viu-authoring-layer-blur'), { target: { value: '4' } });
    fireEvent.change(innerInput('viu-authoring-backdrop-blur'), { target: { value: '6' } });
    await selectOption('viu-authoring-overflow', 'Hidden');

    const patches = onCommit.mock.calls.map((call) => call[0].commands[0].patch.style);
    expect(patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderStyle: 'dashed' }),
        expect.objectContaining({ borderWidth: 3 }),
        expect.objectContaining({ borderRadius: 18 }),
        expect.objectContaining({ blur: 4, effects: undefined }),
        expect.objectContaining({ backdropBlur: 6, effects: undefined }),
        expect.objectContaining({ overflow: 'hidden' }),
      ])
    );
  });

  it('edits radial fills and structured effects without falling back to raw CSS', async () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.style.fills = [
      {
        id: 'fill-radial',
        type: 'radial',
        visible: true,
        opacity: 0.8,
        centerX: 50,
        centerY: 50,
        radius: 70,
        stops: [
          { color: '#111111', position: 0 },
          { color: '#eeeeee', position: 1 },
        ],
      },
    ];
    project.nodes['node-home-title']!.style.effects = [
      { id: 'effect-blur', type: 'layer-blur', visible: true, radius: 8 },
      {
        id: 'effect-shadow',
        type: 'drop-shadow',
        visible: true,
        x: 0,
        y: 8,
        blur: 24,
        spread: 0,
        color: 'rgba(0, 0, 0, 0.24)',
      },
    ];
    const { onCommit } = renderInspector(false, project);
    const fill = screen.getByTestId('viu-authoring-fill-fill-radial');
    const effectBlur = screen.getByTestId('viu-authoring-effect-effect-blur');
    const effectShadow = screen.getByTestId('viu-authoring-effect-effect-shadow');

    const fillNumbers = within(fill).getAllByRole('spinbutton');
    fireEvent.change(fillNumbers[0]!, { target: { value: '65' } });
    fireEvent.change(fillNumbers[1]!, { target: { value: '42' } });
    fireEvent.change(fillNumbers[3]!, { target: { value: '88' } });

    fireEvent.click(within(effectBlur).getByRole('switch', { name: 'Visible' }));
    fireEvent.change(within(effectBlur).getByRole('spinbutton'), { target: { value: '16' } });
    fireEvent.click(within(effectBlur).getByRole('button', { name: 'Move down' }));
    fireEvent.change(within(effectShadow).getAllByRole('spinbutton')[2]!, { target: { value: '30' } });
    fireEvent.click(within(effectShadow).getByRole('button', { name: 'Remove' }));
    await selectOption('viu-authoring-add-effect', 'Background blur');

    expect(onCommit.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(onCommit.mock.calls.some((call) => call[0].commands[0].patch.style.fills)).toBe(true);
    expect(onCommit.mock.calls.some((call) => call[0].commands[0].patch.style.effects)).toBe(true);
  });

  it('keeps locked vector and image controls read-only instead of emitting partial transactions', () => {
    const project = createPremiumStarterProject();
    const image = createViuNode({
      id: 'node-image-locked',
      name: 'Locked image',
      type: 'image',
      parentId: 'node-home-root',
    });
    image.locked = true;
    project.nodes[image.id] = image;
    project.nodes['node-home-root']!.childIds.push(image.id);
    const { onCommit } = renderInspector(false, project, { nodeIds: [image.id], anchorId: image.id });

    expect(innerInput('viu-authoring-image-rotation')).toBeDisabled();
    expect(screen.getByTestId('viu-authoring-image-reset')).toBeDisabled();
    fireEvent.click(screen.getByTestId('viu-authoring-image-reset'));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('disables content authoring when every selected node is locked', () => {
    renderInspector(true);

    expect(screen.getByTestId('viu-authoring-text-content')).toBeDisabled();
    expect(innerInput('viu-authoring-font-size')).toBeDisabled();
  });
});
