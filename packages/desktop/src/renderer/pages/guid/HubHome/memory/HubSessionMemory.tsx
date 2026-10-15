import type { IdeMemoryRecordableKind } from '@/renderer/services/sessionMemoryClient';
import { Checkbox, Input, Tooltip } from '@arco-design/web-react';
import { Brain, Plus, Pin, RefreshCw, Search, Trash2, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeMemory } from './useHomeMemory';

export type HubSessionMemoryProps = {
  /** Actual native agent conversation id; Main resolves its private memory identity. */
  sessionId?: string | null;
  sessionName?: string;
  active: boolean;
};

const KINDS: readonly IdeMemoryRecordableKind[] = ['note', 'fact', 'decision', 'todo', 'snippet'];

const tools = (label: string, icon: React.ReactNode, onClick: () => void, unavailable = false) => (
  <Tooltip content={label} mini>
    <button type='button' className='hub-memory-tool' aria-label={label} disabled={unavailable} onClick={onClick}>
      {icon}
    </button>
  </Tooltip>
);

export const HubSessionMemory: React.FC<HubSessionMemoryProps> = ({ sessionId = null, sessionName, active }) => {
  const { t } = useTranslation();
  const key = (name: string) => t(`guid.hubHome.memory.${name}`);
  const memory = useHomeMemory(sessionId, active);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<IdeMemoryRecordableKind>('note');
  const [pinned, setPinned] = useState(false);
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;

  useEffect(() => {
    setQuery('');
    setFilter('all');
    setSelected(null);
    setAdding(false);
    setText('');
    setKind('note');
    setPinned(false);
  }, [sessionId]);

  const snapshot = memory.snapshot;
  const items = (snapshot?.items ?? []).filter(
    (item) =>
      (filter === 'all' || (filter === 'pinned' ? item.pinned : item.kind === filter)) &&
      item.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const disabled = memory.loading || memory.busy;
  const save = async (): Promise<void> => {
    const id = sessionId;
    if (await memory.remember(text, kind, pinned)) {
      if (currentSession.current !== id) return;
      setText('');
      setPinned(false);
      setAdding(false);
    }
  };

  if (!sessionId) {
    return (
      <div className='hub-session-memory'>
        <div className='hub-memory-empty'>
          <Brain size={24} aria-hidden='true' />
          <span>{key('selectAgent')}</span>
        </div>
      </div>
    );
  }

  return (
    <section className='hub-session-memory' aria-label={key('title')} aria-busy={disabled}>
      <div className='hub-memory-heading'>
        <span className='hub-memory-session-name' title={sessionName || sessionId}>
          {sessionName || sessionId}
        </span>
        {tools(
          key('refresh'),
          <RefreshCw size={15} className={memory.loading ? 'hub-icon-loading' : undefined} />,
          () => void memory.refresh(),
          disabled
        )}
        {tools(key('add'), <Plus size={15} />, () => setAdding((value) => !value), disabled || !snapshot)}
        {tools(key('clear'), <Trash2 size={15} />, () => void memory.clear(), disabled || !snapshot?.items.length)}
      </div>
      <p className='hub-secret-boundary'>{key('hint')}</p>
      <div className='hub-memory-search'>
        <Input
          size='mini'
          prefix={<Search size={14} />}
          aria-label={key('search')}
          placeholder={key('search')}
          value={query}
          onChange={setQuery}
          allowClear
        />
        <select aria-label={key('filter')} value={filter} onChange={(event) => setFilter(event.target.value)}>
          {['all', 'pinned', ...KINDS, 'summary'].map((value) => (
            <option key={value} value={value}>
              {key(value === 'all' || value === 'pinned' ? value : `kind.${value}`)}
            </option>
          ))}
        </select>
      </div>
      {snapshot && (
        <div className='hub-memory-budget'>
          <span>{t('guid.hubHome.memory.usage', { used: snapshot.tokensUsed, budget: snapshot.tokenBudget })}</span>
          <progress aria-label={key('budget')} max={Math.max(1, snapshot.tokenBudget)} value={snapshot.tokensUsed} />
        </div>
      )}
      {memory.error && (
        <div className='hub-memory-error' role='alert'>
          {key(`errors.${memory.error}`)}
        </div>
      )}
      {adding && (
        <form
          className='hub-memory-composer'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className='hub-memory-composer-heading'>
            <span>{key('add')}</span>
            {tools(key('cancel'), <X size={14} />, () => setAdding(false), memory.busy)}
          </div>
          <Input.TextArea
            aria-label={key('note')}
            placeholder={key('note')}
            value={text}
            onChange={setText}
            maxLength={12000}
            autoSize={{ minRows: 3, maxRows: 6 }}
            disabled={memory.busy}
          />
          <div className='hub-memory-composer-options'>
            <select
              aria-label={key('category')}
              value={kind}
              disabled={memory.busy}
              onChange={(event) => {
                const value = event.target.value;
                if (KINDS.includes(value as IdeMemoryRecordableKind)) setKind(value as IdeMemoryRecordableKind);
              }}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {key(`kind.${value}`)}
                </option>
              ))}
            </select>
            <Checkbox checked={pinned} onChange={setPinned} disabled={memory.busy}>
              {key('pin')}
            </Checkbox>
            <button type='submit' className='hub-memory-save' disabled={disabled || !text.trim()}>
              <Plus size={13} />
              {key('remember')}
            </button>
          </div>
        </form>
      )}
      <div className='hub-memory-list'>
        {memory.loading && !snapshot && (
          <div className='hub-memory-empty' role='status'>
            {key('loading')}
          </div>
        )}
        {!memory.loading && !memory.error && !items.length && (
          <div className='hub-memory-empty'>{key(query || filter !== 'all' ? 'noMatches' : 'empty')}</div>
        )}
        {items.map((item) => (
          <article className='hub-memory-item' key={item.id}>
            <button
              type='button'
              className='hub-memory-item-heading'
              aria-expanded={selected === item.id}
              onClick={() => setSelected(selected === item.id ? null : item.id)}
            >
              <span className='hub-memory-item-kind'>{key(`kind.${item.kind}`)}</span>
              {item.pinned && <Pin size={12} aria-label={key('pinned')} />}
              <span className='hub-memory-item-preview'>{item.text}</span>
            </button>
            {selected === item.id && (
              <div className='hub-memory-item-detail'>
                <p>{item.text}</p>
                <span>{t('guid.hubHome.memory.itemTokens', { count: item.tokens })}</span>
                {tools(
                  key('forget'),
                  <Trash2 size={13} />,
                  () => {
                    setSelected(null);
                    void memory.forget(item.id);
                  },
                  disabled
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {snapshot && (
        <div className='hub-memory-status' role='status'>
          {t('guid.hubHome.memory.items', { count: snapshot.items.length })}
          {snapshot.truncated && <span>{key('truncated')}</span>}
        </div>
      )}
    </section>
  );
};
