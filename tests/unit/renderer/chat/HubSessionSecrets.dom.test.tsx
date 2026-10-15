import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretSetsApi } from '@/renderer/services/secretSetsClient';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  reveal: vi.fn(),
  dismissRequest: vi.fn(),
}));
const factories = vi.hoisted(() => ({ session: vi.fn(), company: vi.fn() }));

vi.mock('@/renderer/services/secretSetsClient', () => ({
  sessionSecretSets: (id: string) => {
    factories.session(id);
    // Like the real client, every call returns a new object for its own scope.
    return { ...api };
  },
  companySecretSets: (id: string) => {
    factories.company(id);
    return { ...api };
  },
}));
// Arco's imperative Message needs ReactDOM.render, which React 19 no longer has; the panel only toasts a result.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.terminal ? `${key}|${options.terminal}` : key),
  }),
}));

import { HubSessionSecrets } from '@/renderer/pages/guid/HubHome/memory/HubSessionSecrets';
import { SecretSetsPanel } from '@/renderer/pages/guid/HubHome/memory/SecretSetsPanel';
import { REVEAL_VISIBLE_MS, useSecretSets } from '@/renderer/pages/guid/HubHome/memory/useSecretSets';

const L = (name: string) => `guid.hubHome.secrets.${name}`;
const mine = {
  handle: 'secret://session/1',
  label: 'GitHub login',
  note: 'Release job',
  fields: ['USERNAME', 'PASSWORD'],
  scope: 'session',
  destinations: ['terminal', 'process'],
  updatedAt: 1,
};
const shared = {
  handle: 'secret://app/1',
  label: 'Shared token',
  fields: ['TOKEN'],
  scope: 'app',
  destinations: ['browser'],
  hosts: ['admin.example.com'],
  updatedAt: 1,
};
const listing = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  data: { sets: [mine], requests: [], keychainAvailable: true, ...overrides },
});
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('HubSessionSecrets (Khóa bí mật)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(listing());
    api.save.mockResolvedValue({ ok: true, data: mine });
    api.remove.mockResolvedValue({ ok: true, data: true });
    api.reveal.mockResolvedValue({ ok: true, data: 'plain-secret-value' });
    api.dismissRequest.mockResolvedValue({ ok: true, data: true });
  });

  it('shows nothing and asks for an agent when no conversation is selected', () => {
    render(<HubSessionSecrets active />);
    expect(screen.getByText(L('selectAgent'))).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
    expect(factories.session).not.toHaveBeenCalled();
  });

  it('addresses the secrets by conversation id and explains that they are temporary', async () => {
    render(<HubSessionSecrets sessionId='conversation-1' active />);

    const card = await screen.findByTestId('hub-secret-set-GitHub login');
    expect(factories.session).toHaveBeenCalledWith('conversation-1');
    expect(within(card).getByText('Release job')).toBeInTheDocument();
    expect(within(card).getByText('USERNAME')).toBeInTheDocument();
    expect(within(card).getByText(L('destination.terminal'))).toBeInTheDocument();
    expect(within(card).getByText(L('destination.process'))).toBeInTheDocument();
    expect(screen.getByTestId('hub-secret-scope-note')).toHaveTextContent(L('usageSession'));
  });

  it('lists app-level sets read-only, apart from this conversation', async () => {
    api.list.mockResolvedValue(listing({ sets: [mine, shared] }));
    render(<HubSessionSecrets sessionId='conversation-1' active />);

    const card = await screen.findByTestId('hub-secret-shared-Shared token');
    expect(within(card).getByText('admin.example.com')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
    expect(screen.getByText(L('sharedHint'))).toBeInTheDocument();
  });

  it('creates a set with chosen destinations and clears every typed value afterwards', async () => {
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('add')) }));
    fill(L('name'), 'Sudo login');
    fireEvent.click(screen.getByLabelText(L('destination.process')));
    fireEvent.click(screen.getByLabelText(L('destination.terminal')));
    fill(`${L('variableName')} 1`, 'SUDO_PASSWORD');
    fill(`${L('variableValue')} 1`, 'not-returned-to-renderer');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('save')) }));

    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        label: 'Sudo login',
        destinations: ['terminal'],
        variables: [{ name: 'SUDO_PASSWORD', value: 'not-returned-to-renderer' }],
      })
    );
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('needs hostnames for a web form and refuses an incomplete set without calling Main', async () => {
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('add')) }));
    fill(L('name'), 'Admin site');
    fireEvent.click(screen.getByLabelText(L('destination.browser')));
    fill(`${L('variableName')} 1`, 'PASSWORD');
    fill(`${L('variableValue')} 1`, 'pw');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('save')) }));

    expect(await screen.findByRole('alert')).toHaveTextContent(L('incomplete'));
    expect(api.save).not.toHaveBeenCalled();

    fill(L('hosts'), 'Admin.Example.com, login.example.com');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('save')) }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          destinations: expect.arrayContaining(['browser']),
          hosts: ['Admin.Example.com', 'login.example.com'],
        })
      )
    );
  });

  it('replaces a set by retyping every value and never shows the stored ones', async () => {
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');

    fireEvent.click(screen.getByRole('button', { name: `${L('edit')}: GitHub login` }));
    expect(screen.getByText(L('retypeHint'))).toBeInTheDocument();
    expect(screen.getByLabelText(`${L('variableName')} 1`)).toHaveValue('USERNAME');
    expect(screen.getByLabelText(`${L('variableValue')} 1`)).toHaveValue('');
    fill(`${L('variableValue')} 1`, 'new-user');
    fill(`${L('variableValue')} 2`, 'new-pass');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('save')) }));

    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: 'secret://session/1',
          variables: [
            { name: 'USERNAME', value: 'new-user' },
            { name: 'PASSWORD', value: 'new-pass' },
          ],
        })
      )
    );
  });

  it('shows what an agent asked for and fulfils it, linking the set to the request', async () => {
    api.list.mockResolvedValue(
      listing({
        sets: [],
        requests: [
          {
            id: 'req-1',
            label: 'Payments sandbox',
            note: 'Needed for the checkout test',
            fields: ['PAYMENTS_API_KEY'],
            destinations: ['process'],
            createdAt: 1,
          },
        ],
      })
    );
    render(<HubSessionSecrets sessionId='conversation-1' active />);

    const request = await screen.findByTestId('hub-secret-request-req-1');
    expect(within(request).getByText('Needed for the checkout test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `${L('fulfil')}: Payments sandbox` }));
    expect(screen.getByLabelText(`${L('variableName')} 1`)).toHaveValue('PAYMENTS_API_KEY');
    fill(`${L('variableValue')} 1`, 'sk-test');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('save')) }));

    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-1',
          label: 'Payments sandbox',
          variables: [{ name: 'PAYMENTS_API_KEY', value: 'sk-test' }],
        })
      )
    );
  });

  it('dismisses an agent request', async () => {
    api.list.mockResolvedValue(
      listing({
        sets: [],
        requests: [{ id: 'req-1', label: 'Payments sandbox', note: 'n', fields: ['K'], destinations: ['process'], createdAt: 1 }],
      })
    );
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-request-req-1');
    fireEvent.click(screen.getByRole('button', { name: `${L('dismiss')}: Payments sandbox` }));
    await waitFor(() => expect(api.dismissRequest).toHaveBeenCalledWith('req-1'));
  });

  it('shows only a generic localized error after a failed save and clears the typed values', async () => {
    api.save.mockResolvedValueOnce({ ok: false, error: 'IO_ERROR' });
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('add')) }));
    fill(L('name'), 'X');
    fill(`${L('variableName')} 1`, 'TOKEN');
    fill(`${L('variableValue')} 1`, 'secret-must-not-appear');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L('save')) }));

    expect(await screen.findByRole('alert')).toHaveTextContent(L('error'));
    expect(screen.getByLabelText(`${L('variableValue')} 1`)).toHaveValue('');
    expect(screen.queryByText('secret-must-not-appear')).toBeNull();
  });

  it('removes a set through Main and stays quiet when the native approval is cancelled', async () => {
    api.remove.mockResolvedValueOnce({ ok: false, error: 'CANCELLED' });
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');

    fireEvent.click(screen.getByRole('button', { name: `${L('remove')}: GitHub login` }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('secret://session/1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reveals one value on request and hides it again', async () => {
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');
    expect(screen.queryByDisplayValue('plain-secret-value')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: `${L('reveal')}: PASSWORD` }));
    expect(await screen.findByDisplayValue('plain-secret-value')).toBeInTheDocument();
    expect(api.reveal).toHaveBeenCalledWith('secret://session/1', 'PASSWORD');

    fireEvent.click(screen.getByRole('button', { name: `${L('hide')}: PASSWORD` }));
    expect(screen.queryByDisplayValue('plain-secret-value')).toBeNull();
  });

  it('does not show a value when the person cancels the native approval', async () => {
    api.reveal.mockResolvedValueOnce({ ok: false, error: 'CANCELLED' });
    render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');

    fireEvent.click(screen.getByRole('button', { name: `${L('reveal')}: PASSWORD` }));
    await waitFor(() => expect(api.reveal).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('plain-secret-value')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drops a revealed value when the conversation changes', async () => {
    const view = render(<HubSessionSecrets sessionId='conversation-1' active />);
    await screen.findByTestId('hub-secret-set-GitHub login');
    fireEvent.click(screen.getByRole('button', { name: `${L('reveal')}: PASSWORD` }));
    await screen.findByDisplayValue('plain-secret-value');

    view.rerender(<HubSessionSecrets sessionId='conversation-2' active />);
    await waitFor(() => expect(factories.session).toHaveBeenCalledWith('conversation-2'));
    expect(screen.queryByDisplayValue('plain-secret-value')).toBeNull();
  });
});

describe('SecretSetsPanel for a company', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(
      listing({ sets: [{ ...mine, scope: 'company', label: 'Acme login' }, shared], keychainAvailable: true })
    );
  });

  it('describes permanent company-only secrets and lists them apart from app sets', async () => {
    const company = {} as SecretSetsApi;
    Object.assign(company, api);
    render(<SecretSetsPanel api={company} scope='company' active />);

    expect(await screen.findByTestId('hub-secret-set-Acme login')).toBeInTheDocument();
    expect(screen.getByTestId('hub-secret-scope-note')).toHaveTextContent(L('usageCompany'));
    expect(screen.getByText(L('sectionCompany'))).toBeInTheDocument();
  });

  it('warns that permanent secrets cannot be saved when the keychain is missing', async () => {
    api.list.mockResolvedValue(listing({ sets: [], keychainAvailable: false }));
    render(<SecretSetsPanel api={api as unknown as SecretSetsApi} scope='company' active />);
    expect(await screen.findByRole('alert')).toHaveTextContent(L('keychainUnavailable'));
    expect(screen.getByText(L('emptyCompany'))).toBeInTheDocument();
  });
});

describe('useSecretSets reveal timer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(listing({ sets: [] }));
    api.reveal.mockResolvedValue({ ok: true, data: 'plain-secret-value' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes a revealed value by itself once the visibility window has passed', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSecretSets(api as unknown as SecretSetsApi, false));

    await act(async () => {
      await result.current.toggleReveal('secret://session/1', 'PASSWORD');
    });
    const values = () => Object.values(result.current.revealed);
    expect(values()).toEqual(['plain-secret-value']);

    act(() => {
      vi.advanceTimersByTime(REVEAL_VISIBLE_MS - 1);
    });
    expect(values()).toEqual(['plain-secret-value']);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(values()).toEqual([]);
  });

  it('forgets every timer when the hook unmounts', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useSecretSets(api as unknown as SecretSetsApi, false));
    await act(async () => {
      await result.current.toggleReveal('secret://session/1', 'PASSWORD');
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
