/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null }),
}));

vi.mock('@package-apps/document-studio/renderer/studio/editorToolsProvider', () => ({
  useEditorToolsProvider: vi.fn(),
}));

vi.mock('@package-apps/document-studio/renderer/studio/components/StudioDashboard', () => ({
  default: ({ onOpenIde }: { onOpenIde: () => void }) => (
    <button data-testid='open-ide' onClick={onOpenIde}>
      Open IDE
    </button>
  ),
}));

vi.mock('@package-apps/document-studio/renderer/studio/components/StudioEditorView', () => ({ default: () => null }));
vi.mock('@package-apps/document-studio/renderer/studio/components/StudioPeerView', () => ({ default: () => null }));
vi.mock('@/renderer/pages/studio/automation/AutomationView', () => ({ default: () => null }));
vi.mock('@/renderer/pages/studio/makevideo/MakeVideoView', () => ({ default: () => null }));
vi.mock('@renderer/pages/music', () => ({ default: () => null }));

import StudioPage from '@package-apps/document-studio/renderer/studio/StudioPage';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => void store.set(key, value),
    removeItem: (key: string): void => void store.delete(key),
    clear: (): void => store.clear(),
  });
});

afterEach(() => cleanup());

describe('StudioPage package navigation', () => {
  it('delegates IDE launch to the installed IDE package', () => {
    const onOpenIde = vi.fn();
    render(<StudioPage onOpenIde={onOpenIde} />);

    fireEvent.click(screen.getByTestId('open-ide'));

    expect(onOpenIde).toHaveBeenCalledTimes(1);
    expect(onOpenIde).toHaveBeenCalledWith('files');
  });
});
