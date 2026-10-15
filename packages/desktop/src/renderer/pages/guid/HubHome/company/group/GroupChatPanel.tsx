/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RoleNode } from '@process/company/companyOrchestrator';
import { Target } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flattenRoles } from '../companyGroups';
import { clearGroupChat, sendGroupMessage, type GroupContext } from './groupEngine';
import { chatKey } from './groupMeta';
import type { GroupMessage } from './groupPrompts';
import { useGroupMeta, useGroupSnapshot } from './useGroupChat';

type GroupChatPanelProps = {
  ctx: GroupContext;
  /** Open the private 1-1 chat with one agent (also where permissions are approved). */
  onOpenAgent: (roleId: string) => void;
};

/** The group's shared goal, editable in place. */
const GoalBar: React.FC<{ groupKey: string }> = ({ groupKey }) => {
  const { t } = useTranslation();
  const [meta, updateMeta] = useGroupMeta(groupKey);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  if (editing) {
    return (
      <div className='hub-company-goal hub-company-goal--editing'>
        <Target size={14} strokeWidth={1.75} aria-hidden='true' />
        <input
          className='hub-company-field'
          value={value}
          autoFocus
          maxLength={600}
          placeholder={t('company.center.group.goalPlaceholder')}
          data-testid='hub-company-goal-input'
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
          }}
        />
        <button type='button' className='hub-q-btn' onClick={() => setEditing(false)}>
          {t('company.center.cancel')}
        </button>
        <button
          type='button'
          className='hub-q-btn hub-q-btn--primary'
          data-testid='hub-company-goal-save'
          onClick={() => {
            updateMeta((current) => ({ ...current, goal: value.trim() }));
            setEditing(false);
          }}
        >
          {t('company.center.group.save')}
        </button>
      </div>
    );
  }
  return (
    <button
      type='button'
      className='hub-company-goal'
      data-testid='hub-company-goal'
      title={t('company.center.group.goalEdit')}
      onClick={() => {
        setValue(meta.goal);
        setEditing(true);
      }}
    >
      <Target size={14} strokeWidth={1.75} aria-hidden='true' />
      <strong>{t('company.center.group.goal')}</strong>
      <span>{meta.goal || t('company.center.group.goalEmpty')}</span>
    </button>
  );
};

/**
 * Group conversation. Laya picks which members read each message, `@name`
 * brings anyone in, agents hand work on with `@`, replies stream in, and a
 * member waiting for a permission asks the user to approve it in its chat.
 */
export const GroupChatPanel: React.FC<GroupChatPanelProps> = ({ ctx, onOpenAgent }) => {
  const { t } = useTranslation();
  const { group, structure } = ctx;
  const groupKey = chatKey(ctx.companyId, group.id);
  const { messages, busy, drafts, waiting } = useGroupSnapshot(groupKey);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const roles = useMemo(() => flattenRoles(structure.root) as RoleNode[], [structure]);
  const memberIds = useMemo(() => new Set([group.leader.id, ...group.members.map((member) => member.id)]), [group]);
  const outsiders = useMemo(() => roles.filter((node) => !memberIds.has(node.id)), [memberIds, roles]);
  const nameOf = (roleId: string): string => roles.find((node) => node.id === roleId)?.name ?? roleId;
  const streamed = [...drafts.values()].join('').length;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, busy.size, waiting.size, streamed]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void sendGroupMessage(ctx, text);
  };

  const renderMember = (role: RoleNode, leader: boolean): React.ReactNode => (
    <button
      key={role.id}
      type='button'
      className='hub-company-member'
      data-testid={`hub-company-member-${role.id}`}
      title={t('company.center.chat.openPrivate', { name: role.name })}
      onClick={() => onOpenAgent(role.id)}
    >
      <span className={`hub-dot ${busy.has(role.id) ? 'hub-dot-g' : 'hub-dot-gr'}`} />
      {role.name}
      {leader && <em>{t('company.center.chat.leader')}</em>}
    </button>
  );

  const author = (message: GroupMessage): React.ReactNode => {
    if (message.from === 'user') return t('company.center.chat.you');
    if (message.from === 'calendar') return t('company.center.group.calendarAuthor', { title: message.name });
    if (message.from === 'workflow') return t('company.center.group.workflowAuthor');
    return message.name;
  };

  const body = (message: GroupMessage): string => {
    if (message.error) return t('company.center.chat.agentError', { reason: message.text });
    const run = message.workflow;
    if (message.from === 'workflow' && run?.status) {
      return t(`company.center.group.run.${run.status}`, { name: run.name, total: run.total, step: run.step });
    }
    return message.text;
  };

  return (
    <div className='hub-company-chat' data-testid='hub-company-group-chat'>
      <GoalBar groupKey={groupKey} />
      <div className='hub-company-chat-members'>
        {renderMember(group.leader, true)}
        {group.members.map((member) => renderMember(member, false))}
        {messages.length > 0 && (
          <button type='button' className='hub-company-chat-clear' onClick={() => clearGroupChat(groupKey)}>
            {t('company.center.chat.clear')}
          </button>
        )}
      </div>

      <div ref={listRef} className='hub-company-chat-list' role='log' aria-live='polite'>
        {messages.length === 0 && <div className='hub-agents-empty'>{t('company.center.chat.empty')}</div>}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`hub-company-msg${message.from === 'user' ? ' hub-company-msg--user' : ''}${
              message.error ? ' hub-company-msg--error' : ''
            }${message.from === 'calendar' || message.from === 'workflow' ? ' hub-company-msg--system' : ''}`}
          >
            <div className='hub-company-msg-name'>
              {author(message)}
              {message.guest && <em>{t('company.center.chat.guest')}</em>}
              {message.late && <em>{t('company.center.group.late')}</em>}
              {message.workflow && message.from !== 'workflow' && (
                <em>
                  {t('company.center.group.stepTag', {
                    name: message.workflow.name,
                    step: message.workflow.step,
                    total: message.workflow.total,
                  })}
                </em>
              )}
            </div>
            <div className='hub-company-msg-text'>{body(message)}</div>
            {message.routing && (
              <div className='hub-company-msg-routing'>
                {message.routing.source === 'all'
                  ? t('company.center.chat.routingAll')
                  : t('company.center.chat.routingRead', { names: message.routing.called.join(', ') })}
                {message.routing.skipped.length > 0 &&
                  ` · ${t('company.center.chat.routingSkipped', {
                    names: message.routing.skipped
                      .map((item) => `${item.name} ${Math.round(item.score * 100)}%`)
                      .join(', '),
                  })}`}
              </div>
            )}
          </div>
        ))}
        {[...busy].map((roleId) =>
          waiting.has(roleId) ? (
            <div key={`wait-${roleId}`} className='hub-company-msg hub-company-msg--approval'>
              <span>{t('company.center.group.waitingApproval', { name: nameOf(roleId) })}</span>
              <button
                type='button'
                className='hub-q-btn hub-q-btn--primary'
                data-testid={`hub-company-approve-${roleId}`}
                onClick={() => onOpenAgent(roleId)}
              >
                {t('company.center.group.openToApprove')}
              </button>
            </div>
          ) : drafts.get(roleId) ? (
            <div key={`draft-${roleId}`} className='hub-company-msg hub-company-msg--streaming'>
              <div className='hub-company-msg-name'>{nameOf(roleId)}</div>
              <div className='hub-company-msg-text'>{drafts.get(roleId)}</div>
            </div>
          ) : (
            <div key={`busy-${roleId}`} className='hub-company-msg hub-company-msg--busy'>
              {t('company.center.chat.thinking', { name: nameOf(roleId) })}
            </div>
          )
        )}
      </div>

      {outsiders.length > 0 && (
        <div className='hub-company-chat-tags'>
          <span>{t('company.center.chat.tagIn')}</span>
          {outsiders.map((role) => (
            <button
              key={role.id}
              type='button'
              className='hub-suggest-chip'
              onClick={() =>
                setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${role.name} `)
              }
            >
              @{role.name}
            </button>
          ))}
        </div>
      )}

      <div className='hub-company-chat-input'>
        <textarea
          className='hub-company-field'
          rows={2}
          value={draft}
          placeholder={t('company.center.chat.placeholder', { name: group.name })}
          data-testid='hub-company-chat-input'
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type='button'
          className='hub-q-btn hub-q-btn--primary'
          disabled={!draft.trim()}
          data-testid='hub-company-chat-send'
          onClick={submit}
        >
          {t('company.center.chat.send')}
        </button>
      </div>
    </div>
  );
};
