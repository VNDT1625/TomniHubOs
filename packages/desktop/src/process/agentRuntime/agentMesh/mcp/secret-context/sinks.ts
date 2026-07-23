import type { SecretVault } from '@process/agentRuntime/secretVault';
import {
  SECRET_FIREWALL_PURPOSE,
  SECRET_FIREWALL_SURFACE,
  type SecretContextSink,
  type SecretContextUseRequest,
} from './router';

const MAX_REGISTERED_TARGETS = 64;
const MAX_ALLOWED_NAMES = 100;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type OpaqueSecretSource = Readonly<{
  handle: string;
  field: string;
}>;

export type ManagedProcessSecretInjection = Readonly<{
  name: string;
  value: string;
  source: OpaqueSecretSource;
}>;

export type ManagedProcessSecretTarget = Readonly<{
  id: string;
  allowedVariables: readonly string[];
  /** Optional Main-owned source policy; field/name equality is always enforced first. */
  authorizeSource?: (source: OpaqueSecretSource) => boolean;
  inject: (input: ManagedProcessSecretInjection) => Promise<void>;
}>;

export type DeploymentSecretWrite = Readonly<{
  name: string;
  value: string;
  source: OpaqueSecretSource;
}>;

export type DeploymentSecretTarget = Readonly<{
  provider: string;
  projectId: string;
  environment: string;
  allowedNames: readonly string[];
  /** Optional Main-owned source policy; field/name equality is always enforced first. */
  authorizeSource?: (source: OpaqueSecretSource) => boolean;
  putSecret: (input: DeploymentSecretWrite) => Promise<void>;
}>;

type NormalizedManagedTarget = ManagedProcessSecretTarget & { allowed: ReadonlySet<string> };
type NormalizedDeploymentTarget = DeploymentSecretTarget & { allowed: ReadonlySet<string> };

const managedTargets = new Map<string, NormalizedManagedTarget>();
const deploymentTargets = new Map<string, NormalizedDeploymentTarget>();

const requiredTargetId = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!TARGET_ID.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const requiredSecretNames = (values: readonly string[], label: string): ReadonlySet<string> => {
  const normalized = values.map((value) => value.trim());
  if (
    normalized.length === 0 ||
    normalized.length > MAX_ALLOWED_NAMES ||
    normalized.some((value) => !IDENTIFIER.test(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error(`${label} must contain unique environment-style identifiers.`);
  }
  return new Set(normalized);
};

const deploymentKey = (provider: string, projectId: string, environment: string): string =>
  JSON.stringify([provider.toLowerCase(), projectId, environment]);

const enforceTargetLimit = (values: Map<string, unknown>, key: string): void => {
  if (!values.has(key) && values.size >= MAX_REGISTERED_TARGETS) {
    throw new Error(`Secret destination target limit of ${MAX_REGISTERED_TARGETS} reached.`);
  }
};

/**
 * Pre-authorize one Main-process-owned backend target. Registration is the
 * policy boundary; MCP callers cannot add targets or widen variable names.
 */
export const registerManagedProcessSecretTarget = (
  target: ManagedProcessSecretTarget,
  replace = false
): (() => void) => {
  const id = requiredTargetId(target.id, 'Managed process id');
  if (!replace && managedTargets.has(id)) throw new Error(`Managed process secret target ${id} already exists.`);
  enforceTargetLimit(managedTargets, id);
  const normalized: NormalizedManagedTarget = {
    ...target,
    id,
    allowed: requiredSecretNames(target.allowedVariables, 'Managed process variables'),
  };
  managedTargets.set(id, normalized);
  return () => {
    if (managedTargets.get(id) === normalized) managedTargets.delete(id);
  };
};

/** Register one exact provider/project/environment destination policy. */
export const registerDeploymentSecretTarget = (target: DeploymentSecretTarget, replace = false): (() => void) => {
  const provider = requiredTargetId(target.provider.toLowerCase(), 'Deployment provider');
  const projectId = requiredTargetId(target.projectId, 'Deployment project id');
  const environment = requiredTargetId(target.environment, 'Deployment environment');
  const key = deploymentKey(provider, projectId, environment);
  if (!replace && deploymentTargets.has(key)) {
    throw new Error(`Deployment secret target ${provider}/${projectId}/${environment} already exists.`);
  }
  enforceTargetLimit(deploymentTargets, key);
  const normalized: NormalizedDeploymentTarget = {
    ...target,
    provider,
    projectId,
    environment,
    allowed: requiredSecretNames(target.allowedNames, 'Deployment secret names'),
  };
  deploymentTargets.set(key, normalized);
  return () => {
    if (deploymentTargets.get(key) === normalized) deploymentTargets.delete(key);
  };
};

const resolveOne = async (vault: SecretVault, request: SecretContextUseRequest): Promise<string> => {
  const payload = await vault.resolve({
    handle: request.handle,
    fields: [request.field],
    surface: SECRET_FIREWALL_SURFACE,
    purpose: SECRET_FIREWALL_PURPOSE,
  });
  const value = payload[request.field];
  if (!value) throw new Error('Secret destination resolution failed.');
  return value;
};

/** Build sinks whose only authority comes from trusted registrations above. */
export const createSecretDestinationSinks = (
  vault: SecretVault
): Readonly<Record<'process.env.inject' | 'deployment.secret.put', SecretContextSink>> => ({
  'process.env.inject': async (request) => {
    if (request.surface !== SECRET_FIREWALL_SURFACE || request.purpose !== SECRET_FIREWALL_PURPOSE) {
      throw new Error('Unsupported secret destination route.');
    }
    const processId = requiredTargetId(request.locator.processId ?? '', 'Managed process id');
    const variable = request.locator.variable?.trim() ?? '';
    const target = managedTargets.get(processId);
    const source = { handle: request.handle, field: request.field };
    if (
      !target ||
      request.field !== variable ||
      !target.allowed.has(variable) ||
      (target.authorizeSource && !target.authorizeSource(source))
    ) {
      throw new Error('Secret destination policy denied the request.');
    }
    const value = await resolveOne(vault, request);
    await target.inject({ name: variable, value, source });
  },
  'deployment.secret.put': async (request) => {
    if (request.surface !== SECRET_FIREWALL_SURFACE || request.purpose !== SECRET_FIREWALL_PURPOSE) {
      throw new Error('Unsupported secret destination route.');
    }
    const provider = requiredTargetId(request.locator.provider?.toLowerCase() ?? '', 'Deployment provider');
    const projectId = requiredTargetId(request.locator.projectId ?? '', 'Deployment project id');
    const environment = requiredTargetId(request.locator.environment ?? '', 'Deployment environment');
    const name = request.locator.name?.trim() ?? '';
    const target = deploymentTargets.get(deploymentKey(provider, projectId, environment));
    const source = { handle: request.handle, field: request.field };
    if (
      !target ||
      request.field !== name ||
      !target.allowed.has(name) ||
      (target.authorizeSource && !target.authorizeSource(source))
    ) {
      throw new Error('Secret destination policy denied the request.');
    }
    const value = await resolveOne(vault, request);
    await target.putSecret({ name, value, source });
  },
});

/** Test/app teardown only; does not reveal registered policy contents. */
export const resetSecretDestinationTargets = (): void => {
  managedTargets.clear();
  deploymentTargets.clear();
};
