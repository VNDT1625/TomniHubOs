/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

const TECHNICAL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

declare const sessionIdBrand: unique symbol;
declare const executionIdBrand: unique symbol;
declare const ownerIdBrand: unique symbol;

/** A validated native sandbox session identifier. */
export type WindowsCreatorSandboxSessionId = string & { readonly [sessionIdBrand]: 'WindowsCreatorSandboxSessionId' };

/** A validated execution identifier scoped to one native sandbox session. */
export type WindowsCreatorSandboxExecutionId = string & {
  readonly [executionIdBrand]: 'WindowsCreatorSandboxExecutionId';
};

/** A validated owner identity that prevents cross-project session control. */
export type WindowsCreatorSandboxOwnerId = string & { readonly [ownerIdBrand]: 'WindowsCreatorSandboxOwnerId' };

export type WindowsCreatorSandboxLifecycleCode =
  | 'SESSION_OPENED'
  | 'EXECUTION_STARTED'
  | 'NATIVE_REQUEST_FAILED'
  | 'SESSION_DESTROYED'
  | 'BOUNDARY_DISPOSED'
  | 'PROCESS_EXITED';

/**
 * Safe lifecycle data for diagnostics. It intentionally excludes commands, paths, payloads,
 * native error text, prompts, source content, and owner identity.
 */
export type WindowsCreatorSandboxLifecycleEvent =
  | {
      type: 'session-opened';
      code: 'SESSION_OPENED';
      occurredAt: number;
      sessionId: WindowsCreatorSandboxSessionId;
    }
  | {
      type: 'execution-started';
      code: 'EXECUTION_STARTED';
      occurredAt: number;
      sessionId: WindowsCreatorSandboxSessionId;
      executionId: WindowsCreatorSandboxExecutionId;
    }
  | {
      type: 'execution-failed' | 'execution-terminated';
      code: Exclude<WindowsCreatorSandboxLifecycleCode, 'SESSION_OPENED' | 'EXECUTION_STARTED'>;
      occurredAt: number;
      sessionId: WindowsCreatorSandboxSessionId;
      executionId: WindowsCreatorSandboxExecutionId;
    }
  | {
      type: 'session-disposed';
      code: 'SESSION_DESTROYED' | 'BOUNDARY_DISPOSED' | 'PROCESS_EXITED';
      occurredAt: number;
      sessionId: WindowsCreatorSandboxSessionId;
    };

export type WindowsCreatorSandboxLifecycleSession = {
  readonly sessionId: WindowsCreatorSandboxSessionId;
  readonly ownerId: WindowsCreatorSandboxOwnerId;
};

export type WindowsCreatorSandboxLifecycleExecution = {
  readonly executionId: WindowsCreatorSandboxExecutionId;
  readonly sessionId: WindowsCreatorSandboxSessionId;
};

export type WindowsCreatorSandboxExecutionLifecycleOptions = {
  now?: () => number;
  createExecutionId?: () => string;
  onEvent?: (event: WindowsCreatorSandboxLifecycleEvent) => void;
};

export type WindowsCreatorSandboxExecutionLifecycle = {
  openSession(input: { sessionId: string; ownerId: string }): WindowsCreatorSandboxLifecycleSession;
  beginExecution(session: WindowsCreatorSandboxLifecycleSession): WindowsCreatorSandboxLifecycleExecution;
  failExecution(execution: WindowsCreatorSandboxLifecycleExecution): void;
  terminateSession(
    session: WindowsCreatorSandboxLifecycleSession,
    code?: 'SESSION_DESTROYED' | 'BOUNDARY_DISPOSED' | 'PROCESS_EXITED'
  ): void;
  handleUnexpectedProcessExit(): Promise<void>;
  dispose(): Promise<void>;
};

type SessionRecord = {
  session: WindowsCreatorSandboxLifecycleSession;
  activeExecution?: WindowsCreatorSandboxLifecycleExecution;
  closed: boolean;
};

type ExecutionRecord = {
  execution: WindowsCreatorSandboxLifecycleExecution;
  terminal: boolean;
};

const requireTechnicalIdentifier = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!TECHNICAL_IDENTIFIER_PATTERN.test(normalized))
    throw new Error(`${label} must be a bounded technical identifier.`);
  return normalized;
};

const asSessionId = (value: string): WindowsCreatorSandboxSessionId =>
  requireTechnicalIdentifier(value, 'Sandbox session id') as WindowsCreatorSandboxSessionId;

const asExecutionId = (value: string): WindowsCreatorSandboxExecutionId =>
  requireTechnicalIdentifier(value, 'Sandbox execution id') as WindowsCreatorSandboxExecutionId;

const asOwnerId = (value: string): WindowsCreatorSandboxOwnerId =>
  requireTechnicalIdentifier(value, 'Sandbox owner id') as WindowsCreatorSandboxOwnerId;

/**
 * Remove any accidental extra fields before lifecycle data leaves the trusted Main-process
 * boundary. The returned event is intentionally correlation-only telemetry.
 */
export const redactWindowsCreatorSandboxLifecycleEvent = (
  event: WindowsCreatorSandboxLifecycleEvent
): WindowsCreatorSandboxLifecycleEvent => {
  switch (event.type) {
    case 'session-opened':
      return {
        type: 'session-opened',
        code: 'SESSION_OPENED',
        occurredAt: event.occurredAt,
        sessionId: event.sessionId,
      };
    case 'execution-started':
      return {
        type: 'execution-started',
        code: 'EXECUTION_STARTED',
        occurredAt: event.occurredAt,
        sessionId: event.sessionId,
        executionId: event.executionId,
      };
    case 'execution-failed':
    case 'execution-terminated':
      return {
        type: event.type,
        code: event.code,
        occurredAt: event.occurredAt,
        sessionId: event.sessionId,
        executionId: event.executionId,
      };
    case 'session-disposed':
      return {
        type: 'session-disposed',
        code: event.code,
        occurredAt: event.occurredAt,
        sessionId: event.sessionId,
      };
  }
};

/**
 * Keep native execution ownership and cleanup state in the Main process. This is not a
 * substitute for Windows containment; it only tracks an already-admitted native helper.
 */
export const createWindowsCreatorSandboxExecutionLifecycle = (
  options: WindowsCreatorSandboxExecutionLifecycleOptions = {}
): WindowsCreatorSandboxExecutionLifecycle => {
  const now = options.now ?? (() => Date.now());
  const createExecutionId = options.createExecutionId ?? (() => `execution-${randomUUID()}`);
  const sessions = new Map<WindowsCreatorSandboxSessionId, SessionRecord>();
  const executions = new Map<WindowsCreatorSandboxExecutionId, ExecutionRecord>();
  let disposed = false;
  let disposeInFlight: Promise<void> | undefined;

  const emit = (event: WindowsCreatorSandboxLifecycleEvent): void => {
    try {
      options.onEvent?.(redactWindowsCreatorSandboxLifecycleEvent(event));
    } catch {
      // Diagnostics are never allowed to weaken lifecycle cleanup.
    }
  };

  const requireOwnedSession = (session: WindowsCreatorSandboxLifecycleSession): SessionRecord => {
    const sessionId = asSessionId(session.sessionId);
    const ownerId = asOwnerId(session.ownerId);
    const record = sessions.get(sessionId);
    if (!record || record.session.ownerId !== ownerId) {
      throw new Error('Sandbox session is not owned by this lifecycle manager.');
    }
    return record;
  };

  const closeSession = (
    record: SessionRecord,
    code: 'SESSION_DESTROYED' | 'BOUNDARY_DISPOSED' | 'PROCESS_EXITED'
  ): void => {
    if (record.closed) return;
    record.closed = true;
    const execution = record.activeExecution;
    if (execution) {
      const executionRecord = executions.get(execution.executionId);
      if (executionRecord && !executionRecord.terminal) {
        executionRecord.terminal = true;
        emit({
          type: 'execution-terminated',
          code,
          occurredAt: now(),
          sessionId: execution.sessionId,
          executionId: execution.executionId,
        });
      }
      executions.delete(execution.executionId);
      record.activeExecution = undefined;
    }
    emit({ type: 'session-disposed', code, occurredAt: now(), sessionId: record.session.sessionId });
  };

  const disposeWith = (code: 'BOUNDARY_DISPOSED' | 'PROCESS_EXITED'): Promise<void> => {
    if (disposeInFlight) return disposeInFlight;
    disposed = true;
    disposeInFlight = Promise.resolve();
    for (const record of sessions.values()) closeSession(record, code);
    sessions.clear();
    executions.clear();
    return disposeInFlight;
  };

  return {
    openSession: ({ sessionId: rawSessionId, ownerId: rawOwnerId }) => {
      if (disposed) throw new Error('Sandbox lifecycle manager is disposed.');
      const sessionId = asSessionId(rawSessionId);
      const ownerId = asOwnerId(rawOwnerId);
      if (sessions.has(sessionId)) throw new Error('Sandbox session id is already owned by this lifecycle manager.');
      const session = { sessionId, ownerId };
      sessions.set(sessionId, { session, closed: false });
      emit({ type: 'session-opened', code: 'SESSION_OPENED', occurredAt: now(), sessionId });
      return session;
    },
    beginExecution: (session) => {
      if (disposed) throw new Error('Sandbox lifecycle manager is disposed.');
      const record = requireOwnedSession(session);
      if (record.closed) throw new Error('Sandbox session is already disposed.');
      if (record.activeExecution) return record.activeExecution;
      let executionId: WindowsCreatorSandboxExecutionId | undefined;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = asExecutionId(createExecutionId());
        if (!executions.has(candidate)) {
          executionId = candidate;
          break;
        }
      }
      if (!executionId) throw new Error('Sandbox execution id generator repeated an existing identifier.');
      const execution = { executionId, sessionId: record.session.sessionId };
      record.activeExecution = execution;
      executions.set(executionId, { execution, terminal: false });
      emit({
        type: 'execution-started',
        code: 'EXECUTION_STARTED',
        occurredAt: now(),
        sessionId: execution.sessionId,
        executionId: execution.executionId,
      });
      return execution;
    },
    failExecution: (execution) => {
      const executionId = asExecutionId(execution.executionId);
      const record = executions.get(executionId);
      if (!record || record.execution.sessionId !== asSessionId(execution.sessionId) || record.terminal) return;
      record.terminal = true;
      const session = sessions.get(record.execution.sessionId);
      if (session?.activeExecution?.executionId === executionId) session.activeExecution = undefined;
      executions.delete(executionId);
      emit({
        type: 'execution-failed',
        code: 'NATIVE_REQUEST_FAILED',
        occurredAt: now(),
        sessionId: record.execution.sessionId,
        executionId,
      });
    },
    terminateSession: (session, code = 'SESSION_DESTROYED') => {
      if (disposed) return;
      closeSession(requireOwnedSession(session), code);
    },
    handleUnexpectedProcessExit: () => disposeWith('PROCESS_EXITED'),
    dispose: () => disposeWith('BOUNDARY_DISPOSED'),
  };
};
