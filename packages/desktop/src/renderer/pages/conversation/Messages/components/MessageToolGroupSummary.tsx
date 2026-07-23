import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Modal, Spin } from '@arco-design/web-react';
import { Checklist, Right } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { NormalizedToolCall, NormalizedToolStatus, ToolMessage } from '@/common/chat/normalizeToolCall';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import './MessageToolGroupSummary.css';

/** Keep the inline card readable; the full payload remains available in a bounded dialog. */
const INLINE_DETAIL_LIMIT = 2_000;

type ToolDisplayItem = NormalizedToolCall & {
  agentId?: string;
  owner?: string;
};

type DetailView = {
  label: string;
  content: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const stringifyToolInput = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * Some native tool-group producers attach the request payload to the item,
 * while older producers only provide description/result_display. Keep the
 * renderer tolerant of both shapes so a backend rollout does not require a
 * second UI change.
 */
const enrichToolItem = (item: NormalizedToolCall, messages: ToolMessage[]): ToolDisplayItem => {
  if (item.input) return item;
  for (const message of messages) {
    const messageRecord = asRecord(message);
    const rawContent = messageRecord?.content;
    const contentItems = Array.isArray(rawContent) ? rawContent : [];
    const rawItem = contentItems
      .map(asRecord)
      .find((candidate) => candidate?.call_id === item.key || candidate?.callId === item.key);
    if (!rawItem) continue;
    const input = stringifyToolInput(
      rawItem.input ?? rawItem.args ?? rawItem.arguments ?? rawItem.raw_input ?? rawItem.rawInput
    );
    const agentId = [rawItem.agentId, rawItem.agent_id, rawItem.agent, rawItem.owner].find(
      (value) => typeof value === 'string' && value.trim()
    ) as string | undefined;
    const owner = typeof rawItem.owner === 'string' && rawItem.owner.trim() ? rawItem.owner : undefined;
    return { ...item, ...(input ? { input } : {}), ...(agentId ? { agentId } : {}), ...(owner ? { owner } : {}) };
  }
  return item;
};

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
    case 'pending':
    default:
      return 'default';
  }
};

const ToolItemDetail: React.FC<{ item: ToolDisplayItem }> = ({ item }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<ToolDisplayItem | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const displayItem = fullItem ?? item;
  const hasDetail = Boolean(displayItem.input || displayItem.output || item.truncated);
  const statusLabel = {
    pending: t('messages.steps.status.pending'),
    running: t('messages.steps.status.running'),
    completed: t('messages.steps.status.completed'),
    error: t('messages.steps.status.error'),
    canceled: t('messages.steps.status.canceled'),
  }[item.status];

  const loadFullItem = async (): Promise<void> => {
    if (!item.truncated || fullItem || loadingFull || !item.conversationId || !item.messageId) return;
    setLoadingFull(true);
    setLoadError(false);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: item.conversationId,
        message_id: item.messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === item.key);
      if (next) setFullItem({ ...next, agentId: item.agentId, owner: item.owner });
    } catch {
      setLoadError(true);
    } finally {
      setLoadingFull(false);
    }
  };

  const toggleExpanded = (): void => {
    if (!hasDetail) return;
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadFullItem();
  };

  const row = (
    <>
      <Badge status={statusToBadge(item.status)} className={item.status === 'running' ? 'badge-breathing' : ''} />
      <span className='tool-step__identity'>
        <span className='tool-step__name'>{displayItem.name}</span>
        {displayItem.description && displayItem.description !== displayItem.name && (
          <span className='tool-step__description'>{displayItem.description}</span>
        )}
        {(displayItem.agentId || displayItem.owner) && (
          <span className='tool-step__owner' title={displayItem.owner || displayItem.agentId}>
            {displayItem.owner || displayItem.agentId}
          </span>
        )}
      </span>
      <span className={`tool-step__status tool-step__status--${item.status}`}>{statusLabel}</span>
      {hasDetail && (
        <span className={`tool-step__arrow${expanded ? ' tool-step__arrow--open' : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      )}
    </>
  );

  return (
    <div className='tool-step'>
      {hasDetail ? (
        <Button type='text' className='tool-step__button' aria-expanded={expanded} onClick={toggleExpanded}>
          {row}
        </Button>
      ) : (
        <div className='tool-step__row'>{row}</div>
      )}
      {expanded && hasDetail && (
        <div className='tool-detail-panel'>
          {loadingFull && <div className='tool-detail-label'>{t('messages.steps.loadingDetail')}</div>}
          {loadError && (
            <div className='tool-detail-label tool-detail-label--error'>{t('messages.steps.loadDetailFailed')}</div>
          )}
          {displayItem.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-heading'>
                <div className='tool-detail-label'>{t('messages.steps.input')}</div>
                {displayItem.input.length > INLINE_DETAIL_LIMIT && (
                  <Button
                    type='text'
                    size='mini'
                    className='tool-detail-view-full'
                    onClick={() =>
                      setDetailView({ label: t('messages.steps.input'), content: displayItem.input as string })
                    }
                  >
                    {t('messages.steps.viewFull', { defaultValue: 'View full' })}
                  </Button>
                )}
              </div>
              <pre className='tool-detail-content'>
                {displayItem.input.length > INLINE_DETAIL_LIMIT
                  ? `${displayItem.input.slice(0, INLINE_DETAIL_LIMIT)}\n…`
                  : displayItem.input}
              </pre>
            </div>
          )}
          {displayItem.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-heading'>
                <div className='tool-detail-label'>{t('messages.steps.output')}</div>
                {displayItem.output.length > INLINE_DETAIL_LIMIT && (
                  <Button
                    type='text'
                    size='mini'
                    className='tool-detail-view-full'
                    onClick={() =>
                      setDetailView({ label: t('messages.steps.output'), content: displayItem.output as string })
                    }
                  >
                    {t('messages.steps.viewFull', { defaultValue: 'View full' })}
                  </Button>
                )}
              </div>
              <pre className='tool-detail-content'>
                {displayItem.output.length > INLINE_DETAIL_LIMIT
                  ? `${displayItem.output.slice(0, INLINE_DETAIL_LIMIT)}\n…`
                  : displayItem.output}
              </pre>
            </div>
          )}
        </div>
      )}
      <Modal
        visible={Boolean(detailView)}
        title={detailView?.label}
        footer={null}
        onCancel={() => setDetailView(null)}
        style={{ width: 'min(900px, 92vw)' }}
        wrapStyle={{ zIndex: 3000 }}
      >
        {detailView && <pre className='tool-detail-full-content'>{detailView.content}</pre>}
      </Modal>
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: ToolMessage[] }> = ({ messages }) => {
  const { t } = useTranslation();
  const tools = useMemo(
    () => normalizeToolMessages(messages).map((item) => enrichToolItem(item, messages)),
    [messages]
  );
  const hasRunning = tools.some((item) => item.status === 'running');
  const [showMore, setShowMore] = useState(hasRunning);

  useEffect(() => {
    if (hasRunning) setShowMore(true);
  }, [hasRunning]);

  if (tools.length === 0) return null;

  return (
    <div className={`tool-group-summary${hasRunning ? ' tool-group-summary--running' : ''}`}>
      <Button
        type='text'
        className='tool-group-summary__header'
        aria-expanded={showMore}
        onClick={() => setShowMore((visible) => !visible)}
      >
        <span className='tool-group-summary__icon'>
          {hasRunning ? <Spin size={12} /> : <Checklist theme='outline' size='14' />}
        </span>
        <span className='tool-group-summary__label'>{t('messages.steps.title', { count: tools.length })}</span>
        {hasRunning && <span className='tool-group-summary__live'>{t('messages.steps.live')}</span>}
        <span className={`tool-group-summary__arrow${showMore ? ' tool-group-summary__arrow--open' : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </Button>
      {showMore && (
        <div className='tool-group-summary__body'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
