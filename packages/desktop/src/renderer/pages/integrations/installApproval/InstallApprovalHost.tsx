/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The in-app approval of the code-running connections of a package that was just installed (docs/platform/
 * repotopackage-design.md section 9.4). Main sends one request to the main window; this host shows the oldest one and
 * answers with its request id and the exact keys Main sent. The start-again question (prompt `start-again`) also offers
 * "do not ask again" and hides the start-again switch. Cancel is the default focus, Escape cancels, and Tab stays
 * inside the dialog. Groups are collapsed by default; the host text of each line is shown as Main received it.
 *
 * The host is mounted at the app root, outside the Home shell, so it carries its own token scope (`.tomny-approval`)
 * in tomni-ui.css instead of relying on the Home `--g-*` tokens.
 */

import type {
  InstallApprovalField,
  InstallApprovalGroup,
  InstallApprovalGroupKind,
  InstallApprovalRequest,
  InstallApprovalRisk,
} from '@/common/types/platform/packageConnections';
import { Switch } from '@arco-design/web-react';
import { Attention, Caution, Down, Link, PlugOne, Shield, Terminal } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Translate = TFunction;

const FOCUSABLE = 'button, input, summary, select, textarea, [tabindex]:not([tabindex="-1"])';
const CODE_FIELDS: ReadonlySet<InstallApprovalField['id']> = new Set(['command', 'folder', 'setup', 'env', 'url']);

const countOf = (groups: readonly InstallApprovalGroup[], kind: InstallApprovalGroup['kind']): number =>
  groups.filter((group) => group.kind === kind).reduce((total, group) => total + group.count, 0);

/** One sentence of what the package wants to run, e.g. "1 chương trình MCP, 14 hook và 1 lệnh CLI". */
const summaryOf = (groups: readonly InstallApprovalGroup[], t: Translate): string => {
  const parts: string[] = [];
  const mcp = countOf(groups, 'mcp');
  const hook = countOf(groups, 'hook');
  const cli = countOf(groups, 'cli');
  const other = countOf(groups, 'other');
  if (mcp > 0) parts.push(t('guid.hubHome.installApproval.summary.mcp', { count: mcp }));
  if (hook > 0) parts.push(t('guid.hubHome.installApproval.summary.hook', { count: hook }));
  if (cli > 0) parts.push(t('guid.hubHome.installApproval.summary.cli', { count: cli }));
  if (other > 0) parts.push(t('guid.hubHome.installApproval.summary.other', { count: other }));
  if (parts.length <= 1) return parts.join('');
  const head = parts.slice(0, -1).join(t('guid.hubHome.installApproval.summary.join'));
  return `${head}${t('guid.hubHome.installApproval.summary.and')}${parts[parts.length - 1] ?? ''}`;
};

const fieldLabelOf = (field: InstallApprovalField, t: Translate): string => {
  switch (field.id) {
    case 'command':
      return t('guid.hubHome.installApproval.field.command');
    case 'folder':
      return t('guid.hubHome.installApproval.field.folder');
    case 'setup':
      return t('guid.hubHome.installApproval.field.setup');
    case 'env':
      return t('guid.hubHome.installApproval.field.env');
    case 'network':
      return t('guid.hubHome.installApproval.field.network');
    case 'url':
      return t('guid.hubHome.installApproval.field.url');
    case 'other':
      return field.label;
  }
};

const groupLabelOf = (group: InstallApprovalGroup, t: Translate): string => {
  switch (group.kind) {
    case 'mcp':
      return t('guid.hubHome.installApproval.kind.mcp');
    case 'hook':
      return t('guid.hubHome.installApproval.kind.hook');
    case 'cli':
      return t('guid.hubHome.installApproval.kind.cli');
    case 'other':
      return `${t('guid.hubHome.installApproval.kind.other')} · ${group.kindName}`;
  }
};

const riskTextOf = (risk: InstallApprovalRisk, t: Translate): string =>
  risk === 'setup-install'
    ? t('guid.hubHome.installApproval.risk.setupInstall')
    : t('guid.hubHome.installApproval.risk.networkOpen');

/** Decorative icon of a group kind; the text label next to it carries the meaning. */
const KindIcon: React.FC<{ kind: InstallApprovalGroupKind }> = ({ kind }) => {
  switch (kind) {
    case 'mcp':
      return <PlugOne size={16} strokeWidth={3} />;
    case 'hook':
      return <Link size={16} strokeWidth={3} />;
    case 'cli':
      return <Terminal size={16} strokeWidth={3} />;
    case 'other':
      return <Attention size={16} strokeWidth={3} />;
  }
};

const FieldLine: React.FC<{ field: InstallApprovalField; t: Translate }> = ({ field, t }) => (
  <div className='tomny-approval__field'>
    <span className='tomny-approval__field-label'>{fieldLabelOf(field, t)}</span>
    {CODE_FIELDS.has(field.id) ? (
      <code className='tomny-approval__code'>{field.value}</code>
    ) : (
      <span className='tomny-approval__text'>{field.value}</span>
    )}
  </div>
);

const GroupView: React.FC<{ group: InstallApprovalGroup; t: Translate }> = ({ group, t }) => (
  <details className='tomny-approval__group'>
    <summary className='tomny-approval__group-summary'>
      <span className='tomny-approval__kind-icon' aria-hidden='true'>
        <KindIcon kind={group.kind} />
      </span>
      <span className='tomny-approval__group-title'>{groupLabelOf(group, t)}</span>
      {group.risks.length > 0 && (
        <span className='tomny-approval__warn-icon' aria-hidden='true'>
          <Caution size={14} strokeWidth={3} />
        </span>
      )}
      <span className='tomny-approval__count'>{group.count}</span>
      <span className='tomny-approval__chevron' aria-hidden='true'>
        <Down size={16} strokeWidth={3} />
      </span>
    </summary>
    <div className='tomny-approval__group-body'>
      {group.shared.length > 0 && (
        <div className='tomny-approval__shared'>
          <div className='tomny-approval__shared-title'>{t('guid.hubHome.installApproval.shared')}</div>
          {group.shared.map((field, index) => (
            <FieldLine key={`shared-${index}`} field={field} t={t} />
          ))}
        </div>
      )}
      <ul className='tomny-approval__rows'>
        {group.rows.map((row, index) => (
          <li key={`row-${index}`} className='tomny-approval__row'>
            <div className='tomny-approval__row-title'>
              <span>{row.title}</span>
              {row.count > 1 && (
                <span className='tomny-approval__repeat'>
                  {t('guid.hubHome.installApproval.repeat', { count: row.count })}
                </span>
              )}
            </div>
            {row.fields.map((field, fieldIndex) => (
              <FieldLine key={`field-${fieldIndex}`} field={field} t={t} />
            ))}
          </li>
        ))}
      </ul>
    </div>
  </details>
);

const InstallApprovalHost: React.FC = () => {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<InstallApprovalRequest[]>([]);
  const [autoStart, setAutoStart] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const current = queue[0];
  const requestId = current?.requestId;
  const startAgain = current?.prompt === 'start-again';

  useEffect(() => {
    const api = window.electronAPI?.packageConnections;
    if (!api) return undefined;
    return api.onInstallApprovalRequest((request) =>
      setQueue((items) => (items.some((item) => item.requestId === request.requestId) ? items : [...items, request]))
    );
  }, []);

  useEffect(() => {
    if (requestId !== undefined) cancelRef.current?.focus();
  }, [requestId]);

  const respond = (decision: 'approve' | 'cancel' | 'dismiss'): void => {
    if (!current) return;
    const pending = window.electronAPI?.packageConnections?.respondInstallApproval({
      requestId: current.requestId,
      decision,
      autoStart: decision === 'approve' && autoStart,
      keys: current.keys,
    });
    void pending?.catch((): undefined => undefined);
    setQueue((items) => items.filter((item) => item.requestId !== current.requestId));
    setAutoStart(false);
  };

  if (!current) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      respond('cancel');
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const risks = [...new Set(current.groups.flatMap((group) => group.risks))];

  return (
    <div className='tomny-approval__backdrop'>
      <section
        ref={dialogRef}
        className='tomny-approval'
        role='dialog'
        aria-modal='true'
        aria-labelledby='tomny-install-approval-title'
        aria-describedby='tomny-install-approval-lead'
        onKeyDown={onKeyDown}
      >
        <header className='tomny-approval__header'>
          <span className='tomny-approval__hero-icon' aria-hidden='true'>
            <Shield size={22} strokeWidth={3} />
          </span>
          <div className='tomny-approval__heading'>
            <h2 id='tomny-install-approval-title' className='tomny-approval__title'>
              {startAgain
                ? t('guid.hubHome.installApproval.startAgain.title', { name: current.packageName })
                : t('guid.hubHome.installApproval.title')}
            </h2>
            {!startAgain && (
              <span className='tomny-approval__package' data-testid='install-approval-package'>
                {current.packageName}
              </span>
            )}
          </div>
        </header>

        <div className='tomny-approval__content'>
          <p id='tomny-install-approval-lead' className='tomny-approval__lead'>
            {startAgain
              ? t('guid.hubHome.installApproval.startAgain.lead', { summary: summaryOf(current.groups, t) })
              : t('guid.hubHome.installApproval.lead', {
                  name: current.packageName,
                  summary: summaryOf(current.groups, t),
                })}
          </p>

          {risks.length > 0 && (
            <section className='tomny-approval__callouts' aria-label={t('guid.hubHome.installApproval.warningTitle')}>
              <h3 className='tomny-approval__section-title'>{t('guid.hubHome.installApproval.warningTitle')}</h3>
              {risks.map((risk) => (
                <div key={risk} className='tomny-approval__callout' role='note'>
                  <span className='tomny-approval__callout-icon' aria-hidden='true'>
                    <Caution size={16} strokeWidth={3} />
                  </span>
                  <p className='tomny-approval__callout-text'>{riskTextOf(risk, t)}</p>
                </div>
              ))}
            </section>
          )}

          <section className='tomny-approval__connections'>
            <h3 className='tomny-approval__section-title'>{t('guid.hubHome.installApproval.connectionsTitle')}</h3>
            {current.groups.map((group) => (
              <GroupView key={`${group.kind}-${group.kindName}`} group={group} t={t} />
            ))}
          </section>
        </div>

        <footer className='tomny-approval__footer'>
          {!startAgain && (
            <div className='tomny-approval__autostart'>
              <div className='tomny-approval__autostart-text'>
                <span id='tomny-install-approval-autostart' className='tomny-approval__autostart-title'>
                  {t('guid.hubHome.connections.autoStart')}
                </span>
                <span className='tomny-approval__autostart-desc'>
                  {t('guid.hubHome.installApproval.autoStartDescription')}
                </span>
              </div>
              <Switch
                checked={autoStart}
                onChange={(value: boolean) => setAutoStart(value)}
                aria-labelledby='tomny-install-approval-autostart'
              />
            </div>
          )}
          <div className='tomny-approval__actions-row'>
            <p className='tomny-approval__hint'>
              {startAgain ? t('guid.hubHome.installApproval.startAgain.hint') : t('guid.hubHome.installApproval.hint')}
            </p>
            <div className='tomny-approval__actions'>
              {startAgain && (
                <button type='button' className='tomny-approval__dismiss' onClick={() => respond('dismiss')}>
                  {t('guid.hubHome.installApproval.startAgain.dismiss')}
                </button>
              )}
              <button
                type='button'
                ref={cancelRef}
                className='tomny-approval__cancel'
                onClick={() => respond('cancel')}
              >
                {t('guid.hubHome.installApproval.cancel')}
              </button>
              <button type='button' className='tomny-approval__approve' onClick={() => respond('approve')}>
                {t('guid.hubHome.installApproval.approve')}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default InstallApprovalHost;
