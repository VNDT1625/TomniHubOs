/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  Crown,
  Network,
  Plus,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidCompanyId } from '../companyCenterStore';
import {
  runCompanySetup,
  useAgentPool,
  type CompanySetup,
  type DivisionDraft,
  type SetupMode,
  type ExecutorKey,
} from './companySetup';

type CompanyCreateFormProps = {
  onBack: () => void;
  /** Called with the company id once the company exists. */
  onCreated: (companyId: string) => void;
};

const toggle = (list: readonly string[], value: string): string[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

const MODES: readonly { value: SetupMode; icon: LucideIcon }[] = [
  { value: 'describe', icon: Sparkles },
  { value: 'manual', icon: SlidersHorizontal },
];

/** Toggle chips; the empty state is shown while the pool is loading or unavailable. */
const PickList: React.FC<{
  items: { value: string; label: string; hint?: string }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}> = ({ items, selected, onChange, emptyLabel }) =>
  items.length === 0 ? (
    <div className='hub-company-hint'>{emptyLabel}</div>
  ) : (
    <div className='hub-company-picks'>
      {items.map((item) => {
        const on = selected.includes(item.value);
        return (
          <label key={item.value} className={`hub-company-pick${on ? ' hub-active' : ''}`} title={item.hint}>
            <input type='checkbox' checked={on} onChange={() => onChange(toggle(selected, item.value))} />
            <span className='hub-company-pick-box' aria-hidden='true'>
              {on && <Check size={11} strokeWidth={2.5} />}
            </span>
            {item.label}
          </label>
        );
      })}
    </div>
  );

/** Native select with a themed chevron. */
const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <span className='hub-company-select'>
    <select className='hub-company-field' {...props} />
    <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
  </span>
);

/** One card of the form: icon badge, title, optional hint and badge on the right. */
const Section: React.FC<{
  icon: LucideIcon;
  title: string;
  hint?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, title, hint, aside, children }) => (
  <section className='hub-company-card'>
    <header className='hub-company-card-head'>
      <span className='hub-company-card-icon' aria-hidden='true'>
        <Icon size={15} strokeWidth={1.75} />
      </span>
      <div className='hub-company-card-title'>
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </div>
      {aside && <span className='hub-company-card-aside'>{aside}</span>}
    </header>
    <div className='hub-company-card-body'>{children}</div>
  </section>
);

/**
 * Add a company. Only the id is required. In "describe" mode an agent designs
 * the whole company from the purpose and anything filled in below is applied on
 * top; in "manual" mode the user sets the structure, Boss and employees.
 */
export const CompanyCreateForm: React.FC<CompanyCreateFormProps> = ({ onBack, onCreated }) => {
  const { t } = useTranslation();
  const pool = useAgentPool();
  const [mode, setMode] = useState<SetupMode>('describe');
  const [companyId, setCompanyId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [presidentName, setPresidentName] = useState('');
  const [bossExecutor, setBossExecutor] = useState('');
  const [bossModel, setBossModel] = useState('');
  const [hire, setHire] = useState<ExecutorKey[]>([]);
  const [sessionMode, setSessionMode] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
  const [rulesText, setRulesText] = useState('');
  const [strengths, setStrengths] = useState('');
  const [divisions, setDivisions] = useState<DivisionDraft[]>([]);
  const [directWorkers, setDirectWorkers] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = companyId.trim() || 'company';
  const executors = [
    ...(pool?.clis.filter((cli) => cli.available).map((cli) => ({ value: `cli:${cli.id}`, label: cli.name })) ?? []),
    ...(pool?.assistants.map((assistant) => ({
      value: `assistant:${assistant.id}`,
      label: assistant.name,
      hint: assistant.model,
    })) ?? []),
  ];
  const canSubmit = !busy && (mode === 'manual' || purpose.trim().length > 0);
  const countBadge = (count: number): string =>
    count === 0 ? t('company.center.create.anySelected') : t('company.center.create.selectedCount', { count });

  const submit = async (): Promise<void> => {
    if (!isValidCompanyId(id)) {
      setError(t('company.center.create.invalidId'));
      return;
    }
    const setup: CompanySetup = {
      mode,
      companyId: id,
      purpose: purpose.trim(),
      presidentName,
      boss: bossExecutor ? { executor: bossExecutor, model: bossModel || undefined } : undefined,
      hire,
      sessionMode: sessionMode || undefined,
      skills,
      mcpServerIds,
      rules: rulesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      strengths,
      divisions,
      directWorkers,
    };
    setBusy(true);
    setError(null);
    const outcome = await runCompanySetup(setup, pool);
    setBusy(false);
    if (outcome.ok) onCreated(id);
    else {
      setError(
        outcome.reason === 'noModel'
          ? t('company.center.create.noModel')
          : (outcome.message ?? t('company.center.create.failed'))
      );
    }
  };

  return (
    <section className='hub-company hub-company-create' data-testid='hub-company-create'>
      <form
        className='hub-company-create-form'
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <header className='hub-company-create-head'>
          <button type='button' className='hub-company-icon-btn' aria-label={t('company.center.back')} onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden='true' />
          </button>
          <div>
            <h2>{t('company.center.create.title')}</h2>
            <p>{t('company.center.create.subtitle')}</p>
          </div>
        </header>

        <div className='hub-company-modes' role='radiogroup' aria-label={t('company.center.create.modeLabel')}>
          {MODES.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type='button'
              role='radio'
              aria-checked={mode === value}
              className={`hub-company-mode${mode === value ? ' hub-active' : ''}`}
              data-testid={`hub-company-mode-${value}`}
              onClick={() => setMode(value)}
            >
              <span className='hub-company-card-icon' aria-hidden='true'>
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className='hub-company-mode-text'>
                <strong>{t(`company.center.create.mode.${value}`)}</strong>
                <small>{t(`company.center.create.mode.${value}Hint`)}</small>
              </span>
              <span className='hub-company-mode-dot' aria-hidden='true' />
            </button>
          ))}
        </div>

        <Section icon={Building2} title={t('company.center.create.basics')}>
          <label className='hub-company-label'>
            {t('company.center.create.idLabel')}
            <input
              className='hub-company-field'
              value={companyId}
              placeholder={t('company.center.create.idPlaceholder')}
              onChange={(event) => setCompanyId(event.target.value)}
            />
          </label>
          <label className='hub-company-label'>
            {t('company.center.create.purposeLabel')}
            <textarea
              className='hub-company-field'
              rows={4}
              value={purpose}
              placeholder={t('company.center.create.purposePlaceholder')}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </label>
        </Section>

        <Section icon={Crown} title={t('company.center.create.bossTitle')} hint={t('company.center.create.bossHint')}>
          <div className='hub-company-grid'>
            <label className='hub-company-label'>
              {t('company.center.create.presidentName')}
              <input
                className='hub-company-field'
                value={presidentName}
                placeholder={t('company.center.create.presidentPlaceholder')}
                onChange={(event) => setPresidentName(event.target.value)}
              />
            </label>
            <label className='hub-company-label'>
              {t('company.center.create.bossExecutor')}
              <Select value={bossExecutor} onChange={(event) => setBossExecutor(event.target.value)}>
                <option value=''>{t('company.center.create.auto')}</option>
                {executors.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className='hub-company-label'>
              {t('company.center.create.bossModel')}
              <Select value={bossModel} onChange={(event) => setBossModel(event.target.value)}>
                <option value=''>{t('company.center.create.auto')}</option>
                {pool?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </Section>

        <Section
          icon={Users}
          title={t('company.center.create.hireTitle')}
          hint={t('company.center.create.hireHint')}
          aside={countBadge(hire.length)}
        >
          <PickList
            items={executors}
            selected={hire}
            onChange={setHire}
            emptyLabel={t('company.center.create.poolEmpty')}
          />
        </Section>

        {mode === 'manual' && (
          <Section
            icon={Network}
            title={t('company.center.create.structureTitle')}
            hint={t('company.center.create.structureHint')}
          >
            {divisions.map((division, index) => (
              <div key={index} className='hub-company-division'>
                <input
                  className='hub-company-field'
                  value={division.name}
                  placeholder={t('company.center.create.divisionName')}
                  onChange={(event) =>
                    setDivisions((current) =>
                      current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item))
                    )
                  }
                />
                <input
                  className='hub-company-field hub-company-number'
                  type='number'
                  min={1}
                  max={20}
                  value={division.workers}
                  aria-label={t('company.center.create.divisionWorkers')}
                  onChange={(event) =>
                    setDivisions((current) =>
                      current.map((item, i) => (i === index ? { ...item, workers: Number(event.target.value) } : item))
                    )
                  }
                />
                <button
                  type='button'
                  className='hub-company-icon-btn'
                  aria-label={t('company.center.create.removeDivision')}
                  onClick={() => setDivisions((current) => current.filter((_, i) => i !== index))}
                >
                  <X size={14} strokeWidth={1.75} aria-hidden='true' />
                </button>
              </div>
            ))}
            {divisions.length === 0 && (
              <label className='hub-company-label hub-company-label--inline'>
                {t('company.center.create.directWorkers')}
                <input
                  className='hub-company-field hub-company-number'
                  type='number'
                  min={1}
                  max={20}
                  value={directWorkers}
                  onChange={(event) => setDirectWorkers(Number(event.target.value))}
                />
              </label>
            )}
            <button
              type='button'
              className='hub-company-add'
              onClick={() => setDivisions((current) => [...current, { name: '', workers: 2 }])}
            >
              <Plus size={13} strokeWidth={2} aria-hidden='true' /> {t('company.center.create.addDivision')}
            </button>
          </Section>
        )}

        <details className='hub-company-advanced'>
          <summary>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
            <span>{t('company.center.create.advanced')}</span>
            <small>{t('company.center.create.advancedHint')}</small>
          </summary>

          <Section
            icon={ShieldCheck}
            title={t('company.center.create.permissionsTitle')}
            hint={t('company.center.create.permissionsHint')}
          >
            <label className='hub-company-label'>
              {t('company.center.create.sessionMode')}
              <Select value={sessionMode} onChange={(event) => setSessionMode(event.target.value)}>
                <option value=''>{t('company.center.create.auto')}</option>
                {pool?.modes.map((item) => (
                  <option key={`${item.engine}:${item.value}`} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>
            <div className='hub-company-subtitle'>
              {t('company.center.create.skills')} <em>{countBadge(skills.length)}</em>
            </div>
            <PickList
              items={
                pool?.skills.map((skill) => ({ value: skill.name, label: skill.name, hint: skill.description })) ?? []
              }
              selected={skills}
              onChange={setSkills}
              emptyLabel={t('company.center.create.poolEmpty')}
            />
            <div className='hub-company-subtitle'>
              {t('company.center.create.mcp')} <em>{countBadge(mcpServerIds.length)}</em>
            </div>
            <PickList
              items={pool?.mcpServers.map((server) => ({ value: server.id, label: server.name })) ?? []}
              selected={mcpServerIds}
              onChange={setMcpServerIds}
              emptyLabel={t('company.center.create.poolEmpty')}
            />
          </Section>

          <Section
            icon={ScrollText}
            title={t('company.center.create.rulesTitle')}
            hint={t('company.center.create.rulesHint')}
          >
            <textarea
              className='hub-company-field'
              rows={4}
              value={rulesText}
              onChange={(event) => setRulesText(event.target.value)}
            />
          </Section>

          {mode === 'describe' && (
            <Section
              icon={Sparkles}
              title={t('company.center.create.strengthsTitle')}
              hint={t('company.center.create.strengthsHint')}
            >
              <textarea
                className='hub-company-field'
                rows={3}
                value={strengths}
                onChange={(event) => setStrengths(event.target.value)}
              />
            </Section>
          )}
        </details>

        <footer className='hub-company-create-foot'>
          {error && <div className='hub-company-error'>{error}</div>}
          <div className='hub-company-create-actions'>
            {!canSubmit && !busy && <small>{t('company.center.create.needPurpose')}</small>}
            <button type='button' className='hub-q-btn' onClick={onBack} disabled={busy}>
              {t('company.center.cancel')}
            </button>
            <button
              type='submit'
              className='hub-q-btn hub-q-btn--primary'
              disabled={!canSubmit}
              data-testid='hub-company-create-submit'
            >
              {mode === 'describe' ? (
                <Sparkles size={13} strokeWidth={2} aria-hidden='true' />
              ) : (
                <Plus size={13} strokeWidth={2} aria-hidden='true' />
              )}{' '}
              {busy ? t('company.center.create.submitting') : t(`company.center.create.submit.${mode}`)}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
};
