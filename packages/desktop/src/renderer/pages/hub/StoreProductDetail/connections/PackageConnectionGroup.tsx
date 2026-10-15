/**
 * One kind of a package's connections as a collapsible group. Data kinds (skill, rules, knowledge, ...) are a plain list with
 * no switch: the package switch turns them on. Code-running kinds keep one small switch per row (advanced), their own
 * start-again choice and their own actions. Kinds that cannot run share one note per reason.
 */
import { Button, Checkbox, Switch, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PackageConnectionStatus, PackageConnectionView } from '@/common/types/platform/packageConnections';
import { kindLabel, type ConnectionGroup } from './packageConnectionGroups';

const K = 'guid.hubHome.connections.';

/** What a row can ask Main to do. Every request is checked by Main; the rows only send keys and choices. */
export type ConnectionRowActions = Readonly<{
  /** Key of the connection with a request in flight, or the package-level busy marker; every control waits meanwhile. */
  busy: string | undefined;
  onSwitch: (item: PackageConnectionView, on: boolean) => void;
  onAutoStart: (key: string, autoStart: boolean) => void;
  onLauncher: (key: string, action: 'link' | 'open' | 'download') => void;
  onSecrets?: () => void;
  onOpenSkill?: (skillKey: string) => void;
}>;

type Props = Readonly<{
  group: ConnectionGroup;
  open: boolean;
  onToggle: () => void;
  actions: ConnectionRowActions;
}>;

const statusColor = (status: PackageConnectionStatus): string | undefined => {
  if (status === 'on') return 'green';
  if (status === 'error') return 'red';
  if (status === 'needs-input') return 'orange';
  return undefined;
};

export const PackageConnectionGroup: React.FC<Props> = ({ group, open, onToggle, actions }) => {
  const { t } = useTranslation();
  const anyBusy = actions.busy !== undefined;
  const bodyId = `package-group-${group.kind}-body`;
  const openSkill = actions.onOpenSkill;

  const renderDataRow = (item: PackageConnectionView) => (
    <div
      key={item.key}
      className='hub-package-connection-row hub-package-connection-plain'
      data-testid={`package-connection-${item.key}`}
    >
      <div className='hub-package-connection-info'>
        <div className='hub-package-connection-meta'>
          <strong>{item.title}</strong>
          <Tag color={statusColor(item.status)}>{t(K + 'status.' + item.status)}</Tag>
        </div>
        {item.description && <p>{item.description}</p>}
        {item.reason && <p role='status'>{item.reason}</p>}
        {item.lastError && <p role='alert'>{item.lastError}</p>}
      </div>
      {item.kind === 'skill' && openSkill ? (
        <div className='hub-package-connection-actions'>
          <Button size='small' onClick={() => openSkill(item.key)}>
            {t(K + 'openSkill')}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const renderCodeRow = (item: PackageConnectionView) => {
    const switchLocked = anyBusy || (!item.enabled && (item.status === 'unsupported' || item.status === 'needs-input'));
    return (
      <div key={item.key} className='hub-package-connection-row' data-testid={`package-connection-${item.key}`}>
        <div className='hub-package-connection-info'>
          <div className='hub-package-connection-meta'>
            <strong>{item.title}</strong>
            <Tag color={statusColor(item.status)}>{t(K + 'status.' + item.status)}</Tag>
          </div>
          {item.description && <p>{item.description}</p>}
          {item.reason && <p role='status'>{item.reason}</p>}
          {item.lastError && <p role='alert'>{item.lastError}</p>}
          {item.group && <small>{t(K + 'alternative', { group: item.group })}</small>}
          <div>
            <Checkbox
              checked={item.autoStart === true}
              disabled={anyBusy}
              onChange={(checked: boolean) => actions.onAutoStart(item.key, checked)}
              data-testid={`package-connection-autostart-${item.key}`}
            >
              {t(K + 'autoStart')}
            </Checkbox>
            <small>{t(K + 'autoStartHint')}</small>
          </div>
          {item.requiredEnv?.length ? (
            <div className='hub-package-connection-env'>
              <span>{t(K + 'requiredEnv')}:</span>{' '}
              {item.requiredEnv.map((name) => (
                <code key={name}>{name}</code>
              ))}
            </div>
          ) : null}
        </div>
        <div className='hub-package-connection-actions'>
          {item.kind === 'launcher' && item.status === 'needs-input' ? (
            <>
              <Button
                size='small'
                loading={actions.busy === item.key}
                disabled={anyBusy}
                onClick={() => actions.onLauncher(item.key, 'link')}
              >
                {t(K + 'chooseExecutable')}
              </Button>
              <Button size='small' disabled={anyBusy} onClick={() => actions.onLauncher(item.key, 'download')}>
                {t(K + 'downloadApp')}
              </Button>
            </>
          ) : null}
          {item.kind === 'launcher' && item.enabled ? (
            <Button
              type='primary'
              size='small'
              loading={actions.busy === item.key}
              disabled={anyBusy}
              onClick={() => actions.onLauncher(item.key, 'open')}
            >
              {t(K + 'openApp')}
            </Button>
          ) : null}
          {item.status === 'needs-input' && actions.onSecrets && item.requiredEnv?.length ? (
            <Button size='small' onClick={actions.onSecrets}>
              {t(K + 'fillSecret')}
            </Button>
          ) : null}
          <Switch
            size='small'
            checked={item.enabled}
            loading={actions.busy === item.key}
            disabled={switchLocked}
            aria-label={t(K + 'switchRow', { title: item.title })}
            onChange={(checked: boolean) => actions.onSwitch(item, checked)}
          />
        </div>
      </div>
    );
  };

  return (
    <section className='hub-package-connection-group' data-testid={`package-group-${group.kind}`}>
      <button
        type='button'
        className='hub-package-connection-group-toggle'
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <strong>{kindLabel(group.kind)}</strong>
        <span>{group.items.length}</span>
        <small>{t(K + 'groupCount', { on: group.enabledCount, total: group.items.length })}</small>
        <span aria-hidden='true'>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div id={bodyId} className='hub-package-connection-group-body'>
          {group.blocked.map((note) => {
            const reason = note.reason || t(K + 'unsupportedDefault');
            return (
              <p key={note.reason} role='status' className='hub-package-connection-note'>
                {t(K + 'cannotRun', { count: note.items.length, reason })}{' '}
                <small>{note.items.map((item) => item.title).join(' · ')}</small>
              </p>
            );
          })}
          {group.rows.map((item) => (item.runsCode ? renderCodeRow(item) : renderDataRow(item)))}
        </div>
      ) : null}
    </section>
  );
};
