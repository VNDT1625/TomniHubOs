/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry journal append (2026-10-16). Each append writes one hash-chained line instead of rewriting the whole
 * journal. The test checks the chain on disk after several appends, a reload, and that the file stays canonical.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlCoreTelemetrySink } from '@process/services/diagnostics/coreTelemetry/repository';

const GENESIS = '0'.repeat(64);

const envelopeHash = (sequence: number, previousHash: string, event: unknown): string =>
  createHash('sha256').update(JSON.stringify({ sequence, previousHash, event })).digest('hex');

describe('JsonlCoreTelemetrySink append', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-telemetry-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('appends a verifiable hash chain and survives a reload', async () => {
    const file = path.join(directory, 'telemetry.jsonl');
    const sink = new JsonlCoreTelemetrySink(file);
    await sink.initialize();
    for (let index = 0; index < 5; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- appends must run in order to build the chain.
      await sink.append({
        kind: 'tool-started',
        runId: 'run-1',
        sessionId: 'session-1',
        at: index,
        payload: { index },
      } as never);
    }

    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(5);
    let previous = GENESIS;
    lines.forEach((line, index) => {
      const envelope = JSON.parse(line) as { sequence: number; previousHash: string; hash: string; event: unknown };
      expect(envelope.sequence).toBe(index + 1);
      expect(envelope.previousHash).toBe(previous);
      expect(envelope.hash).toBe(envelopeHash(envelope.sequence, envelope.previousHash, envelope.event));
      previous = envelope.hash;
    });

    const reloaded = new JsonlCoreTelemetrySink(file);
    expect(await reloaded.query({ runId: 'run-1' })).toHaveLength(5);
    await reloaded.append({ kind: 'completed', runId: 'run-1', sessionId: 'session-1', at: 9, payload: {} } as never);
    const after = (await readFile(file, 'utf8')).trim().split('\n');
    expect(after).toHaveLength(6);
    expect(JSON.parse(after[5] as string).sequence).toBe(6);
  });

  it('drops a torn trailing line on reload and keeps appending a valid chain', async () => {
    const file = path.join(directory, 'telemetry.jsonl');
    const seed = new JsonlCoreTelemetrySink(file);
    await seed.initialize();
    await seed.append({ kind: 'a', runId: 'r', sessionId: 's', at: 1, payload: {} } as never);
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, '{"sequence":2,"previousHash":"bad"', 'utf8');

    const reloaded = new JsonlCoreTelemetrySink(file);
    await reloaded.append({ kind: 'b', runId: 'r', sessionId: 's', at: 2, payload: {} } as never);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] as string).sequence).toBe(2);
  });
});
