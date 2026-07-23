import { getMcpRegistry } from '@process/resources/mcpRegistry';
import { BUILTIN_SECRET_CONTEXT_NAME } from './server';

/**
 * Remove the legacy global Secret Context catalog route.
 *
 * Secret Context now starts only through a Core session capability host, where
 * its bearer is bound to immutable session/surface claims. Persisting a shared
 * loopback endpoint would reintroduce global authorization reuse.
 */
export const ensureSecretContextMcpRegistered = async (): Promise<boolean> => {
  try {
    const registry = getMcpRegistry();
    const stale = (await registry.list()).find(
      (server) => server.name === BUILTIN_SECRET_CONTEXT_NAME && server.builtin === true
    );
    if (stale) await registry.remove(stale.id);
    return true;
  } catch {
    console.warn('[SecretContextMCP] Could not remove the legacy global catalog route.');
    return false;
  }
};
