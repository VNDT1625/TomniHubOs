/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPremiumStarterProject,
  createViuNode,
  normalizeViuImageTransform,
  type ViuProjectState,
} from '@/common/viu';
import type { ViuRuntimeContract } from '@/common/viu/runtime';
import ViuPresentRuntime, { type ViuPresentLabels } from '@package-apps/design/renderer/viu/next/runtime/index';

const createComponentProject = (): ViuProjectState => {
  const project = createPremiumStarterProject();
  const source = structuredClone(project.nodes['node-home-cta']!);
  source.id = 'node-component-source';
  source.name = 'Button source';
  source.parentId = 'node-home-root';
  source.childIds = [];
  source.content = { text: 'Default component label' };
  source.componentInstance = undefined;
  project.nodes[source.id] = source;
  project.components['component-button-default'] = {
    id: 'component-button-default',
    version: 1,
    name: 'Button / Default',
    rootNodeId: source.id,
    componentSetId: 'component-set-button',
    variantProperties: { state: 'default' },
    propertyDefinitions: {
      label: {
        id: 'label',
        name: 'Label',
        type: 'text',
        targetNodeId: source.id,
        targetProperty: 'content.text',
        defaultValue: 'Default component label',
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
  const hoverSource = structuredClone(source);
  hoverSource.id = 'node-component-source-hover';
  hoverSource.name = 'Button hover source';
  hoverSource.content = { text: 'Hover component label' };
  project.nodes[hoverSource.id] = hoverSource;
  project.components['component-button-hover'] = {
    id: 'component-button-hover',
    version: 1,
    name: 'Button / Hover',
    rootNodeId: hoverSource.id,
    componentSetId: 'component-set-button',
    variantProperties: { state: 'hover' },
    propertyDefinitions: {
      label: {
        id: 'label',
        name: 'Label',
        type: 'text',
        targetNodeId: hoverSource.id,
        targetProperty: 'content.text',
        defaultValue: 'Hover component label',
      },
      visible: {
        id: 'visible',
        name: 'Visible',
        type: 'boolean',
        targetNodeId: hoverSource.id,
        targetProperty: 'visible',
        defaultValue: true,
      },
    },
  };
  project.componentSets['component-set-button'] = {
    id: 'component-set-button',
    version: 1,
    name: 'Button',
    componentIds: ['component-button-default', 'component-button-hover'],
    variantAxes: { state: ['default', 'hover'] },
  };
  const createInstance = (id: string, label: string, visible: boolean, y: number) => ({
    ...structuredClone(source),
    id,
    name: label,
    type: 'component-instance' as const,
    parentId: 'node-home-root',
    localTransform: [1, 0, 0, 1, 96, y] as [number, number, number, number, number, number],
    componentInstance: {
      componentId: 'component-button-default',
      variantSelection: { state: 'default' },
      propertyValues: { label, visible },
    },
  });
  project.nodes['node-component-instance'] = createInstance('node-component-instance', 'Instance label', true, 710);
  project.nodes['node-component-hidden'] = createInstance('node-component-hidden', 'Hidden instance', false, 760);
  project.nodes['node-home-root']!.childIds.push(
    source.id,
    hoverSource.id,
    'node-component-instance',
    'node-component-hidden'
  );
  return project;
};

const labels: ViuPresentLabels = {
  back: 'Back',
  closeOverlay: 'Close overlay',
  empty: 'No route to present',
  route: 'Route',
  exit: 'Exit preview',
};

const renderRuntime = (props: Partial<React.ComponentProps<typeof ViuPresentRuntime>> = {}) =>
  render(
    <ConfigProvider>
      <div style={{ width: 1200, height: 800 }}>
        <ViuPresentRuntime project={createPremiumStarterProject()} labels={labels} {...props} />
      </div>
    </ConfigProvider>
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ViuPresentRuntime', () => {
  it('combines navigation and its transition into a working website route', () => {
    const { container } = renderRuntime();

    fireEvent.click(screen.getByRole('button', { name: 'Explore the collection' }));

    expect(screen.getByText('Route: /collection')).toBeInTheDocument();
    expect(screen.getByText('Tactile futures.')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>(`[data-screen-id='screen-showcase']`)?.style.animationDuration).toBe(
      '280ms'
    );
  });

  it('keeps a delayed route transition active until its animation completes', () => {
    vi.useFakeTimers();
    const contract = {
      schemaVersion: 1 as const,
      interactions: {
        'interaction-home-showcase': {
          transition: {
            preset: 'slide-left' as const,
            trigger: 'click' as const,
            delayMs: 180,
            durationMs: 270,
          },
        },
      },
    };
    const { container } = renderRuntime({ contract });
    fireEvent.click(screen.getByRole('button', { name: 'Explore the collection' }));
    const viewport = container.querySelector<HTMLElement>('[data-route-motion]');

    act(() => vi.advanceTimersByTime(449));
    expect(viewport).toHaveAttribute('data-route-motion', 'slide-left');

    act(() => vi.advanceTimersByTime(1));
    expect(viewport).toHaveAttribute('data-route-motion', 'none');
  });

  it('finds a button interaction through nested visual layers', () => {
    const project = createPremiumStarterProject();
    const child = structuredClone(project.nodes['node-home-copy']!);
    child.id = 'node-home-cta-label';
    child.parentId = 'node-home-cta';
    child.childIds = [];
    child.localTransform = [1, 0, 0, 1, 12, 8];
    child.content = { text: 'Nested CTA label' };
    project.nodes[child.id] = child;
    project.nodes['node-home-cta']!.childIds.push(child.id);

    renderRuntime({ project });
    fireEvent.click(screen.getByText('Nested CTA label'));

    expect(screen.getByText('Route: /collection')).toBeInTheDocument();
  });

  it('dispatches hover interactions as authored', () => {
    const project = createPremiumStarterProject();
    project.interactions['interaction-home-showcase']!.trigger = 'hover';

    renderRuntime({ project });
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Explore the collection' }));

    expect(screen.getByText('Route: /collection')).toBeInTheDocument();
  });

  it('renders the complete height of a long-form frame', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-root']!.size.height = 2680;

    const { container } = renderRuntime({ project });
    const homeSection = container.querySelector<HTMLElement>(`[data-screen-id='screen-home']`);

    expect(homeSection?.style.height).toBe('2680px');
  });

  it('activates in-view motion when the layer enters the preview viewport', () => {
    class VisibleIntersectionObserver {
      constructor(private readonly callback: IntersectionObserverCallback) {}

      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as IntersectionObserver);
      }

      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0.15];
    }
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
    const contract = {
      schemaVersion: 1 as const,
      nodes: {
        'node-home-title': { motion: { preset: 'rise' as const, trigger: 'in-view' as const, durationMs: 320 } },
      },
    };
    const { container } = renderRuntime({ contract });

    expect(container.querySelector(`[data-viu-runtime-node-id='node-home-title']`)).toHaveAttribute(
      'data-motion-state',
      'active'
    );
  });

  it('activates click-triggered node motion when the visitor clicks the layer', () => {
    const contract = {
      schemaVersion: 1 as const,
      nodes: {
        'node-home-title': { motion: { preset: 'scale' as const, trigger: 'click' as const, durationMs: 240 } },
      },
    };
    const { container } = renderRuntime({ contract });

    fireEvent.click(screen.getByText('Matter, made impossible.'));

    expect(container.querySelector(`[data-viu-runtime-node-id='node-home-title']`)).toHaveAttribute(
      'data-motion-state',
      'active'
    );
  });

  it('renders image framing and structured outside strokes in preview', () => {
    const project = createPremiumStarterProject();
    const image = createViuNode({
      id: 'node-runtime-image',
      name: 'Runtime image',
      type: 'image',
      parentId: 'node-home-root',
      semantics: { role: 'image', label: 'Runtime product image' },
    });
    image.content = { assetId: 'asset-runtime-image' };
    image.imageTransform = normalizeViuImageTransform({
      crop: { x: 0.2, width: 0.8 },
      focalPoint: { x: 0.75, y: 0.25 },
      rotation: 30,
      flipVertical: true,
    });
    image.style.strokes = [
      {
        id: 'outside-stroke',
        visible: true,
        opacity: 1,
        color: '#123456',
        width: 4,
        alignment: 'outside',
        cap: 'round',
        join: 'bevel',
        miterLimit: 4,
        dashPattern: [],
        dashOffset: 0,
      },
    ];
    project.nodes[image.id] = image;
    project.nodes['node-home-root']!.childIds.push(image.id);
    project.assets['asset-runtime-image'] = {
      id: 'asset-runtime-image',
      displayName: 'Runtime image',
      kind: 'image',
    };

    renderRuntime({ project, resolveAssetUrl: () => 'data:image/png;base64,AA==' });

    expect(screen.getByAltText('Runtime product image')).toHaveStyle({
      width: '125%',
      left: '-25%',
      objectPosition: '75% 25%',
      transform: 'rotate(30deg) scale(1, -1)',
    });
    expect(document.querySelector('[data-viu-runtime-node-id=node-runtime-image]')).toHaveStyle({
      outline: '4px solid #123456',
    });
  });

  it('renders component variants and materialized text or boolean overrides', () => {
    const { container } = renderRuntime({ project: createComponentProject() });

    expect(screen.getByText('Instance label')).toBeInTheDocument();
    const instance = container.querySelector('[data-viu-runtime-node-id=node-component-instance]');
    expect(instance).toHaveAttribute('data-viu-component-id', 'component-button-default');
    expect(instance).toHaveAttribute('data-viu-component-variant', JSON.stringify({ state: 'default' }));
    expect(container.querySelector('[data-viu-runtime-node-id=node-component-hidden]')).not.toBeInTheDocument();
  });

  it('emits runtime trace evidence when the visitor navigates', () => {
    const onTrace = vi.fn();
    renderRuntime({ onTrace });

    fireEvent.click(screen.getByRole('button', { name: 'Explore the collection' }));

    expect(onTrace).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: 'interaction-home-showcase', status: 'applied' })
    );
  });

  it('presents the same structured paints and effects as the design canvas', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.style.fills = [
      {
        id: 'preview-gradient',
        type: 'radial',
        visible: true,
        opacity: 1,
        centerX: 40,
        centerY: 60,
        radius: 80,
        stops: [
          { color: '#ffffff', position: 0 },
          { color: '#000000', position: 1 },
        ],
      },
    ];
    project.nodes['node-home-title']!.style.effects = [
      {
        id: 'preview-shadow',
        type: 'drop-shadow',
        visible: true,
        x: 0,
        y: 8,
        blur: 20,
        spread: 0,
        color: 'rgba(0, 0, 0, 0.35)',
      },
      { id: 'preview-blur', type: 'backdrop-blur', visible: true, radius: 12 },
    ];

    const { container } = renderRuntime({ project });
    const title = container.querySelector<HTMLElement>('[data-viu-runtime-node-id=node-home-title]');

    expect(title?.getAttribute('style')).toContain('radial-gradient');
    expect(title?.style.boxShadow).toContain('0px 8px 20px 0px');
    expect(title?.style.backdropFilter).toBe('blur(12px)');
  });

  it('plays authored timeline keyframes on the same nodes shown in Present', () => {
    vi.useFakeTimers();
    const project = createPremiumStarterProject();
    project.interactions['interaction-home-showcase']!.action = {
      type: 'playTimeline',
      timelineId: 'hero',
    };
    project.timelines.hero = {
      id: 'hero',
      name: 'Hero',
      durationMs: 1_000,
      tracks: [
        {
          id: 'hero-x',
          nodeId: 'node-home-title',
          property: 'x',
          keyframes: [
            { offsetMs: 0, value: 0 },
            { offsetMs: 1_000, value: 100 },
          ],
        },
      ],
    };
    const { container } = renderRuntime({ project });

    fireEvent.click(screen.getByRole('button', { name: 'Explore the collection' }));
    act(() => vi.advanceTimersByTime(512));

    expect(
      container.querySelector<HTMLElement>('[data-viu-runtime-node-id=node-home-title]')?.style.transform
    ).toContain('translateX(');
  });

  it('executes smart animate matches when stable keys continue across routes', () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      right: 210,
      bottom: 120,
      left: 10,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    const contract: ViuRuntimeContract = {
      schemaVersion: 1,
      nodes: {
        'node-home-title': { smartAnimateKey: 'hero-title' },
        'node-showcase-title': { smartAnimateKey: 'hero-title' },
      },
      routeTransition: {
        preset: 'smart-animate',
        trigger: 'click',
        durationMs: 360,
        easing: 'ease-out',
      },
    };
    const { container } = renderRuntime({ contract });

    fireEvent.click(screen.getByRole('button', { name: 'Explore the collection' }));

    expect(container.querySelector('[data-viu-runtime-node-id=node-showcase-title]')).toHaveAttribute(
      'data-smart-animate-state',
      'matched'
    );
    expect(animate).toHaveBeenCalledOnce();
  });

  it('turns viewport scroll into deterministic progress and parallax styles', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.dataset.viuRuntimeNodeId === 'node-home-title') {
        return {
          x: 0,
          y: 250,
          top: 250,
          right: 400,
          bottom: 350,
          left: 0,
          width: 400,
          height: 100,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 1200,
        bottom: 1_000,
        left: 0,
        width: 1_200,
        height: 1_000,
        toJSON: () => ({}),
      };
    });
    const contract: ViuRuntimeContract = {
      schemaVersion: 1,
      scrollBindings: {
        story: {
          nodeId: 'node-home-title',
          pin: true,
          parallax: 100,
        },
      },
    };
    const { container } = renderRuntime({ contract });
    const viewport = container.querySelector<HTMLElement>('[data-route-motion]')!;

    fireEvent.scroll(viewport);

    const title = container.querySelector<HTMLElement>('[data-viu-runtime-node-id=node-home-title]');
    expect(Number(title?.dataset.scrollProgress)).toBeCloseTo(0.682, 3);
    expect(title?.style.position).toBe('sticky');
    expect(title?.style.transform).toContain('translateY(');
  });

  it('runs load and scroll prototype triggers through the same runtime reducer', () => {
    const loadProject = createPremiumStarterProject();
    loadProject.interactions['interaction-home-showcase']!.trigger = 'load';
    const { unmount } = renderRuntime({ project: loadProject });

    expect(screen.getByText('Route: /collection')).toBeInTheDocument();
    unmount();

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 400,
      bottom: 100,
      left: 0,
      width: 400,
      height: 100,
      toJSON: () => ({}),
    });
    const scrollProject = createPremiumStarterProject();
    scrollProject.interactions['interaction-home-showcase']!.trigger = 'scroll';
    const { container } = renderRuntime({ project: scrollProject });
    fireEvent.scroll(container.querySelector<HTMLElement>('[data-route-motion]')!);

    expect(screen.getByText('Route: /collection')).toBeInTheDocument();
  });

  it('resolves responsive node overrides before rendering Present', () => {
    const project = createPremiumStarterProject();
    project.breakpoints = {
      mobile: { id: 'mobile', name: 'Mobile', preset: 'mobile', minWidth: 0, maxWidth: 2_000 },
    };
    project.nodes['node-home-title']!.responsiveOverrides = {
      mobile: {
        size: { width: 222 },
        style: { opacity: 0.45 },
      },
    };
    const { container } = renderRuntime({ project });
    const title = container.querySelector<HTMLElement>('[data-viu-runtime-node-id=node-home-title]');

    expect(title?.style.width).toBe('222px');
    expect(title?.style.opacity).toBe('0.45');
  });

  it('resolves active variable modes and rejects incompatible bindings deterministically', () => {
    const project = createPremiumStarterProject();
    project.schemaVersion = 3;
    project.variableCollections = {
      theme: {
        id: 'theme',
        name: 'Theme',
        defaultModeId: 'light',
        modeIds: ['light', 'dark'],
        modes: {
          light: { id: 'light', name: 'Light', kind: 'light' },
          dark: { id: 'dark', name: 'Dark', kind: 'dark' },
        },
      },
    };
    project.activeVariableModes = { theme: 'dark' };
    project.variables.accent = {
      id: 'accent',
      name: 'Accent',
      collectionId: 'theme',
      type: 'color',
      valuesByMode: { light: '#ffffff', dark: '#123456' },
    };
    project.nodes['node-home-title']!.variableBindings = {
      'style.color': { variableId: 'accent' },
    };
    const { container, unmount } = renderRuntime({ project });
    expect(container.querySelector<HTMLElement>('[data-viu-runtime-node-id=node-home-title]')?.style.color).toBe(
      'rgb(18, 52, 86)'
    );
    unmount();

    project.variables.accent = {
      id: 'accent',
      name: 'Accent',
      collectionId: 'theme',
      type: 'number',
      valuesByMode: { light: 1, dark: 2 },
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderRuntime({ project })).toThrow('requires color');
    error.mockRestore();
  });

  it('marks the runtime as reduced-motion when requested', () => {
    const { container } = renderRuntime({ reducedMotion: true });

    expect(container.querySelector('[data-reduced-motion="true"]')).toBeInTheDocument();
  });
});
