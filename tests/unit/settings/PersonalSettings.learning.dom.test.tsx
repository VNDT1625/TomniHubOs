import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const personalMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listSecrets: vi.fn(),
  setLearningPaused: vi.fn(),
  confirmLearning: vi.fn(),
  rejectLearning: vi.fn(),
  correctLearning: vi.fn(),
  forgetLearning: vi.fn(),
  deleteLearning: vi.fn(),
  exportLearning: vi.fn(),
}));
const diagnosticsMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    personal: {
      get: { invoke: personalMocks.getProfile },
      listSecrets: { invoke: personalMocks.listSecrets },
      setLearningPaused: { invoke: personalMocks.setLearningPaused },
      confirmLearning: { invoke: personalMocks.confirmLearning },
      rejectLearning: { invoke: personalMocks.rejectLearning },
      correctLearning: { invoke: personalMocks.correctLearning },
      forgetLearning: { invoke: personalMocks.forgetLearning },
      deleteLearning: { invoke: personalMocks.deleteLearning },
      exportLearning: { invoke: personalMocks.exportLearning },
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

const proposedRecord = {
  id: 'proposal_1',
  collection: 'preferences' as const,
  fact: {
    key: 'language',
    value: 'English',
    confidence: 0.7,
    source: 'observed' as const,
    learnedAt: 1,
    scope: { kind: 'global' as const },
    sensitivity: 'normal' as const,
    userLocked: false,
  },
  explanation: 'The user repeatedly chose English.',
  provenance: 'run:opaque-1',
  causal: {
    context: 'support replies',
    origin: 'run:opaque-1',
    reason: undefined,
    reasonKnown: false,
    proposal: 'Reply in English for support.',
  },
  status: 'proposed' as const,
  createdAt: 1,
};

const appliedRecord = { ...proposedRecord, id: 'applied_1', status: 'applied' as const };

describe('PersonalSettings learning control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalMocks.getProfile.mockResolvedValue(profile);
    personalMocks.listSecrets.mockResolvedValue([]);
    personalMocks.setLearningPaused.mockResolvedValue({ paused: true, updatedAt: 2 });
    personalMocks.confirmLearning.mockResolvedValue(true);
    personalMocks.rejectLearning.mockResolvedValue(true);
    personalMocks.correctLearning.mockResolvedValue(true);
    personalMocks.forgetLearning.mockResolvedValue(true);
    personalMocks.deleteLearning.mockResolvedValue(true);
    personalMocks.exportLearning.mockResolvedValue({ ...profile, secretReferences: undefined });
    diagnosticsMocks.get.mockResolvedValue({ ok: true, granted: false });
    diagnosticsMocks.set.mockResolvedValue({ ok: true, granted: true });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        accountSession: {
          getStatus: vi.fn(),
          beginSignIn: vi.fn(),
          signOut: vi.fn(),
          getDiagnosticsConsent: diagnosticsMocks.get,
          setDiagnosticsConsent: diagnosticsMocks.set,
        },
      },
    });
  });

  it('uses the dedicated Main control instead of persisting a profile edit to pause new learning proposals', async () => {
    render(<PersonalSettings />);

    const control = await screen.findByRole('switch', {
      name: 'settings.personalProfile.learning.title',
    });
    expect(control).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(control);

    await waitFor(() => expect(personalMocks.setLearningPaused).toHaveBeenCalledWith({ paused: true }));
    expect(personalMocks.setLearningPaused).toHaveBeenCalledTimes(1);
  });

  it('loads and updates diagnostics consent only through the account-session bridge', async () => {
    render(<PersonalSettings />);

    const control = await screen.findByRole('switch', {
      name: 'settings.personalProfile.diagnostics.title',
    });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);

    await waitFor(() => expect(diagnosticsMocks.set).toHaveBeenCalledWith({ granted: true }));
    expect(diagnosticsMocks.get).toHaveBeenCalledOnce();
    expect(personalMocks.setLearningPaused).not.toHaveBeenCalled();
  });

  it('uses only an opaque record ID to confirm an owner-scoped proposed record', async () => {
    personalMocks.getProfile.mockResolvedValue({ ...profile, learningRecords: [proposedRecord] });
    render(<PersonalSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.personalProfile.learning.review.confirm' }));

    await waitFor(() => expect(personalMocks.confirmLearning).toHaveBeenCalledWith({ recordId: 'proposal_1' }));
    expect(personalMocks.confirmLearning.mock.calls[0]?.[0]).not.toHaveProperty('accountId');
    expect(personalMocks.confirmLearning.mock.calls[0]?.[0]).not.toHaveProperty('profileId');
  });

  it('uses only an opaque record ID to reject an owner-scoped proposed record', async () => {
    personalMocks.getProfile.mockResolvedValue({ ...profile, learningRecords: [proposedRecord] });
    render(<PersonalSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.personalProfile.learning.review.reject' }));

    await waitFor(() => expect(personalMocks.rejectLearning).toHaveBeenCalledWith({ recordId: 'proposal_1' }));
    expect(personalMocks.rejectLearning.mock.calls[0]?.[0]).not.toHaveProperty('accountId');
    expect(personalMocks.rejectLearning.mock.calls[0]?.[0]).not.toHaveProperty('profileId');
  });

  it('sends a bounded correction with a user reason but no renderer-owned identity', async () => {
    personalMocks.getProfile.mockResolvedValue({ ...profile, learningRecords: [proposedRecord] });
    render(<PersonalSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.personalProfile.learning.review.correct' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'settings.personalProfile.learning.review.correctValueLabel' }),
      {
        target: { value: 'Vietnamese' },
      }
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'settings.personalProfile.learning.review.reasonLabel' }), {
      target: { value: 'I explicitly prefer Vietnamese.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalProfile.learning.review.saveCorrection' }));

    await waitFor(() =>
      expect(personalMocks.correctLearning).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: 'proposal_1',
          fact: expect.objectContaining({ value: 'Vietnamese', source: 'user', userLocked: true }),
          causal: expect.objectContaining({ reason: 'I explicitly prefer Vietnamese.', reasonKnown: true }),
        })
      )
    );
    expect(personalMocks.correctLearning.mock.calls[0]?.[0]).not.toHaveProperty('accountId');
  });

  it('uses exact owner-scoped lifecycle operations for forget, delete, and export', async () => {
    personalMocks.getProfile.mockResolvedValue({ ...profile, learningRecords: [appliedRecord] });
    const createObjectUrl = vi.fn(() => 'blob:context');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<PersonalSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.personalProfile.learning.review.forget' }));
    await waitFor(() => expect(personalMocks.forgetLearning).toHaveBeenCalledWith({ recordId: 'applied_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalProfile.learning.review.export' }));
    await waitFor(() => expect(personalMocks.exportLearning).toHaveBeenCalledWith());
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:context');
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
