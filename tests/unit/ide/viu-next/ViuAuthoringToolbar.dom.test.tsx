/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ViuAuthoringToolbar from '@package-apps/design/renderer/viu/next/ViuAuthoringToolbar';

const labels = {
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
};

type ToolbarProps = React.ComponentProps<typeof ViuAuthoringToolbar>;

const renderToolbar = (overrides: Partial<ToolbarProps> = {}) => {
  const callbacks = {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    onAlign: vi.fn(),
    onDistribute: vi.fn(),
  };
  render(
    <ConfigProvider>
      <ViuAuthoringToolbar
        labels={labels}
        canUndo
        canRedo
        canMutate
        canGroup
        canUngroup
        canAlign
        canDistribute
        {...callbacks}
        {...overrides}
      />
    </ConfigProvider>
  );
  return callbacks;
};

afterEach(cleanup);

describe('VIU authoring toolbar', () => {
  it('dispatches history and structural commands from the visible command surface', () => {
    const callbacks = renderToolbar();

    for (const id of ['undo', 'redo', 'duplicate', 'delete', 'group', 'ungroup']) {
      fireEvent.click(screen.getByTestId(`viu-authoring-${id}`));
    }

    expect(callbacks.onUndo).toHaveBeenCalledOnce();
    expect(callbacks.onDelete).toHaveBeenCalledOnce();
    expect(callbacks.onUngroup).toHaveBeenCalledOnce();
  });

  it('preserves the exact alignment and distribution intent selected by the user', () => {
    const callbacks = renderToolbar();

    for (const id of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
      fireEvent.click(screen.getByTestId(`viu-authoring-align-${id}`));
    }
    fireEvent.click(screen.getByTestId('viu-authoring-distribute-horizontal'));
    fireEvent.click(screen.getByTestId('viu-authoring-distribute-vertical'));

    expect(callbacks.onAlign.mock.calls.map(([alignment]) => alignment)).toEqual([
      'left',
      'horizontal-center',
      'right',
      'top',
      'vertical-center',
      'bottom',
    ]);
    expect(callbacks.onDistribute).toHaveBeenNthCalledWith(1, 'horizontal');
    expect(callbacks.onDistribute).toHaveBeenNthCalledWith(2, 'vertical');
  });

  it('prevents every unavailable operation instead of emitting partial edits', () => {
    const callbacks = renderToolbar({
      canUndo: false,
      canRedo: false,
      canMutate: false,
      canGroup: false,
      canUngroup: false,
      canAlign: false,
      canDistribute: false,
    });

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(14);
    expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(Object.values(callbacks).every((callback) => callback.mock.calls.length === 0)).toBe(true);
  });
});
