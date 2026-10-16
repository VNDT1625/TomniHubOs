/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ASSISTANT_LIMITS } from '@/common/types/agent/assistant/assistantSchema';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: vi.fn(async () => ({ allServers: [] })),
}));

import AssistantEditDrawer from '@/renderer/pages/settings/AssistantSettings/AssistantEditDrawer';

const baseProps = {
  editVisible: true,
  setEditVisible: vi.fn(),
  isCreating: true,
  editName: 'Helper',
  setEditName: vi.fn(),
  editDescription: '',
  setEditDescription: vi.fn(),
  editAvatar: '',
  setEditAvatar: vi.fn(),
  editAvatarImage: undefined,
  editAgent: 'claude',
  setEditAgent: vi.fn(),
  editContext: '',
  setEditContext: vi.fn(),
  editPrompts: [] as string[],
  setEditPrompts: vi.fn(),
  promptViewMode: 'edit' as const,
  setPromptViewMode: vi.fn(),
  availableSkills: [],
  selectedSkills: [],
  setSelectedSkills: vi.fn(),
  selectedPlugins: [],
  setSelectedPlugins: vi.fn(),
  selectedHooks: [],
  setSelectedHooks: vi.fn(),
  pendingSkills: [],
  customSkills: [],
  setDeletePendingSkillName: vi.fn(),
  setDeleteCustomSkillName: vi.fn(),
  builtinAutoSkills: [],
  disabledBuiltinSkills: [],
  setDisabledBuiltinSkills: vi.fn(),
  activeAssistant: null,
  activeAssistantId: null,
  isExtensionAssistant: () => false,
  availableBackends: [],
  handleSave: vi.fn(),
  handleDeleteClick: vi.fn(),
  handleDuplicate: vi.fn(),
};

const renderDrawer = (props: Partial<typeof baseProps>) =>
  render(
    <MemoryRouter>
      <ConfigProvider>
        <AssistantEditDrawer {...baseProps} {...props} />
      </ConfigProvider>
    </MemoryRouter>
  );

describe('AssistantEditDrawer example prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('can attach an optional UCON avatar and customize its accessories', async () => {
    const setEditAvatar = vi.fn();
    const user = userEvent.setup();
    renderDrawer({ editAvatar: '', setEditAvatar });
    await user.selectOptions(screen.getByTestId('ucon-avatar-preset'), 'engineer');
    expect(setEditAvatar).toHaveBeenCalledWith('ucon:engineer');
    cleanup();
    setEditAvatar.mockClear();
    renderDrawer({ editAvatar: 'ucon:engineer', setEditAvatar });
    expect(screen.getByTestId('ucon-slot-prop')).toHaveValue('tablet');
    const avatarPreview = screen.getByTestId('ucon-avatar-preview');
    expect(avatarPreview.querySelector('.ucon-bot--preview[data-state="idle"]')).not.toBeNull();
    await user.selectOptions(screen.getByTestId('ucon-preview-state'), 'needs_input');
    expect(avatarPreview.querySelector('.ucon-bot--preview[data-state="needs_input"]')).not.toBeNull();
    await user.selectOptions(screen.getByTestId('ucon-preview-state'), 'working');
    expect(avatarPreview.querySelector('.ucon-bot--preview[data-state="working"]')).not.toBeNull();
    expect(setEditAvatar).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByTestId('ucon-slot-prop'), 'wrench');
    expect(setEditAvatar).toHaveBeenCalledWith('ucon:engineer;prop=wrench');
    expect(screen.getByTestId('ucon-slot-ears')).toHaveValue('fin');
  });

  it('offers CLI-based UCON skins including Grok without altering the Tomny avatar', async () => {
    const setEditAvatar = vi.fn();
    const user = userEvent.setup();
    renderDrawer({ editAvatar: '', editAgent: 'gemini', setEditAvatar });
    await user.selectOptions(screen.getByTestId('ucon-avatar-preset'), 'uconcli:grok');
    expect(setEditAvatar).toHaveBeenCalledWith('uconcli:grok');
    cleanup();
    renderDrawer({ editAvatar: 'uconcli:grok', editAgent: 'gemini', setEditAvatar });
    expect(screen.getByTestId('ucon-avatar-preset')).toHaveValue('uconcli:grok');
    expect(screen.getByTestId('ucon-avatar-preview').querySelector('[data-cli-skin="grok"]')).not.toBeNull();
  });

  it('renders the existing lines with a count and adds an empty line on Add', async () => {
    const setEditPrompts = vi.fn();
    renderDrawer({ editPrompts: ['Find the latest news'], setEditPrompts });
    expect(await screen.findByTestId('assistant-prompts-section')).toBeTruthy();
    expect(screen.getByTestId('assistant-prompt-input-0')).toBeTruthy();
    expect(screen.getByText(`1/${ASSISTANT_LIMITS.promptMax}`)).toBeTruthy();
    await userEvent.setup().click(screen.getByTestId('assistant-prompt-add'));
    expect(setEditPrompts).toHaveBeenCalledWith(['Find the latest news', '']);
  });

  it('removes a line by its position', async () => {
    const setEditPrompts = vi.fn();
    renderDrawer({ editPrompts: ['one', 'two', 'three'], setEditPrompts });
    await userEvent.setup().click(screen.getByTestId('assistant-prompt-remove-1'));
    expect(setEditPrompts).toHaveBeenCalledWith(['one', 'three']);
  });

  it('edits a line and reports the new text', async () => {
    const setEditPrompts = vi.fn();
    renderDrawer({ editPrompts: ['a'], setEditPrompts });
    fireEvent.change(screen.getByTestId('assistant-prompt-input-0'), { target: { value: 'ab' } });
    expect(setEditPrompts).toHaveBeenLastCalledWith(['ab']);
  });

  it('disables Add and shows the limit at the cap', async () => {
    const full = Array.from({ length: ASSISTANT_LIMITS.promptMax }, (_, i) => `p${i}`);
    const setEditPrompts = vi.fn();
    renderDrawer({ editPrompts: full, setEditPrompts });
    const add = screen.getByTestId('assistant-prompt-add');
    expect(add.hasAttribute('disabled') || add.closest('button')?.disabled).toBe(true);
    expect(screen.getByTestId('assistant-prompt-limit').textContent).toContain('At most');
  });
});
