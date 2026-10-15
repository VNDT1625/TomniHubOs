import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageListing } from '@/common/packages';

const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  session: {
    expires_at: Date.now() + 60_000,
    access_token: 'fixture-access',
    user: { id: 'fixture-user' },
  },
}));

vi.mock('@/renderer/services/supabaseAuth', () => ({
  getSupabaseConfig: () => ({ url: 'https://example.supabase.co', anonKey: 'fixture-publishable' }),
  getStoredSupabaseSession: () => mock.session,
  fetchWithTimeout: mock.fetch,
}));

import {
  loadCloudPackageLibrary,
  syncCompletedPackageMutation,
} from '@/renderer/pages/hub/cloudPackageLibrary';

const listing = (trust: PackageListing['trust'] = 'signed-store'): PackageListing => {
  const manifest = { id: 'org.example.notes', name: 'Notes', type: 'app', version: '1.0.0' } as PackageListing['manifest'];
  return {
    manifest,
    installedManifest: manifest,
    delivery: 'downloaded-package',
    trust,
    installedTrust: trust,
    state: 'installed',
    enabled: true,
    compatible: true,
    updateAvailable: false,
  };
};

describe('Store package library PostgREST contract', () => {
  beforeEach(() => {
    mock.fetch.mockReset();
    mock.session.expires_at = Date.now() + 60_000;
    mock.fetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('upserts only ID, name and current authenticated account after verified installation', async () => {
    await syncCompletedPackageMutation('install', listing());
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mock.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/v1/user_package_library?on_conflict=user_id,package_id');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual([{
      user_id: 'fixture-user',
      package_id: 'org.example.notes',
      name: 'Notes',
    }]);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-access' });
  });

  it('never uploads or deletes local Repo-to-Package entries', async () => {
    await syncCompletedPackageMutation('install', listing('local-built'));
    await syncCompletedPackageMutation('uninstall', listing('local-built'));
        await syncCompletedPackageMutation('install', listing('unsigned-revoked'));
    await syncCompletedPackageMutation('install', { ...listing(), revoked: true });
    await syncCompletedPackageMutation('install', listing('trusted-first-party'));
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('deletes a signed Store package name entry only after local uninstall succeeds', async () => {
    await syncCompletedPackageMutation('uninstall', listing());
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mock.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(url).toContain('user_id=eq.fixture-user');
    expect(url).toContain('package_id=eq.org.example.notes');
    expect(init.body).toBeUndefined();
  });

    it('persists failed signed mutations and retries them after reconnect without duplicate writes', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    try {
      mock.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
      await expect(syncCompletedPackageMutation('install', listing())).rejects.toThrow('CLOUD_PACKAGE_HTTP_503');
      const key = 'tomni.hub.cloud-package-outbox.fixture-user';
      const queued = JSON.parse(values.get(key) ?? '[]') as unknown[];
      expect(queued).toEqual([{ action: 'install', package_id: 'org.example.notes', name: 'Notes' }]);
      expect(values.get(key)).not.toContain('fixture-access');

      const { flushCloudPackageOutbox } = await import('@/renderer/pages/hub/cloudPackageLibrary');
      await flushCloudPackageOutbox('fixture-user');
      expect(values.has(key)).toBe(false);
      expect(mock.fetch).toHaveBeenCalledTimes(2);
      await flushCloudPackageOutbox('fixture-user');
      expect(mock.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('coalesces offline install/uninstall and never replays another account\'s queue', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    try {
      mock.fetch.mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 });
      await expect(syncCompletedPackageMutation('install', listing())).rejects.toThrow();
      await expect(syncCompletedPackageMutation('uninstall', listing())).rejects.toThrow();
      const key = 'tomni.hub.cloud-package-outbox.fixture-user';
      expect(JSON.parse(values.get(key) ?? '[]')).toEqual([
        { action: 'uninstall', package_id: 'org.example.notes', name: 'Notes' },
      ]);
      const { flushCloudPackageOutbox } = await import('@/renderer/pages/hub/cloudPackageLibrary');
      mock.session.user.id = 'other-user';
      await flushCloudPackageOutbox('fixture-user');
      expect(mock.fetch).toHaveBeenCalledTimes(2);
      expect(values.has(key)).toBe(true);
      mock.session.user.id = 'fixture-user';
      await flushCloudPackageOutbox('fixture-user');
      expect(mock.fetch).toHaveBeenCalledTimes(3);
      const [, lastRequest] = mock.fetch.mock.calls[2] as [string, RequestInit];
      expect(lastRequest.method).toBe('DELETE');
      expect(values.has(key)).toBe(false);
    } finally {
      mock.session.user.id = 'fixture-user';
      vi.unstubAllGlobals();
    }
  });

  it('does not misinterpret cloud failures as a new account', async () => {
    mock.fetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await loadCloudPackageLibrary('fixture-user')).toEqual({
      ok: false, reason: 'service-unavailable',
    });
    expect(await loadCloudPackageLibrary('another-account')).toEqual({
      ok: false, reason: 'not-signed-in',
    });
  });
});
