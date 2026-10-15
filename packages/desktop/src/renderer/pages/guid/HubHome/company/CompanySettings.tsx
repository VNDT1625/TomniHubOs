/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { RoleNode } from '@process/company/companyOrchestrator';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companySecretSets } from '@/renderer/services/secretSetsClient';
import { SecretSetsPanel } from '../memory/SecretSetsPanel';
import { roleLabelKey, type CompanyCenterState } from './companyCenterStore';

type CompanySettingsProps = {
  companyId: string;
  state: CompanyCenterState;
  onBack: () => void;
  onDeleted: () => void;
};

const RoleRows: React.FC<{ node: RoleNode; depth: number }> = ({ node, depth }) => {
  const { t } = useTranslation();
  return (
    <>
      <li className='hub-company-role' style={{ paddingLeft: depth * 16 }}>
        <strong>{node.name}</strong>
        <span>{t(roleLabelKey(node.role))}</span>
        <span>
          {node.assignment?.label ?? t('company.center.settings.unassigned')}
          {node.assignment?.model ? ` · ${node.assignment.model}` : ''}
        </span>
        {node.responsibilities && <p>{node.responsibilities}</p>}
      </li>
      {node.children.map((child) => (
        <RoleRows key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
};

/** Deep, per-company settings: role structure, rules, executor-strength guidance and deletion. */
export const CompanySettings: React.FC<CompanySettingsProps> = ({ companyId, state, onBack, onDeleted }) => {
  const { t } = useTranslation();
  const [rulesText, setRulesText] = useState(state.rules.join('\n'));
  const [strengths, setStrengths] = useState(state.strengthsGuidance);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const secretsApi = useMemo(() => companySecretSets(companyId), [companyId]);

  useEffect(() => {
    setRulesText(state.rules.join('\n'));
  }, [state.rules]);

  const saveRules = async (): Promise<void> => {
    const rules = rulesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      const res = await ipcBridge.company.setRules.invoke({ companyId, rules });
      setNotice(res.ok ? t('company.center.settings.saved') : t('company.center.settings.saveFailed'));
      if (res.ok) state.refresh();
    } catch {
      setNotice(t('company.center.settings.saveFailed'));
    }
  };

  const remove = async (): Promise<void> => {
    const deleted = await state.forgetCompany(companyId);
    if (deleted) onDeleted();
    else setNotice(t('company.center.settings.deleteFailed'));
    setConfirmDelete(false);
  };

  return (
    <section className='hub-company' data-testid='hub-company-settings-view'>
      <header className='hub-company-header'>
        <button type='button' className='hub-company-icon-btn' aria-label={t('company.center.back')} onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden='true' />
        </button>
        <h2>{t('company.center.settings.title', { name: companyId })}</h2>
        <button type='button' className='hub-q-btn hub-company-header-end' onClick={state.refresh}>
          {t('company.center.settings.refresh')}
        </button>
      </header>
      {notice && <div className='hub-company-notice'>{notice}</div>}

      <div className='hub-company-block'>
        <h3>{t('company.center.settings.structure')}</h3>
        {state.structure ? (
          <ul className='hub-company-roles'>
            <RoleRows node={state.structure.root} depth={0} />
          </ul>
        ) : (
          <div className='hub-agents-empty'>{t('company.center.settings.loadError')}</div>
        )}
      </div>

      <div className='hub-company-block'>
        <h3>{t('company.center.settings.rules')}</h3>
        <p className='hub-company-hint'>{t('company.center.settings.rulesHint')}</p>
        <textarea
          className='hub-company-field'
          rows={6}
          value={rulesText}
          onChange={(event) => setRulesText(event.target.value)}
        />
        <div className='hub-company-form-actions'>
          <button type='button' className='hub-q-btn hub-q-btn--primary' onClick={() => void saveRules()}>
            {t('company.center.settings.save')}
          </button>
        </div>
      </div>

      <div className='hub-company-block'>
        <h3>{t('company.center.settings.strengths')}</h3>
        <p className='hub-company-hint'>{t('company.center.settings.strengthsHint')}</p>
        <textarea
          className='hub-company-field'
          rows={4}
          value={strengths}
          onChange={(event) => setStrengths(event.target.value)}
        />
        <div className='hub-company-form-actions'>
          <button
            type='button'
            className='hub-q-btn'
            onClick={() => {
              state.saveStrengthsGuidance(strengths);
              setNotice(t('company.center.settings.saved'));
            }}
          >
            {t('company.center.settings.save')}
          </button>
        </div>
      </div>

      <details className='hub-company-advanced hub-company-block' data-testid='hub-company-advanced'>
        <summary>
          <ChevronDown size={14} aria-hidden='true' />
          <span>{t('company.center.settings.advanced')}</span>
          <small>{t('company.center.settings.advancedHint')}</small>
        </summary>
        <SecretSetsPanel api={secretsApi} scope='company' active />
      </details>

      <div className='hub-company-block'>
        <h3>{t('company.center.settings.danger')}</h3>
        {confirmDelete ? (
          <div className='hub-company-form-actions'>
            <span>{t('company.center.settings.deleteConfirm', { id: companyId })}</span>
            <button type='button' className='hub-q-btn' onClick={() => setConfirmDelete(false)}>
              {t('company.center.cancel')}
            </button>
            <button type='button' className='hub-q-btn hub-company-danger' onClick={() => void remove()}>
              {t('company.center.settings.delete')}
            </button>
          </div>
        ) : (
          <button type='button' className='hub-q-btn hub-company-danger' onClick={() => setConfirmDelete(true)}>
            {t('company.center.settings.delete')}
          </button>
        )}
      </div>
    </section>
  );
};
