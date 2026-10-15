import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  webui: vi.fn(),
  gateway: vi.fn(),
  notifications: vi.fn(),
  saveNotifications: vi.fn(),
  metrics: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    webui: { getStatus: { invoke: calls.webui } },
    omniGateway: { getStatus: { invoke: calls.gateway } },
    systemSettings: {
      getNotificationEnabled: { invoke: calls.notifications },
      setNotificationEnabled: { invoke: calls.saveNotifications },
      getBackgroundSleepMetrics: { invoke: calls.metrics },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import BackgroundServicesPanel from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BackgroundServicesPanel';

beforeEach(() => {
  calls.webui.mockReset().mockResolvedValue({ running: true });
  calls.gateway.mockReset().mockResolvedValue({ running: false });
  calls.notifications.mockReset().mockResolvedValue(true);
  calls.saveNotifications.mockReset().mockResolvedValue(undefined);
  calls.metrics.mockReset().mockResolvedValue({
    mode: 'awake',
    before: { sampledAt: 0, workingSetMB: 1000, cpuPercent: 2, processCount: 3 },
    after: { sampledAt: 5000, workingSetMB: 250, cpuPercent: 0, processCount: 2 },
    current: { sampledAt: 6000, workingSetMB: 400, cpuPercent: 1, processCount: 3 },
    savedWorkingSetMB: 750,
    savedWorkingSetPercent: 75,
    sampling: false,
  });
});

describe('Background services Settings overview', () => {
  it('shows real status from existing providers and the last measured RAM change', async () => {
    render(<BackgroundServicesPanel />);
    expect(await screen.findByTestId('background-saved-mb')).toHaveProperty('textContent',
      expect.stringContaining('-750 MB'));
        expect(screen.getByTestId('background-cpu-change').textContent).toContain('2% → 0%');
    await waitFor(() => expect(calls.gateway).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('background-services-panel').textContent).toContain('settings.backgroundSleep.running');
    expect(calls.webui).toHaveBeenCalledTimes(1);
  });

  it('updates notifications via the existing Settings bridge, without starting MCP or WebUI', async () => {
    render(<BackgroundServicesPanel />);
    const checkbox = screen.getByTestId('background-notifications') as HTMLButtonElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    await waitFor(() => expect(calls.saveNotifications).toHaveBeenCalledWith({ enabled: false }));
    expect(calls.webui).toHaveBeenCalledTimes(1);
  });
});
