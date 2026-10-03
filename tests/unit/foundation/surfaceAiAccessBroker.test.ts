import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import type {
  PackageIdentity,
  PackageListing,
  PackageManifest,
  PackageSurfaceAiOperation,
  SurfacePlanningStep,
} from '@/common/packages';
import type { RunIntent } from '@/common/foundation/runTypes';
import { EventStore } from '@/process/foundation/eventStore';
import { FoundationTrustRuntime, RunKernel } from '@/process/foundation/runKernel';
import { SecurityAdapter } from '@/process/foundation/securityAdapter';
import { TrustBroker } from '@/process/foundation/trustBroker';
import { JsonlDurableEventStore } from '@/process/services/agentChat/durability';
import {
  createJsonSurfaceAiAccessConsentAuthority,
  createSurfaceAiAccessConsentChallengeAuthority,
  createSurfaceAiAccessBroker,
  createSurfaceAiOperationDispatcher,
  type SurfaceAiAccessConsent,
  type SurfaceAiAccessConsentStore,
  type SurfaceAiAccessRequest,
  type SurfaceAiOperationDispatcher,
} from '@/process/resources/packageCapability/surfaceAiAccessBroker';
import {
  createSurfaceAiRuntimeTransportRegistry,
  type SurfaceAiRuntimeTransportEndpoint,
} from '@/process/resources/packageCapability/surfaceAiRuntimeTransport';
import { createSurfaceAiObservationStore } from '@/process/resources/packageProcessRuntime/surfaceAiObservationStore';
import {
  createSurfaceAiOperationMcpServer,
  PACKAGE_SURFACE_OPERATION_TOOL_NAME,
} from '@/process/resources/packageCapability/goalCapability/surfaceAiOperationMcpServer';
import { executeSurfaceAiOperationRun } from '@/process/resources/packageCapability/goalCapability/surfaceAiOperationRun';
import { startSurfaceAiOperationMcpHost } from '@/process/resources/packageCapability/goalCapability/surfaceAiOperationMcpHost';
import {
  createSurfaceAiSecretLeaseAuthority,
  SurfaceAiSecretLeaseError,
  type SurfaceAiSecretLeaseBinding,
} from '@/process/resources/packageCapability/goalCapability/surfaceAiSecretLease';
import { selectReadyLocalSurfaceAiOperation } from '@/process/resources/packageCapability/goalCapability/surfaceAiOperationSelector';
import { prepareReadyLocalSurfaceAiAction } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionReadiness';
import type { SurfaceAiActionReadinessError } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionReadiness';
import {
  C4LocalSurfaceAiTrustError,
  C4_LOCAL_SURFACE_AI_ORIGIN,
  assertC4LocalSurfaceAiTarget,
} from '@/process/resources/packageCapability/goalCapability/surfaceAiActionTrust';
import { executeReadyLocalSurfaceAiAction } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionExecution';
import type { SurfaceAiActionExecutionError } from '@/process/resources/packageCapability/goalCapability/surfaceAiActionExecution';

const surface: PackageIdentity = {
  packageId: 'com.tomni.ide',
  packageVersion: '1.0.0',
  publisherId: 'com.tomni',
};
const operation: PackageSurfaceAiOperation = {
  id: 'workspace.write-files',
  capability: 'workspace.write',
  inputSchemaVersion: 1,
  dataClasses: ['workspace', 'conversation'],
  destinationIds: ['local:ide'],
};
const surfaceCapability = `surface.ai:${surface.packageId}:${operation.id}`;
const now = Date.UTC(2026, 7, 20, 12, 0, 0);

/** In-memory Main↔sandbox port used only to prove the complete C4 dispatch seam. */
class TestSurfaceRuntimeEndpoint {
  public readonly sent: unknown[] = [];
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  public readonly endpoint: SurfaceAiRuntimeTransportEndpoint = {
    postMessage: (message) => this.sent.push(message),
    close: () => {
      for (const listener of this.closeListeners) listener();
    },
    onMessage: (listener) => {
      this.messageListeners.add(listener);
      return () => this.messageListeners.delete(listener);
    },
    onClose: (listener) => {
      this.closeListeners.add(listener);
      return () => this.closeListeners.delete(listener);
    },
  };

  public emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

const parentIntent = (): RunIntent => ({
  runId: 'run_create_app',
  rootTaskId: 'task_create_app',
  surface: 'hub',
  goal: 'Create an application.',
  constraints: [],
  successCriteria: ['A project exists.'],
  workspaceScope: 'workspace:default',
  userId: 'account_1',
  createdAt: now,
  correlationId: 'correlation_create_app',
  policyVersion: 'policy_1',
  capabilityGrant: ['target.execute', surfaceCapability],
  budget: { maxEstimatedCostMB: 256, maxSteps: 3 },
});

const consent = (overrides: Partial<SurfaceAiAccessConsent> = {}): SurfaceAiAccessConsent => ({
  schemaVersion: 1,
  consentId: 'consent_1',
  accountId: 'account_1',
  surface,
  placement: 'local',
  operationId: operation.id,
  capability: operation.capability,
  policyVersion: 'surface-ai-access-v1',
  inputSchemaVersion: 1,
  dataClasses: operation.dataClasses,
  destinationIds: operation.destinationIds,
  secretUse: false,
  limits: { maxEstimatedCostMB: 128, maxSteps: 1 },
  grantedAt: now - 1_000,
  expiresAt: now + 60_000,
  ...overrides,
});

const secretLeaseBinding = (overrides: Partial<SurfaceAiSecretLeaseBinding> = {}): SurfaceAiSecretLeaseBinding => ({
  accountId: 'account_1',
  consentId: 'consent_1',
  parentRunId: 'run_create_app',
  childRunId: 'surface-ai_child',
  invocationId: 'invocation_1',
  surface,
  operationId: operation.id,
  capability: operation.capability,
  destinationId: 'local:ide',
  secretHandle: 'secret_1',
  fields: ['TOKEN'],
  budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
  expiresAt: now + 60_000,
  ...overrides,
});

const installedSurfaceManifest = (operations: readonly PackageSurfaceAiOperation[] = [operation]): PackageManifest => ({
  schemaVersion: 1,
  id: surface.packageId,
  publisherId: surface.publisherId,
  name: 'IDE',
  description: 'Build apps.',
  type: 'app',
  bundleKind: 'single',
  version: surface.packageVersion,
  engines: { tomni: '>=1.0.0' },
  modules: [{ id: 'ide', title: 'IDE', surface: 'apps/ide', pinnable: true }],
  permissions: [],
  dependencies: [],
  tags: ['code'],
  contributions: { version: 1, apps: [{ id: 'ide', title: 'IDE', moduleId: 'ide' }] },
  aiAccess: { schemaVersion: 1, operations: operations.map((candidate) => structuredClone(candidate)) },
});

const installedReviewedListing = (overrides: Partial<PackageListing> = {}): PackageListing => {
  const installedManifest = overrides.installedManifest ?? installedSurfaceManifest();
  return {
    manifest: installedManifest,
    delivery: 'downloaded-package',
    trust: 'signed-store',
    publicationReview: {
      schemaVersion: 1,
      disposition: 'auto-approved',
      fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      reviewedAt: '2026-08-20T00:00:00.000Z',
    },
    state: 'installed',
    installedVersion: installedManifest.version,
    installedManifest,
    installedTrust: 'signed-store',
    installedPublicationReview: {
      schemaVersion: 1,
      disposition: 'auto-approved',
      fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      reviewedAt: '2026-08-20T00:00:00.000Z',
    },
    updateAvailable: false,
    compatible: true,
    enabled: true,
    ...overrides,
  };
};

const readyLocalPlanStep = (): Extract<SurfacePlanningStep, Readonly<{ kind: 'execute-local' }>> => {
  const candidate = {
    schemaVersion: 1 as const,
    candidateId: `surface:${surface.packageId}:${surface.packageVersion}:${operation.id}`,
    package: surface,
    contribution: { package: surface, contributionId: 'ide' },
    capability: operation.capability,
    state: 'ready-local' as const,
    trusted: true,
    compatible: true,
    healthy: true,
    dataLocation: 'local-only' as const,
    supportsUi: true,
    supportsOffline: true,
    reasonCodes: [`store:${surface.packageId}`, `operation:${operation.id}`],
  };
  const query = {
    schemaVersion: 1 as const,
    queryId: 'query_create_app',
    requester: { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' },
    capability: operation.capability,
    purpose: 'Create an app.',
    dataLocation: 'local-only' as const,
    requireUi: true,
    requireOffline: true,
    idempotencyKey: 'query_create_app_1',
  };
  return {
    kind: 'execute-local',
    query,
    resolution: {
      schemaVersion: 1,
      queryId: query.queryId,
      candidates: [candidate],
      selectedCandidateId: candidate.candidateId,
      evaluatedAt: '2026-08-20T00:00:00.000Z',
    },
    candidate,
  };
};

const createFixture = (
  options: Readonly<{
    trustPackage?: boolean;
    eventStore?: EventStore;
    policyVersion?: () => string;
  }> = {}
) => {
  const records = new Map<string, SurfaceAiAccessConsent>([['consent_1', consent()]]);
  const listeners = new Set<(consentId: string) => void>();
  const runtimeListeners = new Set<(event: { packageId: string; runtimeId: string; ownerId: string }) => void>();
  const consentStore: SurfaceAiAccessConsentStore = {
    get: (consentId) => records.get(consentId),
    onRevoked: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const kernel = new RunKernel({
    eventStore: options.eventStore,
    securityAdapter: new SecurityAdapter(
      new TrustBroker({ allowedCapabilities: [surfaceCapability, 'target.execute'] }, { now: () => now })
    ),
  });
  let activeOperation = operation;
  let currentSurface = true;
  const surfaceTrust = new TrustBroker(
    {
      allowedCapabilities: [surfaceCapability],
      allowedOrigins: ['tomny://surface-ai'],
      trustedPackageIds: options.trustPackage === false ? [] : [surface.packageId],
      requireApprovalForMutation: false,
    },
    { now: () => now }
  );
  const broker = createSurfaceAiAccessBroker({
    kernel,
    now: () => now,
    policyVersion: options.policyVersion,
    enabled: () => true,
    consentStore,
    resolveActiveLocalSurface: (packageId) =>
      packageId === surface.packageId
        ? {
            identity: surface,
            manifest: { aiAccess: { schemaVersion: 1, operations: [activeOperation] } },
            approvedForAiAccess: true,
            revoked: false,
          }
        : undefined,
    assertCurrentLocalSurface: async () => currentSurface,
    isExactRuntimeActive: (identity, runtime) =>
      identity.packageId === surface.packageId && runtime.ownerId === 'window-1' && runtime.runtimeId === 'runtime-1',
    onRuntimeInvalidated: (listener) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
    trustBroker: surfaceTrust,
    trustOrigin: 'tomny://surface-ai',
  });
  return {
    broker,
    kernel,
    trustBroker: surfaceTrust,
    records,
    setActiveOperation: (next: PackageSurfaceAiOperation): void => {
      activeOperation = next;
    },
    setCurrentSurface: (next: boolean): void => {
      currentSurface = next;
    },
    revoke: (consentId: string): void => listeners.forEach((listener) => listener(consentId)),
    invalidateRuntime: (): void =>
      runtimeListeners.forEach((listener) =>
        listener({ packageId: surface.packageId, ownerId: 'window-1', runtimeId: 'runtime-1' })
      ),
  };
};

const request = (overrides: Partial<SurfaceAiAccessRequest> = {}): SurfaceAiAccessRequest => ({
  invocationId: 'invoke_1',
  consentId: 'consent_1',
  accountId: 'account_1',
  surface,
  runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
  placement: 'local',
  operationId: operation.id,
  dataClasses: operation.dataClasses,
  destinationIds: operation.destinationIds,
  secretUse: false,
  parentIntent: parentIntent(),
  childRunId: 'run_create_app_surface',
  childTaskId: 'task_create_app_surface',
  budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
  input: { schemaVersion: 1, instruction: 'Create the requested application files.' },
  invokeSurface: async () => ({ evidenceRefs: ['artifact:project'] }),
  ...overrides,
});

describe('Surface AI secret lease authority', () => {
  it('resolves plaintext only inside its bound Main sink once and returns redacted evidence', async () => {
    const resolveSecret = vi.fn().mockResolvedValue({ TOKEN: 'must-not-leak' });
    const consume = vi.fn().mockResolvedValue({ evidenceRefs: ['secret-sink:receipt_1'] });
    const authority = createSurfaceAiSecretLeaseAuthority({
      resolveSecret,
      isBindingActive: () => true,
      now: () => now,
      createLeaseId: () => 'lease_1',
      sinks: [{ destinationId: 'local:ide', surface, operationId: operation.id, consume }],
    });
    const issued = authority.issue(secretLeaseBinding(), new AbortController().signal);

    await expect(authority.consume(issued.leaseId, new AbortController().signal)).resolves.toEqual({
      evidenceRefs: ['secret-sink:receipt_1'],
    });
    expect(resolveSecret).toHaveBeenCalledWith({
      handle: 'secret_1',
      surface: surface.packageId,
      purpose: `surface-ai:${operation.id}`,
      target: 'local:ide',
      fields: ['TOKEN'],
    });
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({ secret: { TOKEN: 'must-not-leak' }, destinationId: 'local:ide' })
    );
    await expect(authority.consume(issued.leaseId, new AbortController().signal)).rejects.toMatchObject({
      code: 'SURFACE_AI_SECRET_LEASE_UNAVAILABLE',
    });
  });

  it('fails closed before resolving for revoked, aborted, expired, or mismatched secret routes', async () => {
    const resolveSecret = vi.fn().mockResolvedValue({ TOKEN: 'must-not-leak' });
    const sink = vi.fn().mockResolvedValue({ evidenceRefs: [] });
    let active = true;
    let current = now;
    const authority = createSurfaceAiSecretLeaseAuthority({
      resolveSecret,
      isBindingActive: () => active,
      now: () => current,
      createLeaseId: () => 'lease_2',
      sinks: [{ destinationId: 'local:ide', surface, operationId: operation.id, consume: sink }],
    });
    const issued = authority.issue(secretLeaseBinding({ expiresAt: now + 1 }), new AbortController().signal);
    active = false;
    await expect(authority.consume(issued.leaseId, new AbortController().signal)).rejects.toBeInstanceOf(
      SurfaceAiSecretLeaseError
    );
    expect(resolveSecret).not.toHaveBeenCalled();

    active = true;
    const expiring = authority.issue(secretLeaseBinding({ expiresAt: now + 1 }), new AbortController().signal);
    current = now + 2;
    await expect(authority.consume(expiring.leaseId, new AbortController().signal)).rejects.toMatchObject({
      code: 'SURFACE_AI_SECRET_LEASE_DENIED',
    });
    expect(resolveSecret).not.toHaveBeenCalled();

    const aborted = new AbortController();
    aborted.abort();
    expect(() => authority.issue(secretLeaseBinding(), aborted.signal)).toThrow('SURFACE_AI_SECRET_LEASE_DENIED');
    expect(() =>
      authority.issue(secretLeaseBinding({ destinationId: 'unknown:destination' }), new AbortController().signal)
    ).toThrow('SURFACE_AI_SECRET_LEASE_UNAVAILABLE');
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('ready-local Surface AI operation selector', () => {
  it('binds a selected ready-local plan candidate to one exact installed reviewed operation', () => {
    const selection = selectReadyLocalSurfaceAiOperation({
      planStep: readyLocalPlanStep(),
      installedListing: installedReviewedListing(),
      secretUse: false,
    });

    expect(selection).toEqual({ surface, operation });
    expect(selection.operation).not.toBe(operation);
  });

  it('fails closed when the plan is remote, Store review is absent, or the installed identity changed', () => {
    const planStep = readyLocalPlanStep();
    const remotePlanStep = {
      ...planStep,
      kind: 'execute-remote',
      candidate: { ...planStep.candidate, state: 'ready-remote' },
    } as SurfacePlanningStep;
    expect(() =>
      selectReadyLocalSurfaceAiOperation({
        planStep: remotePlanStep,
        installedListing: installedReviewedListing(),
        secretUse: false,
      })
    ).toThrow('SURFACE_AI_OPERATION_SELECTOR_STEP_INVALID');

    expect(() =>
      selectReadyLocalSurfaceAiOperation({
        planStep,
        installedListing: installedReviewedListing({ installedPublicationReview: undefined }),
        secretUse: false,
      })
    ).toThrow('SURFACE_AI_OPERATION_SELECTOR_REVIEW_INVALID');

    const changedManifest = { ...installedSurfaceManifest(), version: '2.0.0' };
    expect(() =>
      selectReadyLocalSurfaceAiOperation({
        planStep,
        installedListing: installedReviewedListing({
          installedVersion: changedManifest.version,
          installedManifest: changedManifest,
        }),
        secretUse: false,
      })
    ).toThrow('SURFACE_AI_OPERATION_SELECTOR_IDENTITY_MISMATCH');
  });

  it('rejects ambiguous, secret-backed, and non-local declaration routes before consent or dispatch', () => {
    const planStep = readyLocalPlanStep();
    const select = (installedManifest: PackageManifest, secretUse = false): void => {
      selectReadyLocalSurfaceAiOperation({
        planStep,
        installedListing: installedReviewedListing({
          installedVersion: installedManifest.version,
          installedManifest,
        }),
        secretUse,
      });
    };

    expect(() => select(installedSurfaceManifest([operation, structuredClone(operation)]))).toThrow(
      'SURFACE_AI_OPERATION_SELECTOR_OPERATION_AMBIGUOUS'
    );
    expect(() =>
      select(installedSurfaceManifest([{ ...operation, dataClasses: ['workspace', 'secret-handle'] }]))
    ).toThrow('SURFACE_AI_OPERATION_SELECTOR_SECRET_DATA_DENIED');
    expect(() =>
      select(installedSurfaceManifest([{ ...operation, destinationIds: ['https://unexpected.example'] }]))
    ).toThrow('SURFACE_AI_OPERATION_SELECTOR_DESTINATION_INVALID');
    expect(() => select(installedSurfaceManifest(), true)).toThrow('SURFACE_AI_OPERATION_SELECTOR_SECRET_USE_DENIED');
  });
});

describe('ready-local Surface AI action readiness', () => {
  const runtime = {
    surface,
    ownerId: 'window-1',
    runtimeId: 'runtime-1',
    moduleId: 'ide',
    artifactIntegrity: `sha256-${'a'.repeat(64)}`,
  } as const;

  it('requires one fresh reviewed runtime and exact active consent before a C4 action can be composed', async () => {
    await expect(
      prepareReadyLocalSurfaceAiAction(
        {
          getConsent: async () => consent(),
          listVerifiedRuntimeBindings: async () => [runtime],
          isTransportActive: (candidate) => candidate.runtimeId === runtime.runtimeId,
          now: () => now,
        },
        {
          planStep: readyLocalPlanStep(),
          installedListing: installedReviewedListing(),
          accountId: 'account_1',
          consentId: 'consent_1',
        }
      )
    ).resolves.toMatchObject({ selection: { surface, operation }, consent: { consentId: 'consent_1' }, runtime });
  });

  it('fails closed for stale consent, an inactive port, or ambiguous Surface runtime instances', async () => {
    const input = {
      planStep: readyLocalPlanStep(),
      installedListing: installedReviewedListing(),
      accountId: 'account_1',
      consentId: 'consent_1',
    } as const;
    await expect(
      prepareReadyLocalSurfaceAiAction(
        {
          getConsent: () => consent({ expiresAt: now }),
          listVerifiedRuntimeBindings: async () => [runtime],
          isTransportActive: () => true,
          now: () => now,
        },
        input
      )
    ).rejects.toMatchObject<Partial<SurfaceAiActionReadinessError>>({ code: 'SURFACE_AI_ACTION_CONSENT_EXPIRED' });
    await expect(
      prepareReadyLocalSurfaceAiAction(
        {
          getConsent: () => consent(),
          listVerifiedRuntimeBindings: async () => [runtime],
          isTransportActive: () => false,
          now: () => now,
        },
        input
      )
    ).rejects.toMatchObject<Partial<SurfaceAiActionReadinessError>>({ code: 'SURFACE_AI_ACTION_RUNTIME_UNAVAILABLE' });
    await expect(
      prepareReadyLocalSurfaceAiAction(
        {
          getConsent: () => consent(),
          listVerifiedRuntimeBindings: async () => [runtime, { ...runtime, runtimeId: 'runtime-2' }],
          isTransportActive: () => true,
          now: () => now,
        },
        input
      )
    ).rejects.toMatchObject<Partial<SurfaceAiActionReadinessError>>({ code: 'SURFACE_AI_ACTION_RUNTIME_AMBIGUOUS' });
  });
});

describe('local Surface AI target boundary', () => {
  it('accepts only a Main-discovered local loopback target', () => {
    expect(() =>
      assertC4LocalSurfaceAiTarget({
        targetId: 'local-loopback',
        kind: 'local',
        networkHost: '127.0.0.1',
      })
    ).not.toThrow();
  });

  it('fails closed for a cloud host before a C4 parent Run can start', () => {
    expect(() =>
      assertC4LocalSurfaceAiTarget({
        targetId: 'cloud-model',
        kind: 'local',
        networkHost: 'api.example.test',
      })
    ).toThrow(C4LocalSurfaceAiTrustError);
  });
});

describe('Main-only ready-local Surface action composition', () => {
  const runtime = {
    surface,
    ownerId: 'window-1',
    runtimeId: 'runtime-1',
    moduleId: 'ide',
    artifactIntegrity: `sha256-${'a'.repeat(64)}`,
  } as const;

  const actionDeps = (overrides: Record<string, unknown> = {}) => {
    const executeRun = vi.fn().mockResolvedValue({
      receipt: { receiptId: 'receipt_parent', status: 'verified' } as never,
      targetId: 'local-loopback',
    });
    const createDispatcher = vi.fn().mockResolvedValue({ dispatch: vi.fn() });
    const trustRuntime = new FoundationTrustRuntime({
      actorId: () => 'account_1',
      policy: {
        allowedCapabilities: ['target.execute', surfaceCapability],
        allowedNetworkHosts: ['127.0.0.1'],
        trustedPackageIds: [surface.packageId],
        allowedOrigins: [C4_LOCAL_SURFACE_AI_ORIGIN],
        requireApprovalForMutation: false,
        policyVersion: 'c4-local-v1',
      },
    });
    return {
      deps: {
        accountId: () => 'account_1',
        getInstalledListing: async () => installedReviewedListing(),
        readiness: {
          getConsent: () => consent(),
          listVerifiedRuntimeBindings: async () => [runtime],
          isTransportActive: () => true,
          now: () => now,
        },
        resolveLocalTarget: async () => ({
          targetId: 'local-loopback',
          kind: 'local' as const,
          modelKey: 'local-model',
          networkHost: '127.0.0.1',
        }),
        createDispatcher,
        kernel: trustRuntime.createRunKernel(),
        trustRuntime,
        runtime: { listTargets: async () => [], executeToCompletion: async () => ({ text: '', evidenceRefs: [] }) },
        workspaceScope: () => 'workspace:default',
        budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
        createRunId: () => 'run_c4_1',
        now: () => now,
        executeRun,
        ...overrides,
      },
      executeRun,
      createDispatcher,
      trustRuntime,
    };
  };

  it('pins a Main-authored local target and the exact readiness facts into one low-privilege parent Run', async () => {
    const fixture = actionDeps();
    await expect(
      executeReadyLocalSurfaceAiAction(fixture.deps, {
        goal: 'Create an app with the installed IDE.',
        planStep: readyLocalPlanStep(),
        consentId: 'consent_1',
        modelSelectionReceipt: 'model-selection:sha256-test',
      })
    ).resolves.toMatchObject({ receipt: { receiptId: 'receipt_parent' }, targetId: 'local-loopback' });
    expect(fixture.createDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        readiness: expect.objectContaining({ runtime }),
        trust: expect.objectContaining({
          origin: C4_LOCAL_SURFACE_AI_ORIGIN,
          trustBroker: fixture.trustRuntime.trustBroker,
        }),
      })
    );
    expect(fixture.executeRun).toHaveBeenCalledWith(
      expect.objectContaining({ trustRuntime: fixture.trustRuntime }),
      expect.objectContaining({
        targetId: 'local-loopback',
        modelKey: 'local-model',
        session: expect.objectContaining({
          operation: expect.objectContaining({
            secretUse: false,
            parentIntent: expect.objectContaining({
              surface: 'hub-surface-ai-action',
              constraints: ['offline_only', 'private_only', 'target:local-loopback'],
              capabilityGrant: ['target.execute', surfaceCapability],
            }),
          }),
        }),
      })
    );
  });

  it('does not build a dispatcher or Run for a missing installed Surface or non-local target', async () => {
    const unavailable = actionDeps({ getInstalledListing: async () => undefined });
    await expect(
      executeReadyLocalSurfaceAiAction(unavailable.deps, {
        goal: 'Create app',
        planStep: readyLocalPlanStep(),
        consentId: 'consent_1',
        modelSelectionReceipt: 'model-selection:sha256-test',
      })
    ).rejects.toMatchObject<Partial<SurfaceAiActionExecutionError>>({
      code: 'SURFACE_AI_ACTION_SURFACE_UNAVAILABLE',
    });
    expect(unavailable.createDispatcher).not.toHaveBeenCalled();
    expect(unavailable.executeRun).not.toHaveBeenCalled();

    const cloud = actionDeps({ resolveLocalTarget: async () => undefined });
    await expect(
      executeReadyLocalSurfaceAiAction(cloud.deps, {
        goal: 'Create app',
        planStep: readyLocalPlanStep(),
        consentId: 'consent_1',
        modelSelectionReceipt: 'model-selection:sha256-test',
      })
    ).rejects.toMatchObject<Partial<SurfaceAiActionExecutionError>>({
      code: 'SURFACE_AI_ACTION_TARGET_UNAVAILABLE',
    });
    expect(cloud.createDispatcher).not.toHaveBeenCalled();
    expect(cloud.executeRun).not.toHaveBeenCalled();
  });
});

describe('Surface AI access broker', () => {
  it('binds declared local AI access and a consent to a Run child receipt', async () => {
    const fixture = createFixture();
    let invocation: unknown;

    const result = await fixture.broker.invoke(
      request({
        invokeSurface: async (next) => {
          invocation = next;
          return { evidenceRefs: ['artifact:project'] };
        },
      })
    );

    expect(invocation).toMatchObject({
      accountId: 'account_1',
      surface,
      placement: 'local',
      operation,
      capabilityGrant: [surfaceCapability],
      input: { schemaVersion: 1, instruction: 'Create the requested application files.' },
    });
    expect(result.parentReceipt.status).toBe('verified');
    expect(result.childReceipt).toMatchObject({ status: 'verified', parentRunId: 'run_create_app' });
    expect(result.parentReceipt.evidenceRefs).toEqual(
      expect.arrayContaining(['surface-ai:invoke_1', 'surface-ai-consent:consent_1'])
    );
    expect(fixture.kernel.resourceAdapter.getActiveLeases()).toEqual([]);
  });

  it('rechecks current Store Surface state before allocating a Trust grant or invoking the runtime', async () => {
    const fixture = createFixture();
    const invokeSurface = vi.fn(request().invokeSurface);
    const current = vi.fn().mockResolvedValue(false);
    const broker = createSurfaceAiAccessBroker({
      kernel: fixture.kernel,
      enabled: () => true,
      consentStore: { get: () => consent() },
      resolveActiveLocalSurface: () => ({
        identity: surface,
        manifest: { aiAccess: { schemaVersion: 1, operations: [operation] } },
        approvedForAiAccess: true,
        revoked: false,
      }),
      assertCurrentLocalSurface: current,
      isExactRuntimeActive: () => true,
      trustBroker: new TrustBroker({
        allowedCapabilities: [surfaceCapability],
        allowedOrigins: ['tomny://surface-ai'],
        trustedPackageIds: [surface.packageId],
        requireApprovalForMutation: false,
      }),
      trustOrigin: 'tomny://surface-ai',
    });

    await expect(broker.invoke(request({ invokeSurface }))).rejects.toMatchObject({
      code: 'SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE',
    });
    expect(current).toHaveBeenCalledWith(surface, { ownerId: 'window-1', runtimeId: 'runtime-1' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('dispatches a Main-created operation through the authenticated runtime transport only after the broker gates pass', async () => {
    const fixture = createFixture();
    const binding = {
      surface,
      ownerId: 'window-1',
      runtimeId: 'runtime-1',
      moduleId: 'ide',
      artifactIntegrity: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const transportInvoke = vi.fn(async (input: { onProgress?: (progress: unknown) => void }) => {
      input.onProgress?.({
        invocationId: 'invoke_1',
        runId: 'run_create_app_surface',
        phase: 'writing',
        completed: 1,
        total: 1,
      });
      return {
        invocationId: 'invoke_1',
        runId: 'run_create_app_surface',
        artifactRefs: ['artifact:project'],
        evidenceRefs: ['runtime:ok'],
      };
    });
    const dispatcher = createSurfaceAiOperationDispatcher({
      broker: fixture.broker,
      transportRegistry: { isActive: (candidate) => candidate === binding, invoke: transportInvoke },
      resolveRuntimeBinding: async () => binding,
      createOperationLeaseId: () => 'opaque-lease-1',
      timeoutMs: 15_000,
    });
    const { invokeSurface: _unused, ...dispatchRequest } = request();
    const progress: unknown[] = [];

    const result = await dispatcher.dispatch({ ...dispatchRequest, onProgress: (event) => progress.push(event) });

    expect(transportInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        binding,
        invocationId: 'invoke_1',
        runId: 'run_create_app_surface',
        operationId: operation.id,
        operationLeaseId: 'opaque-lease-1',
        input: { schemaVersion: 1, instruction: 'Create the requested application files.' },
        timeoutMs: 15_000,
      })
    );
    expect(progress).toEqual([
      { invocationId: 'invoke_1', runId: 'run_create_app_surface', phase: 'writing', completed: 1, total: 1 },
    ]);
    expect(result.childReceipt).toMatchObject({ status: 'verified', parentRunId: 'run_create_app' });
    expect(result.childReceipt.evidenceRefs).toEqual(expect.arrayContaining(['runtime:ok', 'artifact:project']));
  });

  it('records one opaque observation reference in owner-bound parent and child terminal receipts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-c4-dispatch-observation-'));
    const journalPath = path.join(root, 'foundation.jsonl');
    const fixture = createFixture({
      eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
    });
    const binding = {
      surface,
      ownerId: 'window-1',
      runtimeId: 'runtime-1',
      moduleId: 'ide',
      artifactIntegrity: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const transportInvoke = vi.fn(async (input: { onProgress?: (progress: unknown) => void }) => {
      input.onProgress?.({
        invocationId: 'invoke_1',
        runId: 'run_create_app_surface',
        phase: 'writing',
        completed: 1,
        total: 1,
      });
      return {
        invocationId: 'invoke_1',
        runId: 'run_create_app_surface',
        artifactRefs: ['artifact:project'],
        evidenceRefs: ['runtime:ok'],
      };
    });
    try {
      const dispatcher = createSurfaceAiOperationDispatcher({
        broker: fixture.broker,
        transportRegistry: { isActive: (candidate) => candidate === binding, invoke: transportInvoke },
        resolveRuntimeBinding: async () => binding,
        observationStore: createSurfaceAiObservationStore({ rootPath: root, now: () => now }),
        createOperationLeaseId: () => 'opaque-lease-1',
      });
      const { invokeSurface: _unused, ...dispatchRequest } = request();

      const result = await dispatcher.dispatch(dispatchRequest);

      const terminalObservation = await createSurfaceAiObservationStore({ rootPath: root, now: () => now }).read({
        accountId: 'account_1',
        runId: 'run_create_app_surface',
        invocationId: 'invoke_1',
        operationId: operation.id,
        surface,
        artifactIntegrity: binding.artifactIntegrity,
      });
      expect(terminalObservation).toMatchObject({
        state: 'completed',
        identity: { accountId: 'account_1' },
        progress: [{ sequence: 1, phase: 'writing', completed: 1, total: 1 }],
        result: { sequence: 2, artifactRefs: ['artifact:project'], evidenceRefs: ['runtime:ok'] },
      });
      const observationRef = `surface-ai-observation:${terminalObservation?.observationKey}`;
      expect(observationRef).toMatch(/^surface-ai-observation:sha256-[a-f0-9]{64}$/);
      expect(observationRef).not.toContain('account_1');
      expect(observationRef).not.toContain('window-1');
      expect(observationRef).not.toContain('Create the requested application files.');
      expect(result.childReceipt.evidenceRefs).toEqual(expect.arrayContaining([observationRef]));
      expect(result.parentReceipt?.evidenceRefs).toEqual(expect.arrayContaining([observationRef]));

      const restarted = new RunKernel({
        eventStore: new EventStore({ journal: new JsonlDurableEventStore(journalPath) }),
      });
      await expect(restarted.getReceiptForAccount('account_1', result.childReceipt.runId)).resolves.toEqual(
        result.childReceipt
      );
      await expect(restarted.getReceiptForAccount('account_1', result.parentReceipt?.runId ?? '')).resolves.toEqual(
        result.parentReceipt
      );
      await expect(restarted.getReceiptForAccount('account-other', result.childReceipt.runId)).resolves.toBeUndefined();
      const journal = await readFile(journalPath, 'utf8');
      expect(journal).toContain(observationRef);
      expect(journal).not.toContain('account_1');
      expect(journal).not.toContain('window-1');
      expect(journal).not.toContain('Create the requested application files.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed before transport when restart recovery finds an active observation for the same invocation', async () => {
    const fixture = createFixture();
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-c4-dispatch-recovery-'));
    const binding = {
      surface,
      ownerId: 'window-1',
      runtimeId: 'runtime-1',
      moduleId: 'ide',
      artifactIntegrity: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as const;
    const transportInvoke = vi.fn();
    const observationIdentity = {
      accountId: 'account_1',
      runId: 'run_create_app_surface',
      invocationId: 'invoke_1',
      operationId: operation.id,
      surface,
      artifactIntegrity: binding.artifactIntegrity,
    } as const;

    try {
      await createSurfaceAiObservationStore({ rootPath: root, now: () => now }).open(observationIdentity);
      const dispatcher = createSurfaceAiOperationDispatcher({
        broker: fixture.broker,
        transportRegistry: { isActive: (candidate) => candidate === binding, invoke: transportInvoke },
        resolveRuntimeBinding: async () => binding,
        observationStore: createSurfaceAiObservationStore({ rootPath: root, now: () => now }),
        createOperationLeaseId: () => 'opaque-lease-1',
      });
      const { invokeSurface: _unused, ...dispatchRequest } = request();

      await expect(dispatcher.dispatch(dispatchRequest)).resolves.toMatchObject({
        childReceipt: { status: 'failed' },
        parentReceipt: { status: 'failed' },
      });
      expect(transportInvoke).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('composes consent, Trust, Run receipts, and the real bounded runtime registry without a direct package callback', async () => {
    const fixture = createFixture();
    const registry = createSurfaceAiRuntimeTransportRegistry();
    const endpoint = new TestSurfaceRuntimeEndpoint();
    const binding = {
      surface,
      ownerId: 'window-1',
      runtimeId: 'runtime-1',
      moduleId: 'ide',
      artifactIntegrity: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as const;
    registry.register(binding, endpoint.endpoint);
    endpoint.emit({ type: 'ready', schemaVersion: 1, sequence: 0, binding });
    const dispatcher = createSurfaceAiOperationDispatcher({
      broker: fixture.broker,
      transportRegistry: registry,
      resolveRuntimeBinding: async () => binding,
      createOperationLeaseId: () => 'opaque-lease-1',
      timeoutMs: 15_000,
    });
    const { invokeSurface: _unused, ...dispatchRequest } = request();
    const progress: unknown[] = [];

    const pending = dispatcher.dispatch({ ...dispatchRequest, onProgress: (event) => progress.push(event) });
    await vi.waitFor(() => expect(endpoint.sent).toHaveLength(1));
    expect(endpoint.sent[0]).toMatchObject({
      type: 'invoke',
      invocationId: 'invoke_1',
      runId: 'run_create_app_surface',
      operationId: operation.id,
      operationLeaseId: 'opaque-lease-1',
    });
    endpoint.emit({
      type: 'progress',
      schemaVersion: 1,
      sequence: 1,
      invocationId: 'invoke_1',
      runId: 'run_create_app_surface',
      operationId: operation.id,
      operationSchemaVersion: 1,
      phase: 'writing',
      completed: 1,
      total: 1,
    });
    endpoint.emit({
      type: 'result',
      schemaVersion: 1,
      sequence: 2,
      invocationId: 'invoke_1',
      runId: 'run_create_app_surface',
      operationId: operation.id,
      operationSchemaVersion: 1,
      artifactRefs: ['artifact:project'],
      evidenceRefs: ['runtime:ok'],
    });

    const result = await pending;
    expect(progress).toEqual([
      { invocationId: 'invoke_1', runId: 'run_create_app_surface', phase: 'writing', completed: 1, total: 1 },
    ]);
    expect(result.childReceipt).toMatchObject({ status: 'verified', parentRunId: 'run_create_app' });
    expect(result.childReceipt.evidenceRefs).toEqual(expect.arrayContaining(['runtime:ok', 'artifact:project']));
    expect(fixture.kernel.resourceAdapter.getActiveLeases()).toEqual([]);
  });

  it('denies the Surface operation before invocation when the shared Trust policy rejects its exact package', async () => {
    const fixture = createFixture({ trustPackage: false });
    const invokeSurface = vi.fn(request().invokeSurface);

    await expect(fixture.broker.invoke(request({ invokeSurface }))).rejects.toMatchObject({
      code: 'SURFACE_AI_ACCESS_TRUST_DENIED',
    });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('does not deliver a secret-shaped instruction to the package runtime', async () => {
    const fixture = createFixture();
    const invokeSurface = vi.fn(request().invokeSurface);

    await expect(
      fixture.broker.invoke(
        request({ input: { schemaVersion: 1, instruction: 'api_key=must-not-leave-main' }, invokeSurface })
      )
    ).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_TRUST_DENIED' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('fails closed before invocation when the request or durable consent does not exactly match the declaration', async () => {
    const fixture = createFixture();
    let invoked = false;

    await expect(
      fixture.broker.invoke(
        request({
          destinationIds: ['https://unexpected.example'],
          invokeSurface: async () => {
            invoked = true;
            return { evidenceRefs: [] };
          },
        })
      )
    ).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH' });

    expect(invoked).toBe(false);
  });

  it('requires fresh consent when persisted material facts diverge from the active declaration', async () => {
    const cases: readonly Readonly<{
      name: string;
      expectedCode: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED' | 'SURFACE_AI_ACCESS_CONSENT_MISMATCH';
      existingConsent: SurfaceAiAccessConsent;
    }>[] = [
      {
        name: 'Surface package version',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
        existingConsent: consent({ surface: { ...surface, packageVersion: '2.0.0' } }),
      },
      {
        name: 'operation',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
        existingConsent: consent({ operationId: 'workspace.read-files' }),
      },
      {
        name: 'capability',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
        existingConsent: consent({ capability: 'workspace.read' }),
      },
      {
        name: 'secret use',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
        existingConsent: consent({ secretUse: true }),
      },
      {
        name: 'data class',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
        existingConsent: consent({ dataClasses: ['workspace'] }),
      },
      {
        name: 'destination',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
        existingConsent: consent({ destinationIds: ['local:other'] }),
      },
      {
        name: 'expiry',
        expectedCode: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED',
        existingConsent: consent({ expiresAt: now }),
      },
    ];

    for (const testCase of cases) {
      const fixture = createFixture();
      const invokeSurface = vi.fn(request().invokeSurface);
      fixture.records.set('consent_1', testCase.existingConsent);

      await expect(fixture.broker.invoke(request({ invokeSurface }))).rejects.toMatchObject({
        code: testCase.expectedCode,
      });
      expect(invokeSurface, testCase.name).not.toHaveBeenCalled();
    }
  });

  it('invalidates cached consent on a material policy revision and requires a fresh, revocable approval', async () => {
    let policyVersion = 'surface-ai-access-v1';
    const fixture = createFixture({ policyVersion: () => policyVersion });
    const invokeSurface = vi.fn(request().invokeSurface);

    policyVersion = 'surface-ai-access-v2';
    await expect(fixture.broker.invoke(request({ invokeSurface }))).rejects.toMatchObject({
      code: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
    });
    expect(invokeSurface).not.toHaveBeenCalled();

    fixture.records.set('consent_1', consent({ policyVersion }));
    await expect(fixture.broker.invoke(request({ invokeSurface }))).resolves.toMatchObject({
      childReceipt: { status: 'verified' },
    });
    expect(invokeSurface).toHaveBeenCalledTimes(1);

    fixture.records.set('consent_1', { ...consent({ policyVersion }), revokedAt: now });
    await expect(fixture.broker.invoke(request({ invokeSurface }))).rejects.toMatchObject({
      code: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED',
    });
    expect(invokeSurface).toHaveBeenCalledTimes(1);
  });

  it('is disabled unless bootstrap explicitly releases the local Surface gate', async () => {
    const fixture = createFixture();
    const disabled = createSurfaceAiAccessBroker({
      kernel: fixture.kernel,
      enabled: () => false,
      consentStore: {
        get: () => undefined,
      },
      resolveActiveLocalSurface: () => undefined,
      isExactRuntimeActive: () => false,
      trustBroker: new TrustBroker({ allowedCapabilities: [] }),
      trustOrigin: 'tomny://surface-ai',
    });

    await expect(disabled.invoke(request())).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_DISABLED' });
    await expect(fixture.broker.invoke(request())).resolves.toMatchObject({
      parentReceipt: { status: 'verified' },
    });
  });

  it('cancels an active local invocation when its durable consent is revoked', async () => {
    const fixture = createFixture();
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancelled = false;
    const resultPromise = fixture.broker.invoke(
      request({
        invokeSurface: async ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                cancelled = true;
                resolve({ evidenceRefs: [] });
              },
              { once: true }
            );
            started?.();
          }),
      })
    );

    await startedPromise;
    fixture.revoke('consent_1');
    const result = await resultPromise;

    expect(cancelled).toBe(true);
    expect(result.childReceipt.status).toBe('cancelled');
    expect(result.parentReceipt.status).toBe('cancelled');
    expect(fixture.kernel.resourceAdapter.getActiveLeases()).toEqual([]);
  });

  it('does not invoke a queued child when durable consent is revoked after its lease is granted', async () => {
    const eventStore = new EventStore();
    const fixture = createFixture({ eventStore });
    const originalAppendDurably = eventStore.appendDurably.bind(eventStore);
    let releaseChildExecution: (() => void) | undefined;
    const childExecutionStarted = new Promise<void>((resolve) => {
      vi.spyOn(eventStore, 'appendDurably').mockImplementation(async (event, idempotencyKey) => {
        if (event.runId === 'run_create_app_surface' && event.eventType === 'execution.started') {
          resolve();
          await new Promise<void>((continueExecution) => {
            releaseChildExecution = continueExecution;
          });
        }
        return originalAppendDurably(event, idempotencyKey);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await childExecutionStarted;
    fixture.records.set('consent_1', { ...consent(), revokedAt: now });
    fixture.revoke('consent_1');
    releaseChildExecution?.();

    await expect(pending).resolves.toMatchObject({
      childReceipt: { status: 'cancelled' },
      parentReceipt: { status: 'cancelled' },
    });
    expect(invokeSurface).not.toHaveBeenCalled();
    expect(fixture.kernel.resourceAdapter.getActiveLeases()).toEqual([]);
  });

  it('does not invoke a Surface when consent is revoked while durable receipt recovery is pending', async () => {
    const fixture = createFixture();
    let releaseReceiptLookup: (() => void) | undefined;
    const receiptLookupReached = new Promise<void>((resolve) => {
      const originalGetReceipt = fixture.kernel.getReceiptForAccount.bind(fixture.kernel);
      vi.spyOn(fixture.kernel, 'getReceiptForAccount').mockImplementationOnce(async (...args) => {
        resolve();
        await new Promise<void>((continueReceiptLookup) => {
          releaseReceiptLookup = continueReceiptLookup;
        });
        return originalGetReceipt(...args);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await receiptLookupReached;
    fixture.records.set('consent_1', { ...consent(), revokedAt: now });
    releaseReceiptLookup?.();

    await expect(pending).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('requires fresh consent when the Main policy revision changes while durable receipt recovery is pending', async () => {
    let policyVersion = 'surface-ai-access-v1';
    const fixture = createFixture({ policyVersion: () => policyVersion });
    let releaseReceiptLookup: (() => void) | undefined;
    const receiptLookupReached = new Promise<void>((resolve) => {
      const originalGetReceipt = fixture.kernel.getReceiptForAccount.bind(fixture.kernel);
      vi.spyOn(fixture.kernel, 'getReceiptForAccount').mockImplementationOnce(async (...args) => {
        resolve();
        await new Promise<void>((continueReceiptLookup) => {
          releaseReceiptLookup = continueReceiptLookup;
        });
        return originalGetReceipt(...args);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await receiptLookupReached;
    policyVersion = 'surface-ai-access-v2';
    releaseReceiptLookup?.();

    await expect(pending).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('requires fresh consent when the active declaration changes while durable receipt recovery is pending', async () => {
    const fixture = createFixture();
    let releaseReceiptLookup: (() => void) | undefined;
    const receiptLookupReached = new Promise<void>((resolve) => {
      const originalGetReceipt = fixture.kernel.getReceiptForAccount.bind(fixture.kernel);
      vi.spyOn(fixture.kernel, 'getReceiptForAccount').mockImplementationOnce(async (...args) => {
        resolve();
        await new Promise<void>((continueReceiptLookup) => {
          releaseReceiptLookup = continueReceiptLookup;
        });
        return originalGetReceipt(...args);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await receiptLookupReached;
    fixture.setActiveOperation({ ...operation, destinationIds: ['local:changed'] });
    releaseReceiptLookup?.();

    await expect(pending).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('rechecks a durable consent revoked during asynchronous Trust preflight before invoking the Surface', async () => {
    const fixture = createFixture();
    let releasePreflight: (() => void) | undefined;
    const preflightReached = new Promise<void>((resolve) => {
      const originalInspectFinalEgress = fixture.trustBroker.inspectFinalEgress.bind(fixture.trustBroker);
      vi.spyOn(fixture.trustBroker, 'inspectFinalEgress').mockImplementationOnce(async (...args) => {
        resolve();
        await new Promise<void>((continuePreflight) => {
          releasePreflight = continuePreflight;
        });
        return originalInspectFinalEgress(...args);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await preflightReached;
    fixture.records.set('consent_1', { ...consent(), revokedAt: now });
    releasePreflight?.();

    await expect(pending).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_CONSENT_EXPIRED' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('requires fresh consent when the active declaration narrows during asynchronous Trust preflight', async () => {
    const fixture = createFixture();
    let releasePreflight: (() => void) | undefined;
    const preflightReached = new Promise<void>((resolve) => {
      const originalInspectFinalEgress = fixture.trustBroker.inspectFinalEgress.bind(fixture.trustBroker);
      vi.spyOn(fixture.trustBroker, 'inspectFinalEgress').mockImplementationOnce(async (...args) => {
        resolve();
        await new Promise<void>((continuePreflight) => {
          releasePreflight = continuePreflight;
        });
        return originalInspectFinalEgress(...args);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await preflightReached;
    fixture.setActiveOperation({ ...operation, destinationIds: ['local:changed'] });
    releasePreflight?.();

    await expect(pending).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('rechecks Store current-surface admission after asynchronous Trust preflight', async () => {
    const fixture = createFixture();
    let releasePreflight: (() => void) | undefined;
    const preflightReached = new Promise<void>((resolve) => {
      const originalInspectFinalEgress = fixture.trustBroker.inspectFinalEgress.bind(fixture.trustBroker);
      vi.spyOn(fixture.trustBroker, 'inspectFinalEgress').mockImplementationOnce(async (...args) => {
        resolve();
        await new Promise<void>((continuePreflight) => {
          releasePreflight = continuePreflight;
        });
        return originalInspectFinalEgress(...args);
      });
    });
    const invokeSurface = vi.fn(request().invokeSurface);
    const pending = fixture.broker.invoke(request({ invokeSurface }));

    await preflightReached;
    fixture.setCurrentSurface(false);
    releasePreflight?.();

    await expect(pending).rejects.toMatchObject({ code: 'SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE' });
    expect(invokeSurface).not.toHaveBeenCalled();
  });

  it('fails closed for an inactive runtime and cancels an active invocation when that exact runtime is invalidated', async () => {
    const fixture = createFixture();

    await expect(
      fixture.broker.invoke(request({ runtime: { ownerId: 'window-1', runtimeId: 'missing' } }))
    ).rejects.toMatchObject({
      code: 'SURFACE_AI_ACCESS_RUNTIME_UNAVAILABLE',
    });

    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancelled = false;
    const pending = fixture.broker.invoke(
      request({
        invokeSurface: async ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                cancelled = true;
                resolve({ evidenceRefs: [] });
              },
              { once: true }
            );
            started?.();
          }),
      })
    );
    await startedPromise;
    fixture.invalidateRuntime();

    await expect(pending).resolves.toMatchObject({ childReceipt: { status: 'cancelled' } });
    expect(cancelled).toBe(true);
  });

  it('persists a Main-confirmed local consent and emits revocation after restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-surface-ai-consent-'));
    const filePath = path.join(rootDir, 'consents.json');
    try {
      const authority = createJsonSurfaceAiAccessConsentAuthority({ filePath, now: () => now });
      await authority.initialize();
      await authority.recordConfirmed(consent());

      const restored = createJsonSurfaceAiAccessConsentAuthority({ filePath, now: () => now + 1 });
      await restored.initialize();
      const revoked: string[] = [];
      const unsubscribe = restored.onRevoked?.((consentId) => revoked.push(consentId));
      expect(restored.get('consent_1')).toMatchObject({ accountId: 'account_1', surface });
      expect(restored.get('consent_1')).not.toHaveProperty('revokedAt');

      await expect(restored.revoke('consent_1')).resolves.toBe(true);
      expect(revoked).toEqual(['consent_1']);
      expect(restored.get('consent_1')).toMatchObject({ revokedAt: now + 1 });
      unsubscribe?.();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps legacy durable consent readable and revocable but never permits a new confirmation without a policy binding', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-surface-ai-legacy-consent-'));
    const filePath = path.join(rootDir, 'consents.json');
    try {
      const { policyVersion: _legacyPolicyVersion, ...legacy } = consent();
      await writeFile(filePath, JSON.stringify({ schemaVersion: 1, consents: [legacy] }), 'utf8');
      const authority = createJsonSurfaceAiAccessConsentAuthority({ filePath, now: () => now });
      await authority.initialize();

      expect(authority.get('consent_1')).toMatchObject({ accountId: 'account_1', surface });
      expect(authority.get('consent_1')).not.toHaveProperty('policyVersion');
      await expect(authority.recordConfirmed(legacy)).rejects.toMatchObject({
        code: 'SURFACE_AI_ACCESS_CONSENT_MISMATCH',
      });
      await expect(authority.revoke('consent_1')).resolves.toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('derives a one-time consent challenge from the active Surface and accepts only its owner approval', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-surface-ai-challenge-'));
    try {
      const authority = createJsonSurfaceAiAccessConsentAuthority({
        filePath: path.join(rootDir, 'consents.json'),
        now: () => now,
      });
      await authority.initialize();
      const challenges = createSurfaceAiAccessConsentChallengeAuthority({
        consentAuthority: authority,
        resolveActiveLocalSurface: (packageId) =>
          packageId === surface.packageId
            ? {
                identity: surface,
                manifest: { aiAccess: { schemaVersion: 1, operations: [operation] } },
                approvedForAiAccess: true,
                revoked: false,
              }
            : undefined,
        now: () => now,
        createChallengeId: () => 'challenge-1',
        createConsentId: () => 'consent-confirmed-1',
      });

      const challenge = challenges.issue({
        ownerId: 'window-1',
        accountId: 'account_1',
        packageId: surface.packageId,
        operationId: operation.id,
        secretUse: false,
        limits: { maxEstimatedCostMB: 128, maxSteps: 1 },
      });
      expect(challenge).toMatchObject({
        surface,
        operation,
        placement: 'local',
        accountId: 'account_1',
      });
      await expect(
        challenges.confirm({ ownerId: 'window-2', challengeId: challenge.challengeId, approved: true })
      ).rejects.toMatchObject({
        code: 'SURFACE_AI_ACCESS_CHALLENGE_INVALID',
      });
      await expect(
        challenges.confirm({ ownerId: 'window-1', challengeId: challenge.challengeId, approved: true })
      ).resolves.toMatchObject({
        approved: true,
        consent: {
          consentId: 'consent-confirmed-1',
          surface,
          operationId: operation.id,
          destinationIds: operation.destinationIds,
        },
      });
      expect(authority.get('consent-confirmed-1')).toMatchObject({ accountId: 'account_1', surface });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('does not mint consent for a rejected or expired challenge', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-surface-ai-reject-'));
    try {
      let clock = now;
      const authority = createJsonSurfaceAiAccessConsentAuthority({
        filePath: path.join(rootDir, 'consents.json'),
        now: () => clock,
      });
      await authority.initialize();
      const challenges = createSurfaceAiAccessConsentChallengeAuthority({
        consentAuthority: authority,
        resolveActiveLocalSurface: () => ({
          identity: surface,
          manifest: { aiAccess: { schemaVersion: 1, operations: [operation] } },
          approvedForAiAccess: true,
          revoked: false,
        }),
        now: () => clock,
        createChallengeId: () => `challenge-${clock}`,
        createConsentId: () => 'consent-never-issued',
        challengeTtlMs: 1,
      });
      const rejected = challenges.issue({
        ownerId: 'window-1',
        accountId: 'account_1',
        packageId: surface.packageId,
        operationId: operation.id,
        secretUse: false,
        limits: { maxEstimatedCostMB: 128, maxSteps: 1 },
      });
      await expect(
        challenges.confirm({ ownerId: 'window-1', challengeId: rejected.challengeId, approved: false })
      ).resolves.toEqual({ approved: false });
      expect(authority.get('consent-never-issued')).toBeUndefined();

      const expired = challenges.issue({
        ownerId: 'window-1',
        accountId: 'account_1',
        packageId: surface.packageId,
        operationId: operation.id,
        secretUse: false,
        limits: { maxEstimatedCostMB: 128, maxSteps: 1 },
      });
      clock += 1;
      await expect(
        challenges.confirm({ ownerId: 'window-1', challengeId: expired.challengeId, approved: true })
      ).rejects.toMatchObject({
        code: 'SURFACE_AI_ACCESS_CHALLENGE_EXPIRED',
      });
      expect(authority.get('consent-never-issued')).toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('pins an MCP model tool to one Main-bound Surface operation and emits only receipt identifiers', async () => {
    const dispatch = vi.fn<SurfaceAiOperationDispatcher['dispatch']>(async () => ({
      childReceipt: { receiptId: 'receipt_child' } as never,
    }));
    const activeRun = { isActive: () => true } as never;
    const server = createSurfaceAiOperationMcpServer({
      dispatcher: { dispatch },
      session: {
        operation: {
          consentId: 'consent_1',
          accountId: 'account_1',
          surface,
          runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
          placement: 'local',
          operationId: operation.id,
          dataClasses: operation.dataClasses,
          destinationIds: operation.destinationIds,
          secretUse: false,
          parentIntent: parentIntent(),
          budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
        },
        createInvocationId: () => 'main-invocation-1',
        createChildRunId: () => 'main-child-run-1',
        createChildTaskId: () => 'main-child-task-1',
        getActiveRun: () => activeRun,
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'surface-ai-tool-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: PACKAGE_SURFACE_OPERATION_TOOL_NAME,
        arguments: { instruction: 'Create a minimal app shell.' },
      });
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          invocationId: 'main-invocation-1',
          childRunId: 'main-child-run-1',
          childTaskId: 'main-child-task-1',
          consentId: 'consent_1',
          accountId: 'account_1',
          surface,
          runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
          operationId: operation.id,
          activeRun,
          input: { schemaVersion: 1, instruction: 'Create a minimal app shell.' },
        })
      );
      expect(result.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify({
            status: 'verified',
            childReceiptId: 'receipt_child',
          }),
        },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('fails closed before exposing a tool when the bound operation would need a secret lease', () => {
    const dispatcher: SurfaceAiOperationDispatcher = { dispatch: async () => ({}) as never };
    expect(() =>
      createSurfaceAiOperationMcpServer({
        dispatcher,
        session: {
          operation: {
            consentId: 'consent_1',
            accountId: 'account_1',
            surface,
            runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
            placement: 'local',
            operationId: operation.id,
            dataClasses: operation.dataClasses,
            destinationIds: operation.destinationIds,
            secretUse: true,
            parentIntent: parentIntent(),
            budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
          },
        },
      })
    ).toThrow('SURFACE_AI_OPERATION_SESSION_INVALID');
  });

  it('injects the bound operation host only into its pinned Foundation run and disposes it afterwards', async () => {
    const dispatcher: SurfaceAiOperationDispatcher = {
      dispatch: async () => ({ childReceipt: { receiptId: 'receipt_child', status: 'verified' } as never }),
    };
    const runtime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'selected-local', kind: 'local', available: true }]),
      executeToCompletion: vi.fn(
        async (input: {
          contextIdentity?: { mcpServers?: Array<{ url: string; headers?: Array<{ name: string; value: string }> }> };
        }) => {
          const server = input.contextIdentity?.mcpServers?.[0];
          if (!server) throw new Error('Missing operation MCP server.');
          const headers = Object.fromEntries((server.headers ?? []).map(({ name, value }) => [name, value]));
          const client = new Client({ name: 'surface-ai-run-test', version: '1.0.0' });
          await client.connect(new SSEClientTransport(new URL(server.url), { requestInit: { headers } }));
          try {
            await client.callTool({
              name: PACKAGE_SURFACE_OPERATION_TOOL_NAME,
              arguments: { instruction: 'Create the requested application files.' },
            });
          } finally {
            await client.close();
          }
          return { text: 'completed', evidenceRefs: [] };
        }
      ),
    };
    await expect(
      executeSurfaceAiOperationRun(
        {
          kernel: new RunKernel({
            securityAdapter: new SecurityAdapter(
              new TrustBroker({ allowedCapabilities: ['target.execute', surfaceCapability] })
            ),
          }),
          runtime,
          dispatcher,
        },
        {
          targetId: 'selected-local',
          modelKey: 'local-model',
          session: {
            operation: {
              consentId: 'consent_1',
              accountId: 'account_1',
              surface,
              runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
              placement: 'local',
              operationId: operation.id,
              dataClasses: operation.dataClasses,
              destinationIds: operation.destinationIds,
              secretUse: false,
              parentIntent: parentIntent(),
              budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
            },
          },
        }
      )
    ).resolves.toMatchObject({ targetId: 'selected-local', receipt: { status: 'verified' } });
    expect(runtime.executeToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'selected-local',
        modelKey: 'local-model',
        permissionMode: 'read-only',
        contextIdentity: expect.objectContaining({
          surface: surface.packageId,
          capabilityGrants: [surfaceCapability],
          mcpServers: [
            expect.objectContaining({
              name: 'tomny-package-surface-operation',
              url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/sse$/),
            }),
          ],
        }),
      })
    );
    expect(runtime.executeToCompletion.mock.calls[0]?.[0]?.contextIdentity).not.toHaveProperty('personalId');
  });

  it('keeps one parent Run and one delegated child when the real C4 MCP tool reaches the real broker', async () => {
    const c4Readiness = {
      selection: { surface, operation },
      consent: consent(),
      runtime: {
        surface,
        ownerId: 'window-1',
        runtimeId: 'runtime-1',
        moduleId: 'ide',
        artifactIntegrity: `sha256-${'a'.repeat(64)}`,
      },
    } as const;
    const trustRuntime = new FoundationTrustRuntime({
      actorId: () => 'account_1',
      policy: {
        allowedCapabilities: ['target.execute', surfaceCapability],
        allowedNetworkHosts: ['127.0.0.1'],
        trustedPackageIds: [surface.packageId],
        allowedOrigins: [C4_LOCAL_SURFACE_AI_ORIGIN],
        requireApprovalForMutation: false,
        policyVersion: 'c4-lineage-v1',
      },
    });
    const kernel = trustRuntime.createRunKernel();
    const broker = createSurfaceAiAccessBroker({
      kernel,
      enabled: () => true,
      now: () => now,
      consentStore: { get: () => c4Readiness.consent },
      resolveActiveLocalSurface: (packageId) =>
        packageId === surface.packageId
          ? {
              identity: surface,
              manifest: { aiAccess: { schemaVersion: 1, operations: [operation] } },
              approvedForAiAccess: true,
              revoked: false,
            }
          : undefined,
      isExactRuntimeActive: () => true,
      trustBroker: trustRuntime.trustBroker,
      trustOrigin: C4_LOCAL_SURFACE_AI_ORIGIN,
    });
    const binding = {
      surface,
      ownerId: 'window-1',
      runtimeId: 'runtime-1',
      moduleId: 'ide',
      artifactIntegrity: `sha256-${'a'.repeat(64)}`,
    } as const;
    const dispatcher = createSurfaceAiOperationDispatcher({
      broker,
      transportRegistry: {
        isActive: (candidate) => candidate === binding,
        invoke: async (input) => ({
          invocationId: input.invocationId,
          runId: input.runId,
          artifactRefs: ['artifact:c4-lineage'],
          evidenceRefs: ['runtime:c4-lineage'],
        }),
      },
      resolveRuntimeBinding: async () => binding,
      createOperationLeaseId: () => 'lease-c4-lineage',
    });
    const runtime = {
      listTargets: vi
        .fn()
        .mockResolvedValue([
          { id: 'selected-local', kind: 'local' as const, available: true, networkHost: '127.0.0.1' },
        ]),
      executeToCompletion: vi.fn(
        async (input: {
          contextIdentity?: { mcpServers?: Array<{ url: string; headers?: Array<{ name: string; value: string }> }> };
        }) => {
          const server = input.contextIdentity?.mcpServers?.[0];
          if (!server) throw new Error('Expected a C4 MCP server.');
          const headers = Object.fromEntries((server.headers ?? []).map(({ name, value }) => [name, value]));
          const client = new Client({ name: 'surface-ai-lineage-test', version: '1.0.0' });
          await client.connect(new SSEClientTransport(new URL(server.url), { requestInit: { headers } }));
          try {
            await client.callTool({
              name: PACKAGE_SURFACE_OPERATION_TOOL_NAME,
              arguments: { instruction: 'Create the bounded project files.' },
            });
          } finally {
            await client.close();
          }
          return { text: 'completed', evidenceRefs: [] };
        }
      ),
    };
    const intent = { ...parentIntent(), policyVersion: 'c4-lineage-v1' };
    const result = await executeSurfaceAiOperationRun(
      { kernel, runtime, dispatcher, trustRuntime },
      {
        targetId: 'selected-local',
        session: {
          operation: {
            consentId: c4Readiness.consent.consentId,
            accountId: c4Readiness.consent.accountId,
            surface,
            runtime: { ownerId: binding.ownerId, runtimeId: binding.runtimeId },
            placement: 'local',
            operationId: operation.id,
            dataClasses: operation.dataClasses,
            destinationIds: operation.destinationIds,
            secretUse: false,
            parentIntent: intent,
            budget: c4Readiness.consent.limits,
          },
          createInvocationId: () => 'c4-lineage-invocation',
          createChildRunId: () => 'c4-lineage-child-run',
          createChildTaskId: () => 'c4-lineage-child-task',
        },
      }
    );

    const terminalEventTypes = new Set(['outcome.verified', 'run.failed', 'run.cancelled']);
    const parentEvents = kernel.eventStore.getEventsByRunId(intent.runId);
    const childEvents = kernel.eventStore.getEventsByRunId('c4-lineage-child-run');
    expect(result.receipt).toMatchObject({ runId: intent.runId, status: 'verified' });
    expect(parentEvents.filter((event) => event.eventType === 'run.created')).toHaveLength(1);
    expect(parentEvents.filter((event) => terminalEventTypes.has(event.eventType))).toHaveLength(1);
    expect(childEvents.filter((event) => event.eventType === 'run.created')).toHaveLength(1);
    expect(childEvents.filter((event) => terminalEventTypes.has(event.eventType))).toHaveLength(1);
    expect(childEvents[0]).toMatchObject({
      eventType: 'run.created',
      payload: { parentRunId: intent.runId },
    });
    expect(parentEvents.filter((event) => event.eventType === 'run.created').map((event) => event.runId)).toEqual([
      intent.runId,
    ]);
  });

  it('uses the supplied Foundation runtime before the pinned C4 parent target executes', async () => {
    const dispatcher: SurfaceAiOperationDispatcher = {
      dispatch: async () => ({ childReceipt: { receiptId: 'receipt_child', status: 'verified' } as never }),
    };
    const runtime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'selected-local', kind: 'local', available: true }]),
      executeToCompletion: vi.fn(async () => ({ text: 'completed', evidenceRefs: [] })),
    };
    const trust = new TrustBroker({
      allowedCapabilities: ['target.execute', surfaceCapability],
      allowedOrigins: ['tomny://surface-ai-operation'],
      trustedPackageIds: [surface.packageId],
      requireApprovalForMutation: false,
      policyVersion: 'policy_1',
    });
    const trustRuntime = new FoundationTrustRuntime({ trustBroker: trust, actorId: () => 'account_1' });
    const requestCapability = vi.spyOn(trust, 'requestCapability');

    await expect(
      executeSurfaceAiOperationRun(
        {
          kernel: trustRuntime.createRunKernel(),
          runtime,
          dispatcher,
          trustRuntime,
        },
        {
          targetId: 'selected-local',
          session: {
            operation: {
              consentId: 'consent_1',
              accountId: 'account_1',
              surface,
              runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
              placement: 'local',
              operationId: operation.id,
              dataClasses: operation.dataClasses,
              destinationIds: operation.destinationIds,
              secretUse: false,
              parentIntent: parentIntent(),
              budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
            },
          },
        }
      )
    ).resolves.toMatchObject({ receipt: { status: 'failed' }, targetId: undefined });
    expect(requestCapability).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'selected-local', requestedCapabilities: ['target.execute'] }),
      'tomny://surface-ai-operation'
    );
  });

  it('denies a revoked shared runtime before a C4 target or child can execute', async () => {
    const trustRuntime = new FoundationTrustRuntime({
      actorId: () => 'account_1',
      policy: {
        allowedCapabilities: ['target.execute', surfaceCapability],
        allowedNetworkHosts: [],
        trustedPackageIds: [surface.packageId],
        allowedOrigins: [C4_LOCAL_SURFACE_AI_ORIGIN],
        requireApprovalForMutation: false,
        policyVersion: 'c4-revoked-v1',
      },
    });
    const runtime = {
      listTargets: vi.fn().mockResolvedValue([{ id: 'selected-local', kind: 'local', available: true }]),
      executeToCompletion: vi.fn(async () => ({ text: 'must not run', evidenceRefs: [] })),
    };
    trustRuntime.revoke('pilot disabled');

    await expect(
      executeSurfaceAiOperationRun(
        {
          kernel: trustRuntime.createRunKernel(),
          runtime,
          dispatcher: { dispatch: async () => ({ childReceipt: { status: 'verified' } as never }) },
          trustRuntime,
        },
        {
          targetId: 'selected-local',
          session: {
            operation: {
              consentId: 'consent_1',
              accountId: 'account_1',
              surface,
              runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
              placement: 'local',
              operationId: operation.id,
              dataClasses: operation.dataClasses,
              destinationIds: operation.destinationIds,
              secretUse: false,
              parentIntent: { ...parentIntent(), policyVersion: 'c4-revoked-v1' },
              budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
            },
          },
        }
      )
    ).rejects.toThrow('FOUNDATION_TRUST_RUNTIME_REVOKED');
    // Target inventory is Main-owned read-only discovery; the runtime gate is
    // still reached before a target is authorized or Core execution begins.
    expect(runtime.listTargets).toHaveBeenCalledTimes(1);
    expect(runtime.executeToCompletion).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated access to a per-run loopback MCP host', async () => {
    const dispatcher: SurfaceAiOperationDispatcher = { dispatch: async () => ({}) as never };
    const host = await startSurfaceAiOperationMcpHost({
      dispatcher,
      session: {
        operation: {
          consentId: 'consent_1',
          accountId: 'account_1',
          surface,
          runtime: { ownerId: 'window-1', runtimeId: 'runtime-1' },
          placement: 'local',
          operationId: operation.id,
          dataClasses: operation.dataClasses,
          destinationIds: operation.destinationIds,
          secretUse: false,
          parentIntent: parentIntent(),
          budget: { maxEstimatedCostMB: 128, maxSteps: 1 },
        },
      },
    });
    try {
      await expect(fetch(host.server.url)).resolves.toMatchObject({ status: 401 });
    } finally {
      await host.close();
    }
  });
});
