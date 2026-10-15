/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HubActivityItem } from '@/common/types/agent/hubActivity';

/** This is an observed lifecycle, not a plan or an invented progress percent.
 * HTML stages are only reported if actual streamed content contains HTML.
 */
export type MonitorMilestone = {
  id: 'start' | 'answer' | 'html' | 'polish' | 'finish';
  state: 'done' | 'running' | 'error';
};

export const monitorMilestones = (item: HubActivityItem): MonitorMilestone[] => {
  const finished = item.status === 'done' || item.status === 'stopped' || item.status === 'error';
  const output = item.preview ?? '';
  const hasOutput = output.trim().length > 0;
  const hasHtml = /```\s*html\b|<!doctype\s+html\b|<html[\s>]/i.test(output);
  const completeFence = /```\s*html\b[\s\S]*?```/i.test(output);
  const steps: MonitorMilestone[] = [{ id: 'start', state: 'done' }];
  if (hasOutput) steps.push({ id: 'answer', state: finished ? 'done' : hasHtml ? 'done' : 'running' });
  if (hasHtml) steps.push({ id: 'html', state: finished || completeFence ? 'done' : 'running' });
  if (hasHtml && completeFence && !finished) steps.push({ id: 'polish', state: 'running' });
  if (finished) steps.push({ id: 'finish', state: item.status === 'error' ? 'error' : 'done' });
  return steps;
};
