import type { CoreCapabilityPermissionRequest } from '@process/experimentalCore/adapters';

type AgentExecutionPermissionScope = {
  requestPermission: (request: CoreCapabilityPermissionRequest) => Promise<boolean>;
};

const scopes = new Map<string, AgentExecutionPermissionScope>();

/** Bind a live parent approval channel to an opaque execution scope. Newer registrations replace stale turns safely. */
export const registerAgentExecutionPermissionScope = (
  scopeId: string,
  requestPermission: AgentExecutionPermissionScope['requestPermission']
): (() => void) => {
  const id = scopeId.trim();
  if (!id) throw new Error('Agent execution permission scope id is required.');
  const registration = { requestPermission };
  scopes.set(id, registration);
  return () => {
    if (scopes.get(id) === registration) scopes.delete(id);
  };
};

/** Fail closed when a parent turn ended, the app restarted, or its approval channel is unavailable. */
export const requestAgentExecutionPermission = async (
  scopeId: string | undefined,
  request: CoreCapabilityPermissionRequest
): Promise<boolean> => {
  const scope = scopeId ? scopes.get(scopeId) : undefined;
  if (!scope) return false;
  try {
    return (await scope.requestPermission(request)) === true;
  } catch {
    return false;
  }
};
