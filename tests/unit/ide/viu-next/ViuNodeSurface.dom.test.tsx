/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject, createViuNode, normalizeViuImageTransform } from '@/common/viu';
import ViuNodeSurface from '@/renderer/pages/studio/ide/Viu/next/ViuNodeSurface';

const createComponentProject = () => {
  const project = createPremiumStarterProject();
  const source = structuredClone(project.nodes['node-home-cta']!);
  source.id = 'node-component-source';
  source.parentId = 'node-home-root';
  source.childIds = [];
  source.content = { text: 'Default label' };
  source.componentInstance = undefined;
  project.nodes[source.id] = source;
  project.components['component-button'] = {
    id: 'component-button',
    version: 1,
    name: 'Button',
    rootNodeId: source.id,
    variantProperties: {},
    propertyDefinitions: {
      label: {
        id: 'label',
        name: 'Label',
        type: 'text',
        targetNodeId: source.id,
        targetProperty: 'content.text',
        defaultValue: 'Default label',
      },
      visible: {
        id: 'visible',
        name: 'Visible',
        type: 'boolean',
        targetNodeId: source.id,
        targetProperty: 'visible',
        defaultValue: true,
      },
    },
  };
  project.nodes['node-component-instance'] = {
    ...structuredClone(source),
    id: 'node-component-instance',
    name: 'Button instance',
    type: 'component-instance',
    parentId: 'node-home-root',
    componentInstance: {
      componentId: 'component-button',
      variantSelection: {},
      propertyValues: { label: 'Design override', visible: true },
    },
  };
  project.nodes['node-home-root']!.childIds.push(source.id, 'node-component-instance');

  return project;
};

afterEach(cleanup);

describe('ViuNodeSurface component instances', () => {
  it('materializes instance properties while keeping selection on the real instance id', () => {
    const project = createComponentProject();
    const onSelect = vi.fn();
    const { container } = render(
      <ViuNodeSurface
        project={project}
        nodeId='node-component-instance'
        mode='design'
        selectedNodeIds={[]}
        preview={null}
        onSelect={onSelect}
        onBeginMove={vi.fn()}
        onBeginResize={vi.fn()}
        onActivate={vi.fn()}
      />
    );

    const instance = container.querySelector('[data-viu-node-id=node-component-instance]');
    expect(screen.getByText('Design override')).toBeInTheDocument();
    expect(instance).toHaveAttribute('data-viu-component-id', 'component-button');
    expect(instance).toHaveAttribute('data-viu-component-variant', JSON.stringify({}));

    fireEvent.pointerDown(instance!);
    expect(onSelect).toHaveBeenCalledWith('node-component-instance', false);
  });

  it('renders structured fill and effect overrides on the component instance', () => {
    const project = createComponentProject();
    project.nodes['node-component-instance']!.componentInstance!.styleOverrides = {
      fills: [
        { id: 'surface-fill', type: 'solid', visible: true, opacity: 1, color: '#123456' },
        {
          id: 'surface-gradient',
          type: 'linear',
          visible: true,
          opacity: 1,
          angle: 45,
          stops: [
            { color: '#ffffff', position: 0 },
            { color: '#000000', position: 1 },
          ],
        },
      ],
      effects: [
        {
          id: 'surface-shadow',
          type: 'inner-shadow',
          visible: true,
          x: 1,
          y: 2,
          blur: 6,
          spread: 0,
          color: 'rgba(0, 0, 0, 0.4)',
        },
      ],
    };

    const { container } = render(
      <ViuNodeSurface
        project={project}
        nodeId='node-component-instance'
        mode='design'
        selectedNodeIds={[]}
        preview={null}
        onSelect={vi.fn()}
        onBeginMove={vi.fn()}
        onBeginResize={vi.fn()}
        onActivate={vi.fn()}
      />
    );

    const instance = container.querySelector<HTMLElement>('[data-viu-node-id=node-component-instance]');
    expect(instance?.getAttribute('style')).toContain('linear-gradient');
    expect(instance?.style.boxShadow).toContain('inset 1px 2px 6px 0px');
  });
});

describe('ViuNodeSurface quality rendering parity', () => {
  it('renders image framing and structured multi-strokes with the same compiled model as Present', () => {
    const project = createPremiumStarterProject('surface-quality-project');
    const image = createViuNode({
      id: 'node-quality-image',
      name: 'Framed product',
      type: 'image',
      parentId: 'node-home-root',
      width: 400,
      height: 240,
      semantics: { role: 'image', label: 'Framed product' },
    });
    image.content = { assetId: 'asset-product' };
    image.imageTransform = normalizeViuImageTransform({
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
      focalPoint: { x: 0.75, y: 0.2 },
      rotation: 90,
      flipHorizontal: true,
    });
    image.style.strokes = [
      {
        id: 'stroke-inner',
        visible: true,
        opacity: 1,
        color: '#123456',
        width: 3,
        alignment: 'inside',
        cap: 'round',
        join: 'miter',
        miterLimit: 4,
        dashPattern: [],
        dashOffset: 0,
      },
      {
        id: 'stroke-outer',
        visible: true,
        opacity: 0.5,
        color: '#abcdef',
        width: 6,
        alignment: 'outside',
        cap: 'butt',
        join: 'bevel',
        miterLimit: 4,
        dashPattern: [8, 4],
        dashOffset: 0,
      },
    ];
    project.nodes[image.id] = image;

    const { container } = render(
      <ViuNodeSurface
        project={project}
        nodeId={image.id}
        mode='design'
        selectedNodeIds={[]}
        preview={null}
        vectorEditNodeId={null}
        selectedVectorPointIds={[]}
        vectorEditLabels={{
          enter: 'Edit',
          exit: 'Exit',
          openPath: 'Open',
          closePath: 'Close',
          union: 'Union',
          subtract: 'Subtract',
          intersect: 'Intersect',
          exclude: 'Exclude',
          clipMask: 'Clip',
          alphaMask: 'Alpha',
          releaseMask: 'Release',
          reorderMask: 'Reorder',
        }}
        resolveAssetUrl={() => 'file:///product.png'}
        onSelect={vi.fn()}
        onBeginMove={vi.fn()}
        onBeginResize={vi.fn()}
        onActivate={vi.fn()}
        onEnterVectorEdit={vi.fn()}
        onExitVectorEdit={vi.fn()}
        onSelectVectorPoint={vi.fn()}
        onAddVectorPoint={vi.fn()}
        onCommitVectorGeometry={vi.fn()}
      />
    );

    const surface = container.querySelector<HTMLElement>('[data-viu-node-id=node-quality-image]');
    const media = screen.getByTestId('viu-image-media-node-quality-image');

    expect(surface?.style.outline).toContain('6px dashed');
    expect(surface?.style.boxShadow).toContain('inset 0 0 0 3px');
    expect(media).toHaveStyle({
      width: '200%',
      height: '125%',
      left: '-50%',
      top: '-12.5%',
      objectPosition: '75% 20%',
      transform: 'rotate(90deg) scale(-1, 1)',
    });
  });
});
