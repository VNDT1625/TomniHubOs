import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_RULES, type NotificationRules } from '@/common/types/platform/notificationHub';

const ipc = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  stages: vi.fn(),
  definition: vi.fn(),
}));
const hub = vi.hoisted(() => ({ saveRules: vi.fn(), rules: undefined as unknown }));

vi.mock('@/common', () => ({
  ipcBridge: {
    systemSettings: {
      getNotificationEnabled: { invoke: ipc.get },
      setNotificationEnabled: { invoke: ipc.set },
    },
    conversation: {
      getPipelineAvailableStages: { invoke: ipc.stages },
      getPipelineDefinition: { invoke: ipc.definition },
    },
  },
}));
vi.mock('@/common/types/platform/notificationHub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/types/platform/notificationHub')>()),
  notificationHubChannels: { saveRules: { invoke: hub.saveRules } },
}));
vi.mock('@/renderer/services/notificationService', () => ({
  useNotificationHub: () => ({ settings: { connectors: [], rules: hub.rules } }),
}));
vi.mock('@/renderer/pages/conversation/components/pipeline/ChatPipelineModal', () => ({
  ChatPipelineModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid='pipeline-editor'>editor</div> : null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AiConfigSettings from '@/renderer/pages/settings/AiConfigSettings';
import NotificationSettings from '@/renderer/pages/settings/NotificationSettings';
import PipelineChatSettings from '@/renderer/pages/settings/PipelineChatSettings';
import PrivacySecuritySettings from '@/renderer/pages/settings/PrivacySecuritySettings';

const rules = (patch: Partial<NotificationRules> = {}): NotificationRules => ({
  ...DEFAULT_NOTIFICATION_RULES,
  ...patch,
});

beforeEach(() => {
  ipc.get.mockReset().mockResolvedValue(true);
  ipc.set.mockReset().mockResolvedValue(undefined);
  ipc.stages.mockReset().mockResolvedValue([]);
  ipc.definition.mockReset().mockResolvedValue({
    schemaVersion: 1,
    id: 'default',
    name: 'Default',
    enabled: true,
    stages: [
      { id: 's1', stageRegistryId: 'builtin:tool-schema', phase: 'pre_model', enabled: true },
      { id: 's2', stageRegistryId: 'plugin:custom', phase: 'post_model', enabled: false },
    ],
  });
  hub.saveRules.mockReset().mockImplementation(async (next: unknown) => next);
  hub.rules = rules();
});

describe('settings pages that are not connected yet', () => {
  it.each([
    ['pipeline', PipelineChatSettings],
    ['privacy and security', PrivacySecuritySettings],
  ])('say so and leave every planned switch off the table on the %s page', (_name, Page) => {
    render(<Page />);
    expect(screen.getByTestId('settings-not-active').textContent).toContain('settings.notActive.title');
    if (Page === PipelineChatSettings) {
      const disclosure = screen.getByTestId('settings-not-active').closest('details');
      expect(disclosure).not.toBeNull();
      expect(disclosure?.hasAttribute('open')).toBe(false);
      expect(disclosure?.querySelector('summary')?.textContent).toBe('settings.pipelineSettings.plannedNotice');
      expect(disclosure?.querySelectorAll('button, input, select').length).toBe(0);
      return;
    }
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    for (const control of switches) expect((control as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the inference parameters on the AI configuration page', () => {
    const { container } = render(<AiConfigSettings />);
    expect(screen.getByTestId('settings-not-active').textContent).toContain('settings.notActive.aiConfig');
    expect(
      container.querySelectorAll('.arco-slider-disabled, .arco-select-disabled, .arco-input-number-disabled').length
    ).toBeGreaterThan(0);
  });
});

describe('the pipeline page', () => {
  it('shows the real default chain and opens the editor for it', async () => {
    render(<PipelineChatSettings />);
    const chain = await screen.findByTestId('pipeline-default-chain');
    expect(ipc.definition).toHaveBeenCalledWith({});
    expect(within(chain).getByText('settings.pipelineSettings.stageOn')).toBeTruthy();
    expect(within(chain).getByText('settings.pipelineSettings.stageOff')).toBeTruthy();
    expect(chain.textContent).toContain('plugin:custom');
    fireEvent.click(screen.getByText('settings.pipelineSettings.editDefault'));
    expect(screen.getByTestId('pipeline-editor')).toBeTruthy();
  });

    it('preserves original stage numbering while grouping input and output', async () => {
    render(<PipelineChatSettings />);
    const chain = await screen.findByTestId('pipeline-default-chain');
    const groups = chain.querySelectorAll('section');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.textContent).toContain('1.');
    expect(groups[0]?.textContent).toContain('settings.pipelineSettings.stageOn');
    expect(groups[1]?.textContent).toContain('2.');
    expect(groups[1]?.textContent).toContain('settings.pipelineSettings.stageOff');
  });

  it('retries loading the actual definition after a transient failure', async () => {
    ipc.definition.mockRejectedValueOnce(new Error('offline'));
    render(<PipelineChatSettings />);
    expect(await screen.findByText('settings.pipelineSettings.loadFailed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(ipc.definition).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('pipeline-default-chain')).toBeTruthy();
    expect(screen.queryByText('settings.pipelineSettings.loadFailed')).toBeNull();
  });
});

describe('the notification page', () => {
  it('reads the real banner setting and writes it back', async () => {
    ipc.get.mockResolvedValue(false);
    render(<NotificationSettings />);
    const [banner] = screen.getAllByRole('switch') as HTMLButtonElement[];
    await waitFor(() => expect(banner.getAttribute('aria-checked')).toBe('false'));
    expect((screen.getByTestId('notification-sound') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(banner);
    expect(ipc.set).toHaveBeenCalledWith({ enabled: true });
    await waitFor(() => expect(banner.getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByTestId('settings-not-active')).toBeNull();
  });

  it('saves sound, attention, RAM and quiet-hours rules to the notification hub', async () => {
    render(<NotificationSettings />);
    await waitFor(() => expect(ipc.get).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('notification-sound'));
    expect(hub.saveRules).toHaveBeenLastCalledWith(rules({ sound: false }));
    fireEvent.click(screen.getByTestId('notification-attention'));
    expect(hub.saveRules).toHaveBeenLastCalledWith(rules({ bringToFrontOnInput: false }));
    fireEvent.click(screen.getByTestId('notification-ram'));
    expect(hub.saveRules).toHaveBeenLastCalledWith(rules({ ramAlert: false }));
    fireEvent.click(screen.getByTestId('notification-quiet'));
    expect(hub.saveRules).toHaveBeenLastCalledWith(
      rules({ quietHours: { ...DEFAULT_NOTIFICATION_RULES.quietHours, enabled: true } })
    );
  });

  it('keeps the banner usable when the setting cannot be read', async () => {
    ipc.get.mockRejectedValue(new Error('offline'));
    render(<NotificationSettings />);
    const [banner] = screen.getAllByRole('switch') as HTMLButtonElement[];
    await waitFor(() => expect(ipc.get).toHaveBeenCalled());
    expect(banner.disabled).toBe(false);
  });
});
