/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, CalendarDays, Settings, Workflow, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompanyCenterState } from './companyCenterStore';
import { listGroups } from './companyGroups';
import { CompanyCreateForm } from './create/CompanyCreateForm';
import { CompanyList } from './CompanyList';
import { CompanySettings } from './CompanySettings';
import { GroupCalendar } from './group/GroupCalendar';
import { GroupChatPanel } from './group/GroupChatPanel';
import { GroupWorkflows } from './group/GroupWorkflows';
import { chatKey } from './group/groupMeta';

type CenterView = 'list' | 'create' | 'chat' | 'settings';
/** Side pane next to the group chat. */
type GroupPane = 'calendar' | 'workflows' | null;

/**
 * Sidebar-driven selection, re-applied whenever `nonce` changes. Without a
 * `companyId` the centre shows the company list; with one it opens that
 * company's group chat.
 */
export type CompanyFocus = { companyId?: string; groupId?: string; nonce: number };

type CompanyCenterProps = {
  focus?: CompanyFocus;
  /** Open the private chat with one agent of a company. */
  onOpenAgent: (companyId: string, roleId: string) => void;
};

/**
 * Hub centre surface for companies. Three states: the list of companies (with
 * "add company"), a company's group chat, and that company's detailed settings
 * behind the gear at the top right.
 */
export const CompanyCenter: React.FC<CompanyCenterProps> = ({ focus, onOpenAgent }) => {
  const { t, i18n } = useTranslation();
  const state = useCompanyCenterState();
  const { activeId, selectCompany, structure } = state;
  const [view, setView] = useState<CenterView>(focus?.companyId ? 'chat' : 'list');
  const [groupId, setGroupId] = useState<string | undefined>(focus?.groupId);
  const [pane, setPane] = useState<GroupPane>(null);

  useEffect(() => {
    if (!focus) return;
    if (focus.companyId) {
      selectCompany(focus.companyId);
      setGroupId(focus.groupId);
      setView('chat');
    } else {
      setView('list');
    }
    // `selectCompany` is stable; re-run only when the sidebar issues a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const groups = useMemo(() => (structure ? listGroups(structure) : []), [structure]);
  const group = groups.find((item) => item.id === groupId) ?? groups[0] ?? null;
  const ctx = useMemo(
    () =>
      activeId && structure && group
        ? { companyId: activeId, companyName: activeId, group, structure, rules: state.rules, language: i18n.language }
        : null,
    [activeId, group, i18n.language, state.rules, structure]
  );

  const openCompany = (companyId: string): void => {
    selectCompany(companyId);
    setGroupId(undefined);
    setView('chat');
  };

  if (view === 'create') {
    return <CompanyCreateForm onBack={() => setView('list')} onCreated={openCompany} />;
  }

  if (view === 'list' || !activeId) {
    return <CompanyList onAdd={() => setView('create')} onOpen={openCompany} />;
  }

  if (view === 'settings') {
    return (
      <CompanySettings
        companyId={activeId}
        state={state}
        onBack={() => setView('chat')}
        onDeleted={() => setView('list')}
      />
    );
  }

  return (
    <section className='hub-company' data-testid='hub-company-center'>
      <header className='hub-company-header'>
        <button
          type='button'
          className='hub-company-icon-btn'
          aria-label={t('company.center.back')}
          onClick={() => setView('list')}
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden='true' />
        </button>
        <h2>{group ? `${activeId} · ${group.name}` : activeId}</h2>
        {groups.length > 1 && (
          <div className='hub-company-groups' role='tablist'>
            {groups.map((item) => (
              <button
                key={item.id}
                type='button'
                role='tab'
                aria-selected={item.id === group?.id}
                className={`hub-suggest-chip${item.id === group?.id ? ' hub-active' : ''}`}
                onClick={() => setGroupId(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        {(['calendar', 'workflows'] as const).map((value) => (
          <button
            key={value}
            type='button'
            className={`hub-company-icon-btn${value === 'calendar' ? ' hub-company-settings-btn' : ''}${
              pane === value ? ' hub-active' : ''
            }`}
            data-testid={`hub-company-pane-${value}`}
            aria-pressed={pane === value}
            aria-label={t(`company.center.group.${value}`)}
            title={t(`company.center.group.${value}`)}
            disabled={!ctx}
            onClick={() => setPane((current) => (current === value ? null : value))}
          >
            {value === 'calendar' ? (
              <CalendarDays size={16} strokeWidth={1.75} aria-hidden='true' />
            ) : (
              <Workflow size={16} strokeWidth={1.75} aria-hidden='true' />
            )}
          </button>
        ))}
        <button
          type='button'
          className='hub-company-icon-btn'
          data-testid='hub-company-settings'
          aria-label={t('company.center.settings.open')}
          title={t('company.center.settings.open')}
          onClick={() => setView('settings')}
        >
          <Settings size={16} strokeWidth={1.75} aria-hidden='true' />
        </button>
      </header>

      {state.structureStatus === 'loading' && (
        <div className='hub-agents-empty'>{t('company.center.settings.loading')}</div>
      )}
      {state.structureStatus === 'error' && (
        <div className='hub-agents-empty'>{t('company.center.settings.loadError')}</div>
      )}
      {structure && !group && <div className='hub-agents-empty'>{t('company.center.chat.noGroup')}</div>}
      {ctx && (
        <div className={`hub-company-chat-layout${pane ? ' hub-company-chat-layout--pane' : ''}`}>
          <GroupChatPanel
            key={chatKey(ctx.companyId, ctx.group.id)}
            ctx={ctx}
            onOpenAgent={(roleId) => onOpenAgent(ctx.companyId, roleId)}
          />
          {pane && (
            <aside className='hub-company-pane' aria-label={t(`company.center.group.${pane}`)}>
              <header className='hub-company-pane-head'>
                <h3>{t(`company.center.group.${pane}`)}</h3>
                <button
                  type='button'
                  className='hub-company-icon-btn'
                  aria-label={t('company.center.group.close')}
                  onClick={() => setPane(null)}
                >
                  <X size={14} strokeWidth={1.75} aria-hidden='true' />
                </button>
              </header>
              {pane === 'calendar' ? (
                <GroupCalendar
                  key={chatKey(ctx.companyId, ctx.group.id)}
                  groupKey={chatKey(ctx.companyId, ctx.group.id)}
                  group={ctx.group}
                />
              ) : (
                <GroupWorkflows key={chatKey(ctx.companyId, ctx.group.id)} ctx={ctx} />
              )}
            </aside>
          )}
        </div>
      )}
    </section>
  );
};
