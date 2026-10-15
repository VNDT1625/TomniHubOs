import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const personalMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listSecrets: vi.fn(),
  saveSecretSet: vi.fn(),
  removeSecretSet: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    personal: {
      get: { invoke: personalMocks.getProfile },
      listSecrets: { invoke: personalMocks.listSecrets },
      saveSecretSet: { invoke: personalMocks.saveSecretSet },
      removeSecretSet: { invoke: personalMocks.removeSecretSet },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PersonalSettings from '@/renderer/pages/settings/PersonalSettings';

// The first render pulls in the whole Arco bundle, which is slow when the machine is loaded.
vi.setConfig({ testTimeout: 30_000 });

const profile = {
  id: 'default',
  facts: [],
  preferences: [],
  habits: [],
  structuredProfile: {
    personalInformation: [],
    psychology: [],
    personality: [],
    interests: [],
    profession: [],
    aestheticTaste: [],
    pastContext: [],
  },
  communication: { vocabulary: [], writingGuidance: [] },
  decisionPolicy: { autonomy: 'ask' as const, mayDecideCategories: [], alwaysAskCategories: [] },
  secretReferences: [],
  learningControl: { paused: false, updatedAt: 1 },
  updatedAt: 1,
};

const terminalOnlySet = {
  handle: 'secret://set/terminal',
  label: 'Server login',
  fields: ['USERNAME', 'PASSWORD'],
  binding: { surfaces: ['terminal', 'owner'], purposes: ['terminal-input', 'reveal'] },
  updatedAt: 1,
};

const legacySet = {
  handle: 'secret://set/legacy',
  label: 'Legacy login',
  fields: ['USERNAME'],
  binding: {
    surfaces: ['browser', 'secret-firewall'],
    purposes: ['browser-fill', 'opaque-use'],
    targets: ['a.example.com'],
  },
  updatedAt: 2,
};

const openSecretsTab = async () => {
  fireEvent.click(await screen.findByText('settings.personalProfile.tabs.secrets'));
};

const openCreateDialog = async () => {
  await openSecretsTab();
  fireEvent.click(await screen.findByRole('button', { name: /settings\.personalProfile\.actions\.addSecret/u }));
  await screen.findByText('settings.personalSecrets.createTitle');
};

const fillSet = () => {
  fireEvent.change(screen.getByPlaceholderText('settings.personalSecrets.setNamePlaceholder'), {
    target: { value: 'Server login' },
  });
  for (const input of screen.getAllByPlaceholderText('settings.personalSecrets.variableValuePlaceholder')) {
    fireEvent.change(input, { target: { value: 'placeholder-value' } });
  }
};

describe('PersonalSettings secret sets (Settings, Cá nhân)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalMocks.getProfile.mockResolvedValue(profile);
    personalMocks.listSecrets.mockResolvedValue([]);
    personalMocks.saveSecretSet.mockResolvedValue(undefined);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        accountSession: {
          getStatus: vi.fn(),
          beginSignIn: vi.fn(),
          signOut: vi.fn(),
          getDiagnosticsConsent: vi.fn().mockResolvedValue({ ok: true, granted: false }),
          setDiagnosticsConsent: vi.fn(),
        },
      },
    });
  });

  it('offers web form and process by default, with hostnames required for the web form', async () => {
    render(<PersonalSettings />);
    await openCreateDialog();

    expect(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationBrowser' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationProcess' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationTerminal' })).not.toBeChecked();
    expect(screen.getByText('settings.personalSecrets.allowedHostnamesLabel')).toBeInTheDocument();

    fillSet();
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalSecrets.createAction' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(personalMocks.saveSecretSet).not.toHaveBeenCalled();
  });

  it('saves a terminal-only set without any hostname', async () => {
    render(<PersonalSettings />);
    await openCreateDialog();

    fireEvent.click(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationBrowser' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationProcess' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationTerminal' }));
    expect(screen.queryByText('settings.personalSecrets.allowedHostnamesLabel')).toBeNull();

    fillSet();
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalSecrets.createAction' }));

    await waitFor(() => expect(personalMocks.saveSecretSet).toHaveBeenCalledTimes(1));
    expect(personalMocks.saveSecretSet.mock.calls[0]?.[0]).toMatchObject({
      name: 'Server login',
      targets: [],
      destinations: ['terminal'],
    });
  });

  it('refuses to save a set that may be used nowhere', async () => {
    render(<PersonalSettings />);
    await openCreateDialog();

    fireEvent.click(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationBrowser' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'settings.personalSecrets.destinationProcess' }));
    fillSet();
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalSecrets.createAction' }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(personalMocks.saveSecretSet).not.toHaveBeenCalled();
  });

  it('shows where each stored set may be used, and hostnames only for web-form sets', async () => {
    personalMocks.listSecrets.mockResolvedValue([terminalOnlySet, legacySet]);
    render(<PersonalSettings />);
    await openSecretsTab();

    await screen.findByText('Server login');
    expect(screen.getAllByText('settings.personalSecrets.destinationTerminal').length).toBeGreaterThan(0);
    // The legacy web-plus-firewall binding reads as web form and process.
    expect(screen.getAllByText('settings.personalSecrets.destinationBrowser')).toHaveLength(1);
    expect(screen.getAllByText('settings.personalSecrets.destinationProcess')).toHaveLength(1);
    expect(screen.getAllByText('settings.personalSecrets.allowedHostnamesTagLabel')).toHaveLength(1);
    expect(screen.getByText('a.example.com')).toBeInTheDocument();
  });
});
