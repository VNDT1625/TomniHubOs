/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import { ipcBridge } from '@/common';
import { hubActivityChannels, type HubActivityToolTrace } from '@/common/types/agent/hubActivity';
import type { TMessage } from '@/common/chat/chatLib';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import { Activity, CheckCircle2, CircleAlert, CircleDot, Clock3 } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { displayToolValue, extractToolTraceRows, type ToolTraceRow } from './toolTraceModel';

const PAGE_SIZE = 80;

type TraceGroup =
  | { kind: 'single'; call: ToolTraceRow }
  | { kind: 'workflow'; id: string; calls: ToolTraceRow[] };

const groupWorkflowCalls = (rows: ToolTraceRow[]): TraceGroup[] => {
  const groups: TraceGroup[] = [];
  const workflows = new Map<string, Extract<TraceGroup, { kind: 'workflow' }>>();
  for (const call of rows) {
    if (!call.workflowId) {
      groups.push({ kind: 'single', call });
      continue;
    }
    let group = workflows.get(call.workflowId);
    if (!group) {
      group = { kind: 'workflow', id: call.workflowId, calls: [] };
      groups.push(group);
      workflows.set(call.workflowId, group);
    }
    group.calls.push(call);
  }
  return groups;
};

/** The Workflow group expands only on demand; each child has independent I/O/time buttons. */
const WorkflowChildDetails: React.FC<{ call: ToolTraceRow; clock: number }> = ({ call, clock }) => {
  const [detail, setDetail] = useState<'input' | 'output' | 'time' | null>(null);
  const input = displayToolValue(call.input);
  const output = displayToolValue(call.output);
  const duration = call.durationMs !== undefined
    ? `${call.durationMs} ms`
    : call.status === 'running' && call.startedAtMs !== undefined
      ? `${Math.max(0, clock - call.startedAtMs)} ms`
      : '—';
  return (
    <div className='hub-inspector-workflow-tool' data-testid={`hub-workflow-tool-${call.workflowStepId ?? call.id}`}>
      <div className='hub-inspector-workflow-tool-heading'>
        <span className={`hub-inspector-step-icon--${call.status}`} aria-hidden='true'>
          {call.status === 'done' ? '✓' : call.status === 'error' ? '✕' : '◉'}
        </span>
        <strong>{call.name}</strong>
        <span className='hub-inspector-tool-duration'><Clock3 size={12} /> {duration}</span>
      </div>
      <div className='hub-inspector-workflow-tool-controls'>
        {(['input', 'output', 'time'] as const).map((key) => (
          <button
            key={key}
            type='button'
            aria-pressed={detail === key}
            onClick={() => setDetail((current) => current === key ? null : key)}
            data-testid={`hub-workflow-${key}-${call.workflowStepId ?? call.id}`}
          >
            {key === 'input' ? 'Input' : key === 'output' ? 'Output' : 'Time'}
          </button>
        ))}
      </div>
      {detail === 'input' && (
        <pre className='hub-inspector-workflow-tool-detail'>{input || 'Chưa có input trong dữ liệu đã ghi nhận.'}</pre>
      )}
      {detail === 'output' && (
        <pre className='hub-inspector-workflow-tool-detail'>{output || 'Chưa có output trong dữ liệu đã ghi nhận.'}</pre>
      )}
      {detail === 'time' && (
        <div className='hub-inspector-workflow-tool-detail'>
          <div>Thời gian chạy: {duration}</div>
          <div>Bắt đầu: {call.startedAtMs ? new Date(call.startedAtMs).toLocaleTimeString() : '—'}</div>
          <div>Hoàn tất: {call.finishedAtMs ? new Date(call.finishedAtMs).toLocaleTimeString() : '—'}</div>
        </div>
      )}
    </div>
  );
};

export const HubToolTrace: React.FC<{ item: HubActivityItem }> = ({ item }) => {
  const { t } = useTranslation();
  const conversationId = item.kind === 'agent' ? item.sourceId : undefined;
  const [stored, setStored] = useState<{ conversationId: string; calls: ToolTraceRow[] } | null>(null);
  const [live, setLive] = useState<{ id: string; calls: HubActivityToolTrace[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  // Last live payload, so an unchanged 850 ms poll does not re-render every trace row.
  const lastLivePayloadRef = useRef('');
  useEffect(() => {
    if (!conversationId || item.status !== 'running') return undefined;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 8_000);
    return () => window.clearInterval(timer);
  }, [conversationId, item.status]);

  useEffect(() => {
    if (!conversationId) return undefined;
    let alive = true;
    void ipcBridge.database.getConversationMessages
      .invoke({
        conversation_id: conversationId,
        page: 1,
        page_size: PAGE_SIZE,
        order: 'desc',
        content_mode: 'full',
      })
      .then((result) => {
        if (!alive) return;
        const chronological: TMessage[] = (result.items ?? []).toSorted(
          (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
        );
        setStored({ conversationId, calls: extractToolTraceRows(chronological) });
      })
      .catch((): void => undefined);
    return () => {
      alive = false;
    };
  }, [conversationId, revision, item.status === 'done' || item.status === 'error']);

  // Conversation history does not necessarily persist Tool Call events. Read
  // redacted runtime diagnostics from Main, never from raw Hub step labels.
  useEffect(() => {
    if (item.kind !== 'agent') return undefined;
    let alive = true;
    const fetch = () => {
      void hubActivityChannels.trace
        .invoke({ id: item.id })
        .then((calls) => {
          const payload = item.id + '\n' + JSON.stringify(calls);
          if (alive && payload !== lastLivePayloadRef.current) {
            lastLivePayloadRef.current = payload;
            setLive({ id: item.id, calls });
          }
        })
        .catch((): void => undefined);
    };
    fetch();
    if (item.status !== 'running' && item.status !== 'needs_input')
      return () => {
        alive = false;
      };
    const timer = window.setInterval(fetch, 850);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [item.id, item.kind, item.status]);

  const calls = useMemo<ToolTraceRow[]>(() => {
    const persisted = stored?.conversationId === conversationId ? stored.calls : [];
    const incoming = live?.id === item.id ? live.calls : [];
    const liveIds = new Set(incoming.map((call) => call.id));
    return [...persisted.filter((call) => !liveIds.has(call.id)), ...incoming];
  }, [stored, live, conversationId, item.id]);
  useEffect(() => {
    if (!calls.some((call) => call.status === 'running' && call.startedAtMs)) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [calls]);
  const knownSteps = new Set(calls.map((call) => call.id));
    const rows: ToolTraceRow[] = [
    ...item.steps
      .filter((step) => !knownSteps.has(step.id))
      .map((step) => ({
        id: step.id,
        name: step.label.split(' · ')[0] || step.label,
        description: step.label,
        status: step.state,
      })),
        ...calls,
  ];
  const groups = groupWorkflowCalls(rows);
  return (
    <div className='hub-inspector-detail-body hub-inspector-trace' data-testid='hub-tool-trace'>
      <div className='hub-inspector-heading'>
        <Activity size={14} /> {t('guid.hubHome.inspector.executionTrace', { defaultValue: 'Execution Trace' })}
      </div>
      {rows.length === 0 && (
        <p className='hub-inspector-muted'>
          {t('guid.hubHome.inspector.noSteps', { defaultValue: 'Chưa có bước thực thi được ghi nhận.' })}
        </p>
      )}
            {groups.map((group, index) => {
        if (group.kind === 'workflow') {
          const running = group.calls.filter((call) => call.status === 'running').length;
          const done = group.calls.filter((call) => call.status === 'done').length;
          const failed = group.calls.filter((call) => call.status === 'error').length;
          return (
            <details key={group.id} className='hub-inspector-workflow-group' data-testid={`hub-workflow-group-${group.id}`}>
              <summary>
                <span className='hub-inspector-workflow-group-symbol' aria-hidden='true'>↗</span>
                <strong>Workflow · {group.calls.length} tool</strong>
                <small>{done} xong · {running} đang chạy · {failed} lỗi</small>
              </summary>
              <div className='hub-inspector-workflow-group-children'>
                {group.calls.map((child) => <WorkflowChildDetails key={child.id} call={child} clock={clock} />)}
              </div>
            </details>
          );
        }
        const call = group.call;
        const Icon = call.status === 'done' ? CheckCircle2 : call.status === 'error' ? CircleAlert : CircleDot;
        const input = displayToolValue(call.input);
        const output = displayToolValue(call.output);
        return (
          <details
            key={call.id}
            className='hub-inspector-tool-call'
            open={index === rows.length - 1 && Boolean(input || output)}
          >
            <summary>
              <Icon size={15} className={`hub-inspector-step-icon--${call.status}`} />
              <span className='hub-inspector-tool-name'>
                <strong>{call.name}</strong>
                <small>{call.description}</small>
              </span>
              <span className='hub-inspector-tool-duration' title='Duration'>
                <Clock3 size={12} />
                {call.durationMs !== undefined
                  ? `${call.durationMs} ms`
                  : call.status === 'running' && call.startedAtMs !== undefined
                    ? `${Math.max(0, clock - call.startedAtMs)} ms`
                    : '—'}
              </span>
            </summary>
            <div className='hub-inspector-tool-body'>
              <span className='hub-inspector-muted'>
                {t('guid.hubHome.inspector.status', { defaultValue: 'Trạng thái' })}: {call.status}
              </span>
              {input && (
                <section>
                  <strong>{t('guid.hubHome.inspector.arguments', { defaultValue: 'Input arguments' })}</strong>
                  <pre>{input}</pre>
                </section>
              )}
              {output && (
                <section>
                  <strong>{t('guid.hubHome.inspector.result', { defaultValue: 'Tool result' })}</strong>
                  <pre>{output}</pre>
                </section>
              )}
              {call.startedAtMs && (
                <span className='hub-inspector-muted'>
                  {t('guid.hubHome.inspector.started', { defaultValue: 'Bắt đầu' })}:{' '}
                  {new Date(call.startedAtMs).toLocaleTimeString()}
                </span>
              )}
              {call.finishedAtMs && (
                <span className='hub-inspector-muted'>
                  {t('guid.hubHome.inspector.finished', { defaultValue: 'Hoàn tất' })}:{' '}
                  {new Date(call.finishedAtMs).toLocaleTimeString()}
                </span>
              )}
              {!input && !output && (
                <p className='hub-inspector-muted'>
                  {t('guid.hubHome.inspector.noDetails', {
                    defaultValue: 'Chưa có input/output trong nguồn dữ liệu này.',
                  })}
                </p>
              )}
            </div>
          </details>
        );
      })}
      <p className='hub-inspector-muted'>
        {t('guid.hubHome.inspector.durationNote', {
          defaultValue:
            'Thời gian ms chỉ xuất hiện nếu công cụ ghi nhận được. Thông tin nhạy cảm được che trước khi hiển thị.',
        })}
      </p>
    </div>
  );
};
