/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  AppendDurableEventInput,
  DurableAgentEvent,
  DurableEventQuery,
  DurableEventStore,
} from '@process/services/agentChat/durability';
import type { RustSidecarLifecycle } from './runtimeLifecycle';

export type RustHashResult = { algorithm: 'sha256'; digest: string };

export class RustRuntimeAccelerator {
  constructor(private readonly lifecycle: RustSidecarLifecycle) {}

  async sha256File(filePath: string): Promise<string> {
    const result = await this.lifecycle.requestWithFallback<RustHashResult>('hash.sha256', { filePath }, async () => ({
      algorithm: 'sha256',
      digest: createHash('sha256')
        .update(await readFile(filePath))
        .digest('hex'),
    }));
    return result.value.digest;
  }

  async sha256Bytes(bytes: Uint8Array): Promise<string> {
    const result = await this.lifecycle.requestWithFallback<RustHashResult>(
      'hash.sha256',
      { bytesBase64: Buffer.from(bytes).toString('base64') },
      async () => ({ algorithm: 'sha256', digest: createHash('sha256').update(bytes).digest('hex') })
    );
    return result.value.digest;
  }
}

const DEFAULT_MIRRORED_KINDS = new Set([
  'session.created',
  'session.updated',
  'run.started',
  'run.completed',
  'run.error',
  'run.cancelled',
  'tool.started',
  'tool.completed',
  'tool.error',
  'permission.requested',
  'permission.resolved',
  'agent.spawned',
  'agent.stopped',
]);

/**
 * Keeps the existing TypeScript journal authoritative and asynchronously mirrors
 * bounded, already-redacted lifecycle metadata to Rust. A sidecar failure can
 * never delay or invalidate the primary event chain.
 */
export class RustMirroredDurableEventStore implements DurableEventStore {
  constructor(
    private readonly primary: DurableEventStore,
    private readonly lifecycle: RustSidecarLifecycle,
    private readonly mirroredKinds: ReadonlySet<string> = DEFAULT_MIRRORED_KINDS
  ) {}

  initialize(): Promise<void> {
    return this.primary.initialize();
  }

  async append(input: AppendDurableEventInput): Promise<DurableAgentEvent> {
    const event = await this.primary.append(input);
    if (this.mirroredKinds.has(event.kind)) {
      void this.lifecycle
        .request('journal.append', {
          stream: event.sessionId,
          kind: event.kind,
          payload: event,
        })
        .catch((): void => undefined);
    }
    return event;
  }

  query(query?: DurableEventQuery): Promise<DurableAgentEvent[]> {
    return this.primary.query(query);
  }

  latestSequence(): Promise<number> {
    return this.primary.latestSequence();
  }

  replaceAll(events: DurableAgentEvent[]): Promise<void> {
    return this.primary.replaceAll(events);
  }
}
