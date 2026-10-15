/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  fs: {
    listAvailableSkills: { invoke: vi.fn() },
    getSkillPaths: { invoke: vi.fn() },
    listBuiltinAutoSkills: { invoke: vi.fn() },
    deleteSkill: { invoke: vi.fn() },
    importSkillWithSymlink: { invoke: vi.fn() },
  },
  dialog: { showOpen: { invoke: vi.fn() } },
}));

vi.mock('@/common', () => ({ ipcBridge: ipc }));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', async () => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ children }: { children: React.ReactNode }) => createElement('div', null, children) };
});

import CapabilityRemoveModal from '@/renderer/pages/settings/ToolsSettings/CapabilityRemoveModal';
import SkillsHubSettings from '@/renderer/pages/settings/SkillsHubSettings';

const SKILLS = [
  {
    name: 'my-skill',
    description: 'user skill',
    location: 'C:/skills/my-skill/SKILL.md',
    is_custom: true,
    source: 'custom',
  },
  {
    name: 'built-in-skill',
    description: 'bundled',
    location: 'C:/builtin/built-in-skill/SKILL.md',
    is_custom: false,
    source: 'builtin',
  },
  {
    name: 'pkg-skill',
    description: 'from a package',
    location: 'C:/skills/.tomny-packages/com.acme.tools/x/SKILL.md',
    is_custom: false,
    source: 'package',
    packageId: 'com.acme.tools',
  },
];

const renderSkills = () =>
  render(
    <MemoryRouter initialEntries={['/settings/capabilities?tab=skills']}>
      <Routes>
        <Route path='/settings/capabilities' element={<SkillsHubSettings withWrapper={false} />} />
        <Route path='/store/package/:packageId' element={<div data-testid='store-package-page'>store</div>} />
      </Routes>
    </MemoryRouter>
  );

const cancelButton = (): HTMLElement => screen.getByText(/^common\.cancel/).closest('button') as HTMLElement;

beforeEach(() => {
  ipc.fs.listAvailableSkills.invoke.mockResolvedValue(SKILLS);
  ipc.fs.getSkillPaths.invoke.mockResolvedValue({ user_skills_dir: 'C:/skills', builtin_skills_dir: 'C:/builtin' });
  ipc.fs.listBuiltinAutoSkills.invoke.mockResolvedValue([]);
  ipc.fs.deleteSkill.invoke.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CapabilityRemoveModal', () => {
  it('shows the item name and the exact target, and calls onCancel from Cancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <CapabilityRemoveModal
        visible
        name='my-skill'
        detail='C:/skills/my-skill/SKILL.md'
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByTestId('remove-target-detail').textContent).toBe('C:/skills/my-skill/SKILL.md');
    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('focuses Cancel by default so Enter cannot remove anything', () => {
    render(<CapabilityRemoveModal visible name='my-skill' onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(document.activeElement).toBe(cancelButton());
  });

  it('calls onConfirm only from the danger button', () => {
    const onConfirm = vi.fn();
    render(<CapabilityRemoveModal visible name='my-skill' onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('btn-confirm-remove'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('Skills tab removal', () => {
  it('offers delete only for user-added skills, never for built-in ones', async () => {
    renderSkills();
    await screen.findByTestId('my-skill-card-my-skill');
    expect(screen.getByTestId('btn-delete-my-skill')).toBeTruthy();
    expect(screen.queryByTestId('btn-delete-built-in-skill')).toBeNull();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    renderSkills();
    fireEvent.click(await screen.findByTestId('btn-delete-my-skill'));
    await screen.findByTestId('btn-confirm-remove');
    fireEvent.click(cancelButton());
    expect(ipc.fs.deleteSkill.invoke).not.toHaveBeenCalled();
  });

  it('deletes the skill only after confirming', async () => {
    renderSkills();
    fireEvent.click(await screen.findByTestId('btn-delete-my-skill'));
    fireEvent.click(await screen.findByTestId('btn-confirm-remove'));
    await waitFor(() => expect(ipc.fs.deleteSkill.invoke).toHaveBeenCalledWith({ skill_name: 'my-skill' }));
  });

  it('shows Remove plugin on the plugin group and opens that package page instead of deleting', async () => {
    renderSkills();
    await screen.findByTestId('plugin-skill-group-com.acme.tools');
    expect(screen.queryByTestId('btn-delete-pkg-skill')).toBeNull();
    fireEvent.click(screen.getByText('settings.capabilitiesTab.removePlugin'));
    expect(await screen.findByTestId('store-package-page')).toBeTruthy();
    expect(ipc.fs.deleteSkill.invoke).not.toHaveBeenCalled();
  });
});
