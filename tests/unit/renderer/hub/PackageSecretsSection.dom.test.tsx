import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sets = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  reveal: vi.fn(),
  dismissRequest: vi.fn(),
  legacyStatus: vi.fn(),
  legacyImport: vi.fn(),
}));
const access = vi.hoisted(() => ({
  overview: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@/renderer/services/secretSetsClient', () => ({
  packageSecretSets: () => ({
    list: sets.list,
    save: sets.save,
    remove: sets.remove,
    reveal: sets.reveal,
    dismissRequest: sets.dismissRequest,
    legacy: { status: sets.legacyStatus, import: sets.legacyImport },
  }),
  packageSecretAccess: () => access,
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'reason' in options ? `${key}|${String(options.reason)}` : key,
  }),
}));

import { Message } from '@arco-design/web-react';
import { PackageSecretsSection } from '@/renderer/pages/hub/StoreProductDetail/PackageSecretsSection';

const L = (name: string) => `guid.hubHome.secrets.${name}`;
const own = {
  handle: 'secret://set-1',
  label: 'Deploy login',
  fields: ['USER', 'TOKEN'],
  scope: 'package',
  destinations: ['process'],
  updatedAt: 1,
};
const overview = {
  granted: [
    { handle: 'secret://app-1', label: 'GitHub token', fields: ['GH_TOKEN'], destinations: ['process'], grantedAt: 1 },
  ],
  pending: [
    {
      id: 'req-1',
      handle: 'secret://app-2',
      label: 'npm token',
      fields: ['NPM_TOKEN'],
      reason: 'Publish the build',
      createdAt: 1,
    },
  ],
  available: [{ handle: 'secret://app-3', label: 'AWS key', fields: ['AWS_KEY'], destinations: ['process'] }],
};

describe("a Package App's secrets in the Store", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    sets.list.mockResolvedValue({ ok: true, data: { sets: [own], requests: [], keychainAvailable: true } });
    sets.legacyStatus.mockResolvedValue({ ok: true, data: { pending: 0 } });
    access.overview.mockResolvedValue({ ok: true, data: overview });
    access.approve.mockResolvedValue({ ok: true, data: true });
    access.deny.mockResolvedValue({ ok: true, data: true });
    access.grant.mockResolvedValue({ ok: true, data: true });
    access.revoke.mockResolvedValue({ ok: true, data: true });
  });

  it('shows required environment names and pre-fills only field names in a package secret form', async () => {
    const list = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          key: 'agent:reviewer',
          kind: 'agent',
          title: 'Reviewer',
          status: 'needs-input',
          enabled: false,
          requiredEnv: ['SERVICE_API_KEY', 'SERVICE_REGION'],
        },
      ],
    });
    vi.stubGlobal('electronAPI', { packageConnections: { list } });
    render(<PackageSecretsSection packageId='com.tomni.ide' />);
    const required = await screen.findByTestId('package-required-environment');
    expect(required).toHaveTextContent('SERVICE_API_KEY');
    expect(required).toHaveTextContent('SERVICE_REGION');
    expect(required).not.toHaveTextContent('any-secret-value');
    fireEvent.click(screen.getByRole('button', { name: L('add') }));
    const fields = screen.getAllByPlaceholderText(L('variableName')) as HTMLInputElement[];
    expect(fields.map((field) => field.value)).toEqual(['SERVICE_API_KEY', 'SERVICE_REGION']);
    expect(list).toHaveBeenCalledWith({ packageId: 'com.tomni.ide' });
  });

  it("shows the package's own keys, its granted keys and what it asked for, without any value", async () => {
    render(<PackageSecretsSection packageId='com.tomni.ide' />);

    expect(await screen.findByText('Deploy login')).toBeInTheDocument();
    expect(screen.getByText(L('titlePackage'))).toBeInTheDocument();
    expect(await screen.findByTestId('package-access-granted-GitHub token')).toBeInTheDocument();
    expect(screen.getByTestId('package-access-request-req-1')).toHaveTextContent('npm token');
    expect(screen.getByTestId('package-access-request-req-1')).toHaveTextContent(
      `${L('accessReason')}|Publish the build`
    );
    expect(screen.getByTestId('package-access-available-AWS key')).toBeInTheDocument();
  });

  it("approves, denies, grants and revokes through the person's own controls", async () => {
    render(<PackageSecretsSection packageId='com.tomni.ide' />);
    await screen.findByTestId('package-access-request-req-1');

    fireEvent.click(screen.getByRole('button', { name: `${L('accessApprove')}: npm token` }));
    await waitFor(() => expect(access.approve).toHaveBeenCalledWith('req-1'));
    fireEvent.click(await screen.findByRole('button', { name: `${L('accessDeny')}: npm token` }));
    await waitFor(() => expect(access.deny).toHaveBeenCalledWith('req-1'));
    fireEvent.click(screen.getByRole('button', { name: `${L('accessGrant')}: AWS key` }));
    await waitFor(() => expect(access.grant).toHaveBeenCalledWith('secret://app-3'));
    fireEvent.click(screen.getByRole('button', { name: `${L('accessRevoke')}: GitHub token` }));
    await waitFor(() => expect(access.revoke).toHaveBeenCalledWith('secret://app-1'));
  });

  it('reports a grant that did not take effect as a failure, not as success', async () => {
    access.approve.mockResolvedValue({ ok: true, data: false });
    render(<PackageSecretsSection packageId='com.tomni.ide' />);

    fireEvent.click(await screen.findByRole('button', { name: `${L('accessApprove')}: npm token` }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(L('error')));
    expect(Message.success).not.toHaveBeenCalledWith(L('accessSaved'));
  });

  it('offers the older keys for import only when some are not in the app vault yet', async () => {
    const { unmount } = render(<PackageSecretsSection packageId='com.tomni.ide' />);
    await screen.findByText('Deploy login');
    expect(screen.queryByText(L('legacyImport'))).toBeNull();
    unmount();

    sets.legacyStatus.mockResolvedValue({ ok: true, data: { pending: 3 } });
    sets.legacyImport.mockResolvedValue({ ok: true, data: { imported: 3, existing: 0, skipped: 0, failed: 0 } });
    render(<PackageSecretsSection packageId='com.tomni.ide' />);

    fireEvent.click(await screen.findByRole('button', { name: L('legacyImport') }));
    await waitFor(() => expect(sets.legacyImport).toHaveBeenCalledTimes(1));
  });
});
