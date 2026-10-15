import { ipcBridge, type SessionContextBranch, type SessionContextSnapshot } from '@/common';
import { Button, Input, Message } from '@arco-design/web-react';
import { ChevronDown, ChevronRight, Layers3, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  areContextBranchesValid,
  estimateContextBranchTokens,
} from '@/renderer/components/agent/AgentSessionDrawer/contextBranchUtils';
import { buildContextOverview, type ContextSectionId } from './contextSections';

type HubSessionContextProps = {
  sessionId?: string | null;
  sessionName?: string;
  active: boolean;
};

/** A block longer than this is cut in the reader; the full text is still what the model receives. */
const MAX_READER_CHARS = 20_000;

const blankBranch = (): SessionContextBranch => ({
  id: crypto.randomUUID(),
  title: '',
  summary: '',
  content: '',
});

/** "Bộ nhớ phiên": exactly which blocks go to the agent next turn, how big each is, and the text itself. */
export const HubSessionContext: React.FC<HubSessionContextProps> = ({ sessionId = null, sessionName, active }) => {
  const { t } = useTranslation();
  const key = (name: string) => t(`guid.hubHome.context.${name}`);
  const tokens = (count: number) => t('guid.hubHome.context.tokens', { count });
  const [snapshot, setSnapshot] = useState<SessionContextSnapshot | null>(null);
  const [customContext, setCustomContext] = useState('');
  const [branches, setBranches] = useState<SessionContextBranch[]>([]);
  const [open, setOpen] = useState<ContextSectionId[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;

  const applySnapshot = useCallback((next: SessionContextSnapshot): void => {
    setSnapshot(next);
    setCustomContext(next.app.custom_context);
    setBranches(next.app.context_branches);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await ipcBridge.conversation.getSessionContext.invoke({ conversation_id: sessionId });
      if (result.ok === false) throw new Error(result.error);
      if (currentSession.current === sessionId) applySnapshot(result.data);
    } catch {
      if (currentSession.current === sessionId) setError('load');
    } finally {
      if (currentSession.current === sessionId) setLoading(false);
    }
  }, [applySnapshot, sessionId]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  useEffect(() => {
    setSnapshot(null);
    setCustomContext('');
    setBranches([]);
    setOpen([]);
    setEditing(false);
    setError(null);
  }, [sessionId]);

  const overview = useMemo(() => (snapshot ? buildContextOverview(snapshot) : null), [snapshot]);

  const save = async (): Promise<void> => {
    if (!sessionId || saving) return;
    if (!areContextBranchesValid(branches)) {
      Message.error(key('branchInvalid'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await ipcBridge.conversation.updateSessionContext.invoke({
        conversation_id: sessionId,
        custom_context: customContext,
        context_branches: branches,
      });
      if (result.ok === false) throw new Error(result.error);
      if (currentSession.current === sessionId) applySnapshot(result.data);
    } catch {
      if (currentSession.current === sessionId) setError('save');
    } finally {
      if (currentSession.current === sessionId) setSaving(false);
    }
  };

  const updateBranch = (id: string, patch: Partial<SessionContextBranch>): void => {
    setBranches((current) => current.map((branch) => (branch.id === id ? { ...branch, ...patch } : branch)));
  };

  const toggle = (id: ContextSectionId): void =>
    setOpen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  if (!sessionId) {
    return (
      <div className='hub-session-context hub-session-context--empty'>
        <Layers3 size={24} aria-hidden='true' />
        <span>{key('selectAgent')}</span>
      </div>
    );
  }

  return (
    <section className='hub-session-context' aria-label={key('title')} aria-busy={loading || saving}>
      <header className='hub-context-heading'>
        <div>
          <strong title={sessionName || sessionId}>{sessionName || sessionId}</strong>
          <span>{snapshot?.target ?? key('loading')}</span>
        </div>
        <Button size='mini' type='text' aria-label={key('refresh')} onClick={() => void refresh()} loading={loading}>
          <RefreshCw size={14} />
        </Button>
      </header>

      <div className='hub-context-summary'>
        <div>
          <strong>{key('headline')}</strong>
          <span>{key('headlineHint')}</span>
        </div>
        <strong className='hub-context-total' data-testid='hub-context-total'>
          {tokens(overview?.totalTokens ?? 0)}
        </strong>
      </div>
      {overview && !overview.native && overview.runtimeDisclosure && (
        <p className='hub-context-disclosure'>{overview.runtimeDisclosure}</p>
      )}

      {error === 'load' && (
        <div className='hub-memory-error' role='alert'>
          {key('errors.load')}
        </div>
      )}

      {overview && (
        <ul className='hub-context-sections'>
          {overview.sections.map((item) => {
            const isOpen = open.includes(item.id);
            const label =
              item.count === undefined ? key(`section.${item.id}`) : `${key(`section.${item.id}`)} (${item.count})`;
            return (
              <li className='hub-context-section' key={item.id} data-testid={`hub-context-section-${item.id}`}>
                <button
                  type='button'
                  className='hub-context-section-head'
                  aria-expanded={isOpen}
                  aria-controls={`hub-context-body-${item.id}`}
                  disabled={!item.text}
                  onClick={() => toggle(item.id)}
                >
                  {isOpen ? (
                    <ChevronDown size={14} aria-hidden='true' />
                  ) : (
                    <ChevronRight size={14} aria-hidden='true' />
                  )}
                  <span className='hub-context-section-name'>{label}</span>
                  <span className='hub-context-section-tokens'>
                    {item.text ? tokens(item.tokens) : key('emptySection')}
                  </span>
                </button>
                <progress
                  className='hub-context-section-bar'
                  aria-label={label}
                  max={Math.max(1, overview.totalTokens)}
                  value={item.tokens}
                />
                <small className='hub-context-section-hint'>{key(`sectionHint.${item.id}`)}</small>
                {isOpen && (
                  <div id={`hub-context-body-${item.id}`} className='hub-context-section-body'>
                    <pre>{item.text.slice(0, MAX_READER_CHARS)}</pre>
                    {item.text.length > MAX_READER_CHARS && <small>{key('readerTruncated')}</small>}
                  </div>
                )}
              </li>
            );
          })}
          <li className='hub-context-section hub-context-section--muted' data-testid='hub-context-section-history'>
            <div className='hub-context-section-head'>
              <span className='hub-context-section-name'>{key('section.history')}</span>
              <span className='hub-context-section-tokens'>{key('historyBadge')}</span>
            </div>
            <small className='hub-context-section-hint'>
              {t('guid.hubHome.context.historyHint', {
                messages: overview.archive.messages,
                tokens: overview.archive.tokens,
              })}
            </small>
          </li>
        </ul>
      )}
      {!overview && loading && <p className='hub-context-disclosure'>{key('loading')}</p>}

      <Button size='small' type='secondary' onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
        <Pencil size={14} /> {key('edit')}
      </Button>
      {editing && (
        <div className='hub-context-editor'>
          <label className='hub-context-field'>
            <span>{key('custom')}</span>
            <Input.TextArea
              value={customContext}
              onChange={setCustomContext}
              maxLength={24000}
              autoSize={{ minRows: 3, maxRows: 7 }}
              disabled={saving}
            />
          </label>
          <div className='hub-context-branches'>
            <div className='hub-context-branches-heading'>
              <span>{key('branches')}</span>
              <Button
                size='mini'
                type='text'
                disabled={saving || branches.length >= 12}
                onClick={() => setBranches((current) => [...current, blankBranch()])}
              >
                <Plus size={14} /> {key('addBranch')}
              </Button>
            </div>
            {branches.map((branch) => (
              <article className='hub-context-branch' key={branch.id}>
                <div className='hub-context-branch-actions'>
                  <Input
                    size='mini'
                    aria-label={key('branchTitle')}
                    value={branch.title}
                    onChange={(title) => updateBranch(branch.id, { title })}
                    placeholder={key('branchTitle')}
                  />
                  <Button
                    size='mini'
                    type='text'
                    aria-label={key('removeBranch')}
                    onClick={() => setBranches((current) => current.filter((item) => item.id !== branch.id))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                <Input
                  size='mini'
                  aria-label={key('branchSummary')}
                  value={branch.summary}
                  onChange={(summary) => updateBranch(branch.id, { summary })}
                  placeholder={key('branchSummary')}
                />
                <Input.TextArea
                  aria-label={key('branchContent')}
                  value={branch.content}
                  onChange={(content) => updateBranch(branch.id, { content })}
                  maxLength={8000}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  placeholder={key('branchContent')}
                />
                <small>{tokens(estimateContextBranchTokens(branch.content))}</small>
              </article>
            ))}
          </div>
          {error === 'save' && (
            <div className='hub-memory-error' role='alert'>
              {key('errors.save')}
            </div>
          )}
          <p className='hub-context-cache-note'>{key('cacheNote')}</p>
          <Button type='primary' size='small' onClick={() => void save()} loading={saving}>
            <Save size={14} /> {key('save')}
          </Button>
        </div>
      )}
    </section>
  );
};
