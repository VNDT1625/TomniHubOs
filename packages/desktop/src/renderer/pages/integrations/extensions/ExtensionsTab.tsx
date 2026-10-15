/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Store → tab "Tiện ích" (design S2, T4.6): lists the browser extensions of installed packages and turns them on or
 * off through the connection IPC. Turning on runs through the approval Main owns (describe → approvalHash → enable,
 * with a native dialog for code). A loaded extension also gets its pin, site access level and removal, which Main
 * stores and checks.
 */
import { Alert, Button, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SiteAccessMode } from '@/common/integrations/extensions/siteAccess';
import type { ExtensionStripItem } from '@/common/integrations/extensions/stripContract';
import type { PackageConnectionView } from '@/common/types/platform/packageConnections';
import { useExtensionStrip } from '@/renderer/components/layout/Titlebar/extensions/useExtensionStrip';

const K = 'guid.hubHome.storeImport.ext.';
const EXTENSION_KEY_PREFIX = 'extension:';
const SITE_MODES: readonly SiteAccessMode[] = ['on-click', 'on-site', 'all-sites'];

export type ExtensionRow = Readonly<{ packageId: string; view: PackageConnectionView }>;
export type ExtensionsTabProps = Readonly<{ packageIds: readonly string[] }>;

/** The Store view a path names: `/store/extensions` is the Extensions tab; everything else is the Packages view. */
export const storeViewForPath = (pathname: string): 'packages' | 'extensions' =>
  pathname.replace(/\/+$/u, '') === '/store/extensions' ? 'extensions' : 'packages';

/** The loaded extension of a connection row, if the extension host has it loaded now. */
const loadedItemOf = (items: readonly ExtensionStripItem[], row: ExtensionRow): ExtensionStripItem | undefined =>
  items.find(
    (item) => item.packageId === row.packageId && `${EXTENSION_KEY_PREFIX}${item.connectionId}` === row.view.key
  );

export const ExtensionsTab: React.FC<ExtensionsTabProps> = ({ packageIds }) => {
  const { t } = useTranslation();
  const strip = useExtensionStrip();
  const [rows, setRows] = useState<ExtensionRow[]>([]);
  const [error, setError] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();

  const modeLabel = (mode: SiteAccessMode): string => {
    if (mode === 'on-site') return t('browser.extensionStrip.siteOnSite');
    if (mode === 'all-sites') return t('browser.extensionStrip.siteAllSites');
    return t('browser.extensionStrip.siteOnClick');
  };

  const load = useCallback(async () => {
    const api = window.electronAPI?.packageConnections;
    if (!api) {
      setError(t(K + 'unavailable'));
      return;
    }
    const next: ExtensionRow[] = [];
    for (const packageId of packageIds) {
      // oxlint-disable-next-line no-await-in-loop -- a few installed packages; one IPC call at a time.
      const response = await api.list({ packageId });
      if (response.ok) {
        for (const view of response.data) {
          if (view.kind === 'extension') next.push({ packageId, view });
        }
      }
    }
    setRows(next);
  }, [packageIds, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (row: ExtensionRow): Promise<void> => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setBusyKey(row.view.key);
    setError(undefined);
    try {
      if (row.view.enabled) {
        await api.disable({ packageId: row.packageId, connectionKey: row.view.key });
      } else {
        const described = await api.describe({ packageId: row.packageId, connectionKey: row.view.key });
        if (described.ok === false) {
          setError(t(K + 'errorCode', { code: described.error }));
          return;
        }
        const enabled = await api.enable({
          packageId: row.packageId,
          connectionKey: row.view.key,
          approvalHash: described.data.approvalHash,
        });
        if (enabled.ok === false) setError(t(K + 'errorCode', { code: enabled.error }));
      }
      await load();
      await strip.refresh();
    } finally {
      setBusyKey(undefined);
    }
  };

  const removeRow = async (row: ExtensionRow): Promise<void> => {
    setBusyKey(row.view.key);
    try {
      await strip.uninstall(row.packageId);
      await load();
    } finally {
      setBusyKey(undefined);
    }
  };

  if (rows.length === 0) return <div className='hub-extensions-empty'>{t(K + 'empty')}</div>;

  return (
    <section className='hub-extensions-tab' data-testid='extensions-tab'>
      {error && <Alert type='error' content={error} closable onClose={() => setError(undefined)} />}
      {strip.actionFailed && <Alert type='error' content={t('browser.extensionStrip.actionFailed')} closable />}
      <ul className='hub-extensions-list'>
        {rows.map((row) => {
          const { packageId, view } = row;
          const item = loadedItemOf(strip.items, row);
          return (
            <li
              key={`${packageId}:${view.key}`}
              className='hub-extensions-row'
              data-testid={`extension-row-${view.key}`}
            >
              <div className='hub-extensions-head'>
                <strong>{view.title}</strong>
                <Tag color={view.enabled ? 'green' : 'gray'}>{view.enabled ? t(K + 'on') : t(K + 'off')}</Tag>
                {view.format && <Tag>{view.format}</Tag>}
              </div>
              <div className='hub-extensions-meta'>
                <span>{packageId}</span>
                {view.reason && <span className='hub-extensions-reason'>{view.reason}</span>}
                {view.lastError && <span className='hub-extensions-error'>{view.lastError}</span>}
              </div>
              <div className='hub-extensions-actions'>
                <Button size='small' loading={busyKey === view.key} onClick={() => void toggle(row)}>
                  {view.enabled ? t(K + 'turnOff') : t(K + 'turnOn')}
                </Button>
                {item !== undefined && (
                  <>
                    <Button
                      size='small'
                      type={item.pinned ? 'primary' : 'secondary'}
                      aria-pressed={item.pinned}
                      data-testid={`extension-pin-${view.key}`}
                      onClick={() => void strip.togglePin(item.id)}
                    >
                      {item.pinned ? t('browser.extensionStrip.unpin') : t('browser.extensionStrip.pin')}
                    </Button>
                    <span className='hub-extensions-site-label'>{t('browser.extensionStrip.siteAccess')}</span>
                    {SITE_MODES.map((mode) => (
                      <Button
                        key={mode}
                        size='small'
                        type={item.siteAccess === mode ? 'primary' : 'secondary'}
                        aria-pressed={item.siteAccess === mode}
                        data-testid={`extension-site-${mode}-${view.key}`}
                        onClick={() => void strip.setSiteAccess(item.id, mode)}
                      >
                        {modeLabel(mode)}
                      </Button>
                    ))}
                  </>
                )}
                <Button
                  size='small'
                  status='danger'
                  loading={busyKey === view.key}
                  data-testid={`extension-remove-${view.key}`}
                  onClick={() => void removeRow(row)}
                >
                  {t('browser.extensionStrip.uninstall')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
