/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultViuVectorGeometry,
  createViuBooleanGeometry,
  createViuMaskGeometry,
} from '@/common/viu/graphics/vector';
import ViuVectorGraphic from '@/renderer/pages/studio/ide/Viu/next/runtime/ViuVectorGraphic';

afterEach(cleanup);

describe('ViuVectorGraphic', () => {
  it('renders the same path contract with fill rule and stroke geometry', () => {
    const geometry = {
      ...createDefaultViuVectorGeometry(200, 120),
      fillRule: 'evenodd' as const,
      strokeCap: 'square' as const,
      strokeJoin: 'bevel' as const,
      miterLimit: 12,
    };
    const view = render(
      <ViuVectorGraphic
        geometry={geometry}
        nodeStyle={{
          opacity: 1,
          background: 'var(--color-fill-2)',
          borderColor: 'var(--color-primary-6)',
          borderWidth: 3,
          borderStyle: 'dashed',
        }}
        width={200}
        height={120}
      />
    );

    const path = view.container.querySelector('path');
    expect(path?.getAttribute('d')).toBe(geometry.pathData);
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
    expect(path?.getAttribute('stroke-linecap')).toBe('square');
  });

  it('renders ordered structured solid and gradient fills without flattening them to CSS', () => {
    const geometry = createDefaultViuVectorGeometry(200, 120);
    const view = render(
      <ViuVectorGraphic
        geometry={geometry}
        nodeStyle={{
          opacity: 1,
          fills: [
            { id: 'solid', type: 'solid', visible: true, opacity: 0.75, color: 'red' },
            {
              id: 'gradient',
              type: 'linear',
              visible: true,
              opacity: 0.5,
              angle: 90,
              stops: [
                { color: 'blue', position: 0 },
                { color: 'white', position: 1 },
              ],
            },
          ],
          borderColor: 'black',
          borderWidth: 2,
          borderStyle: 'solid',
        }}
        width={200}
        height={120}
      />
    );

    const fills = view.container.querySelectorAll('[data-viu-vector-fill]');
    expect(fills).toHaveLength(2);
    expect(fills[0]?.getAttribute('fill')).toMatch(/^url\(#viu-/);
    expect(view.container.querySelector('linearGradient stop')?.getAttribute('stop-opacity')).toBe('0.5');
  });

  it('does not paint a fill for an open pen path', () => {
    const geometry = createDefaultViuVectorGeometry(200, 120, 'pen');
    const view = render(
      <ViuVectorGraphic
        geometry={geometry}
        nodeStyle={{ opacity: 1, background: 'var(--color-fill-2)' }}
        width={200}
        height={120}
      />
    );

    expect(view.container.querySelector('path')?.getAttribute('fill')).toBe('transparent');
  });

  it.each(['union', 'subtract', 'intersect', 'exclude'] as const)(
    'renders a deterministic SVG mask for %s geometry in every consumer',
    (kind) => {
      const geometry = createViuBooleanGeometry(
        [
          { id: 'back', geometry: createDefaultViuVectorGeometry(200, 120) },
          {
            id: 'front',
            geometry: createDefaultViuVectorGeometry(80, 80),
            transform: [1, 0, 0, 1, 60, 20],
          },
        ],
        kind
      );
      const view = render(
        <ViuVectorGraphic
          geometry={geometry}
          nodeStyle={{ opacity: 1, background: 'var(--color-fill-2)' }}
          width={200}
          height={120}
        />
      );

      const svg = view.container.querySelector('[data-viu-vector-graphic]');
      const paintedResult = view.container.querySelector('rect[mask]');
      expect(svg?.getAttribute('data-viu-vector-boolean')).toBe(kind);
      expect(paintedResult?.getAttribute('mask')).toMatch(/^url\(#viu-/);
      expect(view.container.querySelector('[data-viu-vector-path]')?.getAttribute('d')).toBe(geometry.pathData);
    }
  );

  it('renders all contours of an ordinary compound vector without a boolean mask', () => {
    const first = createDefaultViuVectorGeometry(200, 120);
    const second = createDefaultViuVectorGeometry(40, 40);
    const geometry = {
      ...first,
      pathData: `${first.pathData} M 40 40 L 80 40 L 80 80 L 40 80 Z`,
    };
    const view = render(<ViuVectorGraphic geometry={geometry} nodeStyle={{ opacity: 1 }} width={200} height={120} />);

    expect(view.container.querySelector('[data-viu-vector-path]')?.getAttribute('d')?.match(/M /g)).toHaveLength(2);
    expect(view.container.querySelector('mask')).toBeNull();
  });

  it.each(['clip', 'alpha'] as const)('renders a user-authored %s mask from the shared vector contract', (kind) => {
    const geometry = createViuMaskGeometry(
      [
        { id: 'content', geometry: createDefaultViuVectorGeometry(200, 120) },
        {
          id: 'mask',
          geometry: createDefaultViuVectorGeometry(80, 80),
          transform: [1, 0, 0, 1, 60, 20],
        },
      ],
      kind
    );
    const view = render(
      <ViuVectorGraphic
        geometry={geometry}
        nodeStyle={{ opacity: 1, background: 'var(--color-fill-2)' }}
        width={200}
        height={120}
      />
    );

    const svg = view.container.querySelector('[data-viu-vector-graphic]');
    const paintedResult = view.container.querySelector(kind === 'clip' ? 'path[clip-path]' : 'path[mask]');
    expect(svg?.getAttribute('data-viu-vector-mask')).toBe(kind);
    expect(paintedResult).not.toBeNull();
    expect(view.container.querySelector(kind === 'clip' ? 'clipPath' : 'mask')).not.toBeNull();
  });
});
