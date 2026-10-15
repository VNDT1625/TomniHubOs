/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='settings-page-wrapper'>{children}</div>,
}));

vi.mock('@/renderer/components/base/TomnyScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'page',
}));

vi.mock('@/renderer/hooks/assistant', () => ({
  useAssistantList: () => ({
    assistants: [],
    activeAssistantId: null,
    setActiveAssistantId: vi.fn(),
    activeAssistant: null,
    isExtensionAssistant: () => false,
    loadAssistants: vi.fn(),
  }),
  useDetectedAgents: () => ({ availableBackends: [], refreshAgentDetection: vi.fn() }),
  useAssistantEditor: () =>
    new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (/^(handle|set|load|refresh)/u.test(prop)) return vi.fn();
          if (prop === 'editVisible' || prop === 'isCreating') return false;
          if (/(Skills|Plugins|Hooks|Pending|Auto)/u.test(prop)) return [];
          return '';
        },
      }
    ),
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/AssistantListPanel', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/AssistantSettings/AssistantEditDrawer', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/AssistantSettings/DeleteAssistantModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/AssistantSettings/SkillConfirmModals', () => ({ default: () => null }));

import AssistantSettings from '@/renderer/pages/settings/AssistantSettings';

describe('AssistantSettings wrapper', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps itself in the settings page wrapper by default', () => {
    render(
      <MemoryRouter>
        <AssistantSettings />
      </MemoryRouter>
    );
    expect(screen.getByTestId('settings-page-wrapper')).toBeTruthy();
  });

  it('renders no nested settings wrapper when embedded as a tab', () => {
    render(
      <MemoryRouter>
        <AssistantSettings withWrapper={false} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('settings-page-wrapper')).toBeNull();
    expect(document.querySelector('.flex.flex-col.h-full.w-full')).not.toBeNull();
  });
});
