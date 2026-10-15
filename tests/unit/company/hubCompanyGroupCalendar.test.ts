/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { RoleNode } from '@process/company/companyOrchestrator';
import {
  createEvent,
  dueOccurrence,
  latestOccurrence,
  MAX_STEPS,
  occurrencesBetween,
  sanitizeMeta,
  splitChatKey,
  type GroupEvent,
} from '@/renderer/pages/guid/HubHome/company/group/groupMeta';
import { buildGroupPrompt, buildWorkflowStepPrompt } from '@/renderer/pages/guid/HubHome/company/group/groupPrompts';

const DAY = 86_400_000;
/** Monday 2026-10-05 09:00 local time. */
const MONDAY = new Date(2026, 9, 5, 9, 0).getTime();

const event = (patch: Partial<GroupEvent> = {}): GroupEvent => ({
  id: 'e',
  title: 'Standup',
  startsAt: MONDAY,
  repeat: 'none',
  attendees: [],
  enabled: true,
  ...patch,
});

describe('group calendar', () => {
  it('finds the latest occurrence of one-time and repeating events', () => {
    expect(latestOccurrence(event(), MONDAY - 1)).toBeNull();
    expect(latestOccurrence(event(), MONDAY + 3 * DAY)).toBe(MONDAY);
    expect(latestOccurrence(event({ repeat: 'daily' }), MONDAY + 2 * DAY + 60_000)).toBe(MONDAY + 2 * DAY);
    expect(latestOccurrence(event({ repeat: 'weekly' }), MONDAY + 10 * DAY)).toBe(MONDAY + 7 * DAY);
    // Sunday after a weekdays event: the latest occurrence is Friday.
    expect(latestOccurrence(event({ repeat: 'weekdays' }), MONDAY + 6 * DAY + 60_000)).toBe(MONDAY + 4 * DAY);
  });

  it('fires each occurrence once and never while paused', () => {
    const daily = event({ repeat: 'daily' });
    const now = MONDAY + DAY + 1;
    expect(dueOccurrence(daily, now)).toBe(MONDAY + DAY);
    expect(dueOccurrence({ ...daily, lastFiredAt: MONDAY + DAY }, now)).toBeNull();
    expect(dueOccurrence({ ...daily, enabled: false }, now)).toBeNull();
    // Missed while the app was closed: only the latest occurrence fires, no backlog.
    expect(dueOccurrence({ ...daily, lastFiredAt: MONDAY }, MONDAY + 5 * DAY + 1)).toBe(MONDAY + 5 * DAY);
  });

  it('does not fire a new event for times already past', () => {
    const past = createEvent({ title: 'x', startsAt: MONDAY, repeat: 'daily', attendees: [] }, MONDAY + DAY + 5);
    expect(dueOccurrence(past, MONDAY + DAY + 10)).toBeNull();
    expect(dueOccurrence(past, MONDAY + 2 * DAY)).toBe(MONDAY + 2 * DAY);
    const future = createEvent({ title: 'y', startsAt: MONDAY + DAY, repeat: 'none', attendees: [] }, MONDAY);
    expect(dueOccurrence(future, MONDAY + DAY)).toBe(MONDAY + DAY);
  });

  it('lists the occurrences of a week, skipping weekends for weekdays events', () => {
    const week = occurrencesBetween(event({ repeat: 'weekdays' }), MONDAY - DAY, MONDAY + 6 * DAY);
    expect(week).toEqual([0, 1, 2, 3, 4].map((n) => MONDAY + n * DAY));
    expect(occurrencesBetween(event(), MONDAY + DAY, MONDAY + 2 * DAY)).toEqual([]);
  });

  it('repairs and bounds stored settings', () => {
    const meta = sanitizeMeta({
      goal: 'g'.repeat(900),
      events: [{ id: 'a', startsAt: 1, repeat: 'hourly' }, { title: 'no id' }],
      workflows: [{ id: 'w', name: 'W', steps: Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, roleId: 'r' })) }],
    });
    expect(meta.goal).toHaveLength(600);
    expect(meta.events).toHaveLength(1);
    expect(meta.events[0].repeat).toBe('none');
    expect(meta.workflows[0].steps).toHaveLength(MAX_STEPS);
    expect(sanitizeMeta('garbage')).toEqual({ goal: '', events: [], workflows: [] });
    expect(splitChatKey('acme::g1')).toEqual({ companyId: 'acme', groupId: 'g1' });
  });
});

describe('group prompts', () => {
  const role = (id: string, name: string): RoleNode => ({ id, role: 'worker', name, children: [] });
  const group = { id: 'g', name: 'Web', leader: role('lead', 'Lead'), members: [role('fe', 'Frontend')] };

  it('carries the shared goal', () => {
    const prompt = buildGroupPrompt({
      companyName: 'Acme',
      group,
      role: group.leader,
      guest: false,
      unseen: [],
      goal: 'Ship v1',
    });
    expect(prompt).toContain('Shared group goal: Ship v1');
  });

  it('gives a workflow step its instruction and the previous output', () => {
    const prompt = buildWorkflowStepPrompt({
      companyName: 'Acme',
      group,
      role: group.members[0],
      workflowName: 'Release',
      step: 2,
      total: 3,
      instruction: 'Build the page',
      previous: { name: 'Lead', output: 'Spec: hero + pricing' },
      unseen: [{ id: '1', from: 'calendar', name: 'Release day', text: 'Go', at: 0 }],
    });
    expect(prompt).toContain('step 2 of 3 of the group workflow "Release"');
    expect(prompt).toContain('Your task for this step: Build the page');
    expect(prompt).toContain('Spec: hero + pricing');
    expect(prompt).toContain('Calendar event "Release day": Go');
  });
});
