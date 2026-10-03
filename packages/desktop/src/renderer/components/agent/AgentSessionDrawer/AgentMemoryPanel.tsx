/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Input, Message, Progress, Select, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Pin, Plus } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentMemory, type UseAgentMemory } from './useAgentMemory';
import type { IdeMemoryRecordableKind } from '@/renderer/services/sessionMemoryClient';
import type { SuperMemoryItem, SuperMemoryKind } from '@process/userUnderstanding/sessionMemoryStore';

type AgentMemoryPanelProps = {
  sessionId?: string | null;
  active: boolean;
};

const QuickAddNote: React.FC<{
  remember: UseAgentMemory['remember'];
  kindOptions: ReadonlyArray<{ value: IdeMemoryRecordableKind; label: string }>;
  labels: { placeholder: string; add: string; pin: string; kind: string; saved: string };
}> = ({ remember, kindOptions, labels }) => {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<IdeMemoryRecordableKind>('note');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const error = await remember(trimmed, { kind, pinned });
    setSaving(false);
    if (error) {
      Message.error(error);
      return;
    }
    setText('');
    setPinned(false);
    Message.success(labels.saved);
  }, [text, kind, pinned, saving, remember, labels.saved]);

  return (
    <div className='shrink-0 flex flex-col gap-8px pt-8px border-t border-t-1 border-arco-2'>
      <Input.TextArea
        value={text}
        onChange={setText}
        placeholder={labels.placeholder}
        autoSize={{ minRows: 2, maxRows: 4 }}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className='flex items-center gap-8px'>
        <Select size='small' value={kind} onChange={(v) => setKind(v as IdeMemoryRecordableKind)} className='w-110px'>
          {kindOptions.map((opt) => (
            <Select.Option key={opt.value} value={opt.value}>
              {opt.label}
            </Select.Option>
          ))}
        </Select>
        <Tooltip content={labels.pin} mini>
          <span className='inline-flex items-center gap-4px text-12px text-t-secondary cursor-pointer'>
            <Switch size='small' checked={pinned} onChange={setPinned} />
            <Pin theme={pinned ? 'filled' : 'outline'} size={13} />
          </span>
        </Tooltip>
        <div className='flex-1' />
        <Button
          size='small'
          type='primary'
          icon={<Plus theme='outline' size={13} />}
          loading={saving}
          disabled={!text.trim()}
          onClick={() => void submit()}
        >
          {labels.add}
        </Button>
      </div>
    </div>
  );
};

export const AgentMemoryPanel: React.FC<AgentMemoryPanelProps> = ({ sessionId, active }) => {
  const { t } = useTranslation();
  const {
    snapshot,
    loading: _loading,
    refresh: _refresh,
    clear: _clear,
    remember,
  } = useAgentMemory(sessionId ?? null, active);

  // Pre-session local notes state for Home
  const [preSessionNotes, setPreSessionNotes] = useState<string>(() => {
    try {
      return localStorage.getItem('tomny_home_pre_session_notes') ?? '';
    } catch {
      return '';
    }
  });

  const handleSavePreSessionNote = (val: string) => {
    setPreSessionNotes(val);
    try {
      localStorage.setItem('tomny_home_pre_session_notes', val);
    } catch {
      // ignore
    }
  };

  const groups = useMemo(() => {
    const items = snapshot?.items ?? [];
    return {
      summaries: items.filter((i) => i.kind === 'summary'),
      pinned: items.filter((i) => i.pinned && i.kind !== 'summary'),
      recent: items.filter((i) => !i.pinned && i.kind !== 'summary'),
    };
  }, [snapshot]);

  const pct = useMemo(() => {
    if (!snapshot || snapshot.tokenBudget <= 0) return 0;
    return Math.min(100, Math.round((snapshot.tokensUsed / snapshot.tokenBudget) * 100));
  }, [snapshot]);

  const kindLabels = useMemo<Record<SuperMemoryKind, string>>(
    () => ({
      fact: t('ide.memory.kind.fact', { defaultValue: 'Fact' }),
      decision: t('ide.memory.kind.decision', { defaultValue: 'Decision' }),
      todo: t('ide.memory.kind.todo', { defaultValue: 'Todo' }),
      snippet: t('ide.memory.kind.snippet', { defaultValue: 'Snippet' }),
      note: t('ide.memory.kind.note', { defaultValue: 'Note' }),
      summary: t('ide.memory.kind.summary', { defaultValue: 'Summary' }),
    }),
    [t]
  );

  const recordableKindOptions = useMemo<ReadonlyArray<{ value: IdeMemoryRecordableKind; label: string }>>(
    () => [
      { value: 'note', label: kindLabels.note },
      { value: 'fact', label: kindLabels.fact },
      { value: 'decision', label: kindLabels.decision },
      { value: 'todo', label: kindLabels.todo },
      { value: 'snippet', label: kindLabels.snippet },
    ],
    [kindLabels]
  );

  // If at Home without a session ID yet
  if (!sessionId) {
    return (
      <div className='flex flex-col gap-14px h-full'>
        <div className='p-12px rd-8px bg-fill-2 border border-arco-2 flex flex-col gap-8px'>
          <div className='flex items-center justify-between'>
            <span className='text-13px font-600 text-t-primary'>
              {t('ide.memory.preSessionNoteTitle', { defaultValue: 'Pre-session Instructions & Notes' })}
            </span>
            {preSessionNotes.trim() && (
              <Button size='mini' type='text' status='danger' onClick={() => handleSavePreSessionNote('')}>
                {t('common.clear', { defaultValue: 'Clear' })}
              </Button>
            )}
          </div>
          <p className='text-12px text-t-secondary leading-normal mb-0'>
            {t('ide.memory.preSessionNoteDesc', {
              defaultValue:
                'Jot down any persistent rules, custom requirements, or preferences for your upcoming conversation. These will be kept handy as guidance.',
            })}
          </p>
          <Input.TextArea
            value={preSessionNotes}
            onChange={handleSavePreSessionNote}
            placeholder={t('ide.memory.preSessionNotePlaceholder', {
              defaultValue: 'e.g. Always respond concisely; adhere strictly to TypeScript rules...',
            })}
            autoSize={{ minRows: 4, maxRows: 10 }}
          />
        </div>
      </div>
    );
  }

  const isEmpty = !snapshot || snapshot.items.length === 0;

  return (
    <div className='flex flex-col gap-14px h-full min-h-0'>
      {/* Token-budget gauge */}
      <div className='flex flex-col gap-6px'>
        <div className='flex items-center justify-between'>
          <span className='text-11px font-600 uppercase tracking-wide text-t-tertiary'>
            {t('ide.memory.usage', { defaultValue: 'Memory Budget' })}
          </span>
          <span className='text-12px font-500 text-t-secondary'>
            {t('ide.memory.usageValue', {
              used: snapshot?.tokensUsed ?? 0,
              budget: snapshot?.tokenBudget ?? 0,
              defaultValue: `${snapshot?.tokensUsed ?? 0} / ${snapshot?.tokenBudget ?? 0} tokens`,
            })}
          </span>
        </div>
        <Progress
          percent={pct}
          status={pct > 90 ? 'error' : pct > 75 ? 'warning' : 'normal'}
          size='small'
          showText={false}
        />
      </div>

      {/* Counters row */}
      <div className='grid grid-cols-3 gap-8px'>
        <div className='flex flex-col items-center justify-center p-8px rd-8px bg-fill-2'>
          <span className='text-16px font-600 text-t-primary'>{snapshot?.items.length ?? 0}</span>
          <span className='text-11px text-t-tertiary'>{t('ide.memory.stats.notes', { defaultValue: 'Notes' })}</span>
        </div>
        <div className='flex flex-col items-center justify-center p-8px rd-8px bg-fill-2'>
          <span className='text-16px font-600 text-t-primary'>{snapshot?.recalls ?? 0}</span>
          <span className='text-11px text-t-tertiary'>
            {t('ide.memory.stats.recalls', { defaultValue: 'Recalls' })}
          </span>
        </div>
        <div className='flex flex-col items-center justify-center p-8px rd-8px bg-fill-2'>
          <span className='text-16px font-600 text-t-primary'>{snapshot?.deduped ?? 0}</span>
          <span className='text-11px text-t-tertiary'>
            {t('ide.memory.stats.deduped', { defaultValue: 'Deduped' })}
          </span>
        </div>
      </div>

      {/* Notes list */}
      <div className='flex-1 overflow-y-auto min-h-0 flex flex-col gap-10px pr-4px'>
        {isEmpty ? (
          <div className='size-full flex-center py-24px'>
            <Empty description={t('ide.memory.empty', { defaultValue: 'No memories recorded yet' })} />
          </div>
        ) : (
          <>
            {groups.pinned.length > 0 && (
              <div className='flex flex-col gap-6px'>
                <span className='text-11px font-600 uppercase text-t-tertiary flex items-center gap-4px'>
                  <Pin theme='filled' size={12} className='text-primary' />
                  {t('ide.memory.section.pinned', { defaultValue: 'Pinned Notes' })}
                </span>
                {groups.pinned.map((item) => (
                  <MemoryItemRow key={item.id} item={item} kindLabel={kindLabels[item.kind]} />
                ))}
              </div>
            )}

            {groups.recent.length > 0 && (
              <div className='flex flex-col gap-6px'>
                <span className='text-11px font-600 uppercase text-t-tertiary'>
                  {t('ide.memory.section.recent', { defaultValue: 'Session Memory' })}
                </span>
                {groups.recent.map((item) => (
                  <MemoryItemRow key={item.id} item={item} kindLabel={kindLabels[item.kind]} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick-add composer */}
      <QuickAddNote
        remember={remember}
        kindOptions={recordableKindOptions}
        labels={{
          placeholder: t('ide.memory.quickAdd.placeholder', {
            defaultValue: 'Remember a fact, decision, todo, or note...',
          }),
          add: t('common.add', { defaultValue: 'Remember' }),
          pin: t('ide.memory.quickAdd.pin', { defaultValue: 'Pin to protect from summarisation' }),
          kind: t('ide.memory.quickAdd.kind', { defaultValue: 'Category' }),
          saved: t('ide.memory.quickAdd.saved', { defaultValue: 'Remembered' }),
        }}
      />
    </div>
  );
};

const MemoryItemRow: React.FC<{ item: SuperMemoryItem; kindLabel: string }> = ({ item, kindLabel }) => (
  <div className='p-10px rd-8px bg-fill-2 border border-arco-2 flex flex-col gap-4px'>
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-6px'>
        <Tag size='small' color='arcoblue'>
          {kindLabel}
        </Tag>
        {item.pinned && <Pin theme='filled' size={12} className='text-primary' />}
      </div>
      <span className='text-11px text-t-tertiary font-mono'>{item.tokens} tokens</span>
    </div>
    <p className='text-12px text-t-primary leading-relaxed whitespace-pre-wrap break-words mb-0'>{item.text}</p>
  </div>
);

export default AgentMemoryPanel;
