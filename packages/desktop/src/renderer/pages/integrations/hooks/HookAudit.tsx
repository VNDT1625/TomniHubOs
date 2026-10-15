/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { HookSettingsAuditLine } from '@/common/integrations/hooks/hookSettings';

type HookAuditProps = { lines: HookSettingsAuditLine[]; onRefresh: () => void };

/** The last runs. A line holds lengths and codes only, so there is nothing sensitive to hide here. */
const HookAudit: React.FC<HookAuditProps> = ({ lines, onRefresh }) => {
  const { t } = useTranslation();
  const headingId = useId();

  const resultOf = (line: HookSettingsAuditLine): string => {
    if (line.errorCode === 'approval-stale') return t('settings.hooks.audit.stale');
    if (line.errorCode) return line.errorCode;
    return line.timedOut ? t('settings.hooks.audit.timedOut') : t('settings.hooks.audit.ok');
  };

  return (
    <section className='hooks-section' aria-labelledby={headingId} data-testid='hook-audit'>
      <header className='hooks-section-head'>
        <h3 id={headingId} className='hooks-section-title'>
          {t('settings.hooks.audit.title')}
        </h3>
        <button type='button' className='hooks-btn' onClick={onRefresh}>
          {t('settings.hooks.refresh')}
        </button>
      </header>
      <p className='hooks-hint'>{t('settings.hooks.audit.note')}</p>
      {lines.length === 0 ? (
        <p className='hooks-empty'>{t('settings.hooks.audit.empty')}</p>
      ) : (
        <div className='hooks-table-wrap'>
          <table className='hooks-table'>
            <thead>
              <tr>
                <th scope='col'>{t('settings.hooks.audit.col.time')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.event')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.source')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.hook')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.decision')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.exit')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.duration')}</th>
                <th scope='col'>{t('settings.hooks.audit.col.result')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                // Two runs can share a timestamp and hook, so the position keeps the rows apart.
                // oxlint-disable-next-line react/no-array-index-key
                <tr key={`${line.ts}:${index}`} data-testid='hook-audit-line'>
                  <td>{new Date(line.ts).toLocaleString()}</td>
                  <td>{line.event}</td>
                  <td>{t(`settings.hooks.source.${line.source}`)}</td>
                  <td>
                    <code>{line.hookId ? line.hookId.slice(0, 8) : '-'}</code>
                  </td>
                  <td>{t(`settings.hooks.audit.decision.${line.decision}`)}</td>
                  <td>{line.exitCode === null ? '-' : String(line.exitCode)}</td>
                  <td>{t('settings.hooks.row.seconds', { count: Math.round(line.durationMs) / 1000 })}</td>
                  <td>{resultOf(line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default HookAudit;
