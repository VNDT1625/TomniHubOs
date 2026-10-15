/**
 * Package-owned connection controls as one cluster (docs/platform/repotopackage-design.md section 9.4, "Giao diện theo cụm").
 * The package switch is a shortcut and each connection keeps its own control. Every toggle is pinned to the approvalHash;
 * Main also confirms native executable connections, and the package switch asks once for all of them.
 */
import { Alert, Button, Card, Checkbox, Modal, Spin, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackageConnectionApproval, PackageConnectionView } from '@/common/types/platform/packageConnections';
import { PackageConnectionGroup } from './PackageConnectionGroup';
import { groupByKind, kindSummary } from './packageConnectionGroups';

type Props = Readonly<{
  packageId: string;
  onSecrets?: () => void;
  /** Opens a skill's content. Optional: without it, skill rows show no "View" action. */
  onOpenSkill?: (skillKey: string) => void;
}>;
type Pending = Readonly<{ key: string; detail: PackageConnectionApproval }>;
const K = 'guid.hubHome.connections.';
/** Busy marker of the package-level controls; no connection has this key. */
const PACKAGE_BUSY = '*';

export const PackageConnectionsSection: React.FC<Props> = ({ packageId, onSecrets, onOpenSkill }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<PackageConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [approval, setApproval] = useState<Pending>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [revision, setRevision] = useState(0);
  /** A person's open or closed choice per kind; without one, a group opens only when something is off and says why. */
  const [openChoice, setOpenChoice] = useState<Record<string, boolean>>({});

  const load = useCallback(async (): Promise<void> => {
    const api = window.electronAPI?.packageConnections;
    if (!api) {
      setError(t(K + 'unavailable'));
      setLoading(false);
      return;
    }
    try {
      const result = await api.list({ packageId });
      if (result.ok === true) setItems(result.data);
      else setError(t(K + 'failed', { code: result.error }));
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      setLoading(false);
    }
  }, [packageId, t]);
  useEffect(() => {
    let active = true;
    const fetch = async () => {
      if (active) await load();
    };
    void fetch();
    const onFocus = () => {
      if (active) void fetch();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('tomni-packages-changed', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('tomni-packages-changed', onFocus);
    };
  }, [load, revision]);

  const groups = useMemo(() => groupByKind(items), [items]);
  const codeItems = useMemo(() => items.filter((item) => item.runsCode), [items]);
  const enabledCount = items.filter((item) => item.enabled).length;
  // A kind opens by itself the first time it appears, when something is off and says why. After that it stays as the
  // person left it, so a group does not close under them when its last problem is solved.
  useEffect(() => {
    setOpenChoice((choices) => {
      const missing = groups.filter((group) => !(group.kind in choices));
      if (missing.length === 0) return choices;
      return { ...choices, ...Object.fromEntries(missing.map((group) => [group.kind, group.needsAttention])) };
    });
  }, [groups]);

  const inspect = async (key: string) => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setBusy(key);
    setError(undefined);
    try {
      const result = await api.describe({ packageId, connectionKey: key });
      if (result.ok === true) setApproval({ key, detail: result.data });
      else setError(t(K + 'failed', { code: result.error }));
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      setBusy(undefined);
    }
  };
  const launcherAction = async (key: string, action: 'link' | 'open' | 'download') => {
    const api = window.electronAPI?.launcher;
    if (!api) {
      setError(t(K + 'unavailable'));
      return;
    }
    setBusy(key);
    setError(undefined);
    try {
      const connectionId = key.slice('launcher:'.length);
      const result = await api[action]({ packageId, connectionId });
      if (result.ok === false && result.error !== 'CANCELLED') setError(t(K + 'failed', { code: result.error }));
      setRevision((value) => value + 1);
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      setBusy(undefined);
    }
  };
  /** Chooses whether a code-running connection starts again at the next launch. Main checks the approval then, not now. */
  const setAutoStart = async (key: string, autoStart: boolean) => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setBusy(key);
    setError(undefined);
    try {
      const result = await api.setAutoStart({ packageId, connectionKey: key, autoStart });
      if (result.ok === false) setError(t(K + 'failed', { code: result.error }));
      setRevision((value) => value + 1);
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      setBusy(undefined);
    }
  };
  /** The package-level start-again choice: applied to every code-running connection of the package. */
  const setAllAutoStart = async (autoStart: boolean) => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setBusy(PACKAGE_BUSY);
    setError(undefined);
    try {
      const results = await Promise.all(
        codeItems.map((item) => api.setAutoStart({ packageId, connectionKey: item.key, autoStart }))
      );
      const failed = results.find((result) => result.ok === false);
      if (failed && failed.ok === false) setError(t(K + 'failed', { code: failed.error }));
      setRevision((value) => value + 1);
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      setBusy(undefined);
    }
  };
  /** The package master switch: one native confirmation for the code-running connections when turning it on. */
  const setPackageEnabled = async (enabled: boolean) => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setBusy(PACKAGE_BUSY);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await api.setPackageEnabled({ packageId, enabled });
      if (result.ok === false) setError(t(K + 'failed', { code: result.error }));
      else if (enabled && result.data.stayedOff.length > 0)
        setNotice(t(K + 'stayedOff', { count: result.data.stayedOff.length }));
      setRevision((value) => value + 1);
    } catch {
      setError(t(K + 'unavailable'));
    } finally {
      setBusy(undefined);
    }
  };
  const toggle = async (key: string, hash?: string) => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return;
    setBusy(key);
    setError(undefined);
    try {
      const result = hash
        ? await api.enable({ packageId, connectionKey: key, approvalHash: hash })
        : await api.disable({ packageId, connectionKey: key });
      if (result.ok === false) setError(t(K + 'failed', { code: result.error }));
      setApproval(undefined);
      setRevision((value) => value + 1);
    } catch {
      setApproval(undefined);
      setError(t(K + 'unavailable'));
    } finally {
      setBusy(undefined);
    }
  };
  /** A code-running row: switching on shows Main's description first; switching off needs no review. */
  const switchRow = (item: PackageConnectionView, on: boolean) => {
    if (on) void inspect(item.key);
    else void toggle(item.key);
  };

  return (
    <Card className='hub-package-connections' bordered data-testid='store-package-connections'>
      <div className='hub-package-connections-heading'>
        <div>
          <h3>{t(K + 'title')}</h3>
          <p>{t(K + 'hint')}</p>
        </div>
        <Button
          size='small'
          type='secondary'
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          {t('common.refresh')}
        </Button>
      </div>
      {error && <Alert type='error' content={error} closable onClose={() => setError(undefined)} />}
      {notice && <Alert type='info' content={notice} closable onClose={() => setNotice(undefined)} />}
      {loading ? (
        <Spin aria-label={t('common.loading')} />
      ) : items.length === 0 ? (
        <p>{t(K + 'empty')}</p>
      ) : (
        <>
          <div className='hub-package-connections-master' data-testid='package-master'>
            <div className='hub-package-connections-master-main'>
              <Switch
                checked={enabledCount > 0}
                loading={busy === PACKAGE_BUSY}
                disabled={busy !== undefined}
                aria-label={t(K + 'masterSwitch')}
                data-testid='package-master-switch'
                onChange={(checked: boolean) => void setPackageEnabled(checked)}
              />
              <div className='hub-package-connections-master-text'>
                <strong>{t(K + 'masterSwitch')}</strong>
                <p data-testid='package-summary'>{kindSummary(groups)}</p>
                <small>{t(K + 'counts', { on: enabledCount, off: items.length - enabledCount })}</small>
              </div>
            </div>
            <small>{t(K + 'masterHint')}</small>
            {codeItems.length > 0 ? (
              <Checkbox
                checked={codeItems.every((item) => item.autoStart === true)}
                disabled={busy !== undefined}
                onChange={(checked: boolean) => void setAllAutoStart(checked)}
                data-testid='package-master-autostart'
              >
                {t(K + 'masterAutoStart')}
              </Checkbox>
            ) : null}
          </div>
          {groups.map((group) => (
            <PackageConnectionGroup
              key={group.kind}
              group={group}
              open={openChoice[group.kind] ?? group.needsAttention}
              onToggle={() =>
                setOpenChoice((choices) => ({
                  ...choices,
                  [group.kind]: !(choices[group.kind] ?? group.needsAttention),
                }))
              }
              actions={{
                busy,
                onSwitch: switchRow,
                onAutoStart: (key, autoStart) => void setAutoStart(key, autoStart),
                onLauncher: (key, action) => void launcherAction(key, action),
                ...(onSecrets ? { onSecrets } : {}),
                ...(onOpenSkill ? { onOpenSkill } : {}),
              }}
            />
          ))}
        </>
      )}
      <Modal
        title={t(K + 'approvalTitle')}
        visible={approval !== undefined}
        onCancel={() => {
          if (!busy) setApproval(undefined);
        }}
        onOk={() => {
          if (approval) void toggle(approval.key, approval.detail.approvalHash);
        }}
        confirmLoading={Boolean(busy)}
        maskClosable={false}
        closable={!busy}
        okText={t(K + 'confirm')}
        cancelText={t('common.cancel')}
        data-testid='package-connection-approval'
      >
        {approval && (
          <div className='hub-package-connection-approval'>
            <strong>{approval.detail.title}</strong>
            <p>{t(K + 'reviewHint')}</p>
            <dl>
              {approval.detail.lines.map((line, index) => (
                <div key={index}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
            {approval.detail.files.length > 0 && (
              <section>
                <h4>{t(K + 'files')}</h4>
                {approval.detail.files.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </section>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
};
