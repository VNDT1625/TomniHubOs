/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace IPC bridge — exposes the {@link IWorkspaceOrchestrator} to the
 * renderer Workspace page so a single chat turn can fan out into several
 * sub-agents, each on its own live surface (browser tab / editor file).
 *
 * Built with the same `@office-ai/platform` `bridge` helper as the sibling
 * `browserBridge` / `companyBridge`. Channels:
 *
 * - `workspace.run`     — start a run (list of surface specs). Long-lived: no
 *   timeout, progress observed via the emitter. Resolves with the final result.
 * - `workspace.cancel`  — cancel every surface of a run.
 * - `workspace.event`   — main → renderer push of per-surface lifecycle + tool
 *   narration (boxed in an envelope to keep the union non-distributive, the same
 *   pattern `browserBridge.agentEvent` uses).
 *
 * Optional Browser and IDE packages register their own Surface runners. Base
 * Workspace stays package-neutral and fails an unavailable Surface before it
 * acquires a resource lease; it never imports an optional application runtime.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';
import { createWorkspaceOrchestrator, type IWorkspaceOrchestrator } from './workspaceOrchestrator';
import type { SurfaceSpec, WorkspaceEvent, WorkspaceRunResult } from './surfaceTypes';

// ---------------------------------------------------------------------------
// Channel names (renderer-safe contract)
// ---------------------------------------------------------------------------

/** IPC channel names for the workspace surface. Safe to import from the renderer. */
export const WORKSPACE_CHANNELS = {
  run: 'workspace.run',
  cancel: 'workspace.cancel',
  event: 'workspace.event',
} as const;

/** Request for {@link WORKSPACE_CHANNELS.run}. */
export type RunWorkspaceBridgeRequest = {
  /** Stable id for this run (renderer-generated). */
  runId: string;
  /** The sub-agent tasks to run concurrently. */
  surfaces: SurfaceSpec[];
};

/** Request addressing a run by id (cancel). */
export type WorkspaceRunIdRequest = {
  /** Stable id of the run to cancel. */
  runId: string;
};

/**
 * Envelope wrapping a streamed {@link WorkspaceEvent}. Boxing the union keeps the
 * platform `buildEmitter<Params>` conditional non-distributive (same reason as
 * `browserBridge.AgentEventEnvelope`).
 */
export type WorkspaceEventEnvelope = {
  /** The streamed per-surface lifecycle / narration event. */
  event: WorkspaceEvent;
};

/** Typed workspace channels. Exported for bootstrap registration wiring. */
export const workspaceChannels = {
  run: bridge.buildProvider<WorkspaceRunResult, RunWorkspaceBridgeRequest>(WORKSPACE_CHANNELS.run),
  cancel: bridge.buildProvider<void, WorkspaceRunIdRequest>(WORKSPACE_CHANNELS.cancel),
  event: bridge.buildEmitter<WorkspaceEventEnvelope>(WORKSPACE_CHANNELS.event),
};

// ---------------------------------------------------------------------------
// Shared services
// ---------------------------------------------------------------------------

/** The Main-process services the workspace bridge operates on. */
export type WorkspaceServices = {
  /** The orchestrator that runs surfaces concurrently. */
  orchestrator: IWorkspaceOrchestrator;
};

/** Lazily-built default services, shared across repeated registrations. */
let defaultServices: WorkspaceServices | undefined;

/**
 * Resolve the shared {@link WorkspaceServices}. Base Workspace has no default
 * Surface runner: optional package runners must be registered by their owning
 * package lifecycle instead of being imported by base Workspace.
 */
export const getWorkspaceServices = (): WorkspaceServices => {
  if (defaultServices) return defaultServices;

  const orchestrator = createWorkspaceOrchestrator({ runners: {} });
  defaultServices = { orchestrator };
  return defaultServices;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Options for {@link registerWorkspaceBridge}. */
export type RegisterWorkspaceBridgeOptions = {
  /** Override the shared services entirely (tests / advanced bootstrap). */
  services?: WorkspaceServices;
};

/** Resolve the {@link WorkspaceServices} to wire. */
const resolveServices = (options: RegisterWorkspaceBridgeOptions): WorkspaceServices => {
  if (options.services) return options.services;
  return getWorkspaceServices();
};

/**
 * Register the workspace IPC handlers. Idempotent (re-registration replaces the
 * bound handlers). Intended to be invoked once during Main-process bootstrap.
 *
 * @param options Injected services and/or the main-window accessor.
 */
export function registerWorkspaceBridge(options: RegisterWorkspaceBridgeOptions = {}): void {
  const services = resolveServices(options);

  // Start a run. Long-lived: each surface streams progress through the emitter;
  // the resolved value is the final per-surface state.
  workspaceChannels.run.provider((request) =>
    services.orchestrator.run(request, (event) => {
      workspaceChannels.event.emit({ event });
    })
  );

  // Cancel every surface of a run (best-effort, cooperative).
  workspaceChannels.cancel.provider(({ runId }) => {
    services.orchestrator.cancel(runId);
    return Promise.resolve();
  });
}

/** Reset the lazily-built default services (deterministic teardown for tests). */
export function disposeWorkspaceBridge(): void {
  defaultServices = undefined;
}
