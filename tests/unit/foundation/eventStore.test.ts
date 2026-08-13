import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoundationEvent } from '../../../packages/desktop/src/common/foundation/receiptTypes';
import { JsonlDurableEventStore } from '../../../packages/desktop/src/process/services/agentChat/durability';
import { EventStore } from '../../../packages/desktop/src/process/foundation/eventStore';

const temporaryDirectories: string[] = [];

const createEvent = (sequence: number): FoundationEvent => ({
  eventId: `evt-run-1-${String(sequence)}`,
  eventType: sequence === 0 ? 'run.created' : 'outcome.verified',
  aggregateId: 'run-1',
  runId: 'run-1',
  taskId: 'task-1',
  sequence,
  correlationId: 'corr-1',
  occurredAt: 1_700_000_000_000 + sequence,
  schemaVersion: 1,
  payload:
    sequence === 0
      ? { goal: 'Summarize this document', surface: 'hub', workspaceScope: 'workspace' }
      : { status: 'verified' },
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Foundation EventStore durability', () => {
  it('commits an event only after the append-only journal accepts it and rebuilds it after restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-foundation-events-'));
    temporaryDirectories.push(directory);
    const journalPath = path.join(directory, 'foundation.jsonl');

    const writer = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    await writer.initialize();
    await writer.appendDurably(createEvent(0), 'run-1:create');
    await writer.appendDurably(createEvent(1), 'run-1:verified');

    const reader = new EventStore({ journal: new JsonlDurableEventStore(journalPath) });
    await reader.initialize();

    expect(reader.getEventsByRunId('run-1')).toEqual([createEvent(0), createEvent(1)]);
    expect(() => writer.append(createEvent(1), 'run-1:verified')).toThrow('Duplicate event idempotency key');
    await expect(reader.appendDurably(createEvent(1), 'run-1:verified')).rejects.toThrow(
      'Duplicate event idempotency key'
    );
  });

  it('rejects any event after a run reaches a terminal state', () => {
    const store = new EventStore();
    store.append(createEvent(0));
    store.append(createEvent(1));

    expect(() =>
      store.append({
        ...createEvent(1),
        eventId: 'evt-run-1-after-terminal',
        eventType: 'lease.released',
        sequence: 2,
      })
    ).toThrow('Cannot append event after terminal state');
  });
});
