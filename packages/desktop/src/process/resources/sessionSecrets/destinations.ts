import type { SecretBinding } from '@process/agentRuntime/contextTypes';
import { normalizeExactSecretHostnames } from '@process/agentRuntime/secretVault';
import {
  SECRET_DESTINATION_ORDER,
  SECRET_DESTINATION_ROUTES,
  type SecretDestinationId,
} from '@/common/types/platform/sessionSecrets';

export { destinationsOfBinding } from '@/common/types/platform/sessionSecrets';

/** The owner route: lets the person who owns a set reveal it after native approval. No sink or agent can use it. */
export const OWNER_SURFACE = 'owner';
export const OWNER_REVEAL_PURPOSE = 'reveal';

/**
 * The vault binding for a set that may be typed into the chosen destinations. A web form needs exact hostnames; the
 * other destinations are guarded by their own trusted sink. Every set also carries the owner route so its owner can
 * reveal it.
 */
export const bindingForDestinations = (
  destinations: readonly SecretDestinationId[],
  hosts?: readonly string[]
): SecretBinding => {
  const chosen = SECRET_DESTINATION_ORDER.filter((destination) => destinations.includes(destination));
  if (chosen.length === 0) throw new Error('A secret set needs at least one destination.');
  const targets = chosen.includes('browser') ? normalizeExactSecretHostnames([...(hosts ?? [])]) : undefined;
  return {
    surfaces: [...chosen.map((destination) => SECRET_DESTINATION_ROUTES[destination].surface), OWNER_SURFACE],
    purposes: [...chosen.map((destination) => SECRET_DESTINATION_ROUTES[destination].purpose), OWNER_REVEAL_PURPOSE],
    ...(targets ? { targets } : {}),
  };
};

/** Validate the destinations a renderer sent. Absent stays absent so older callers keep their binding. */
export const parseSecretDestinations = (value: unknown): SecretDestinationId[] | undefined => {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !SECRET_DESTINATION_ORDER.includes(item as SecretDestinationId))
  ) {
    throw new Error('Secret destinations must be a non-empty list of known destinations.');
  }
  return [...new Set(value as SecretDestinationId[])];
};

/**
 * The binding of an app-scoped set saved from Settings. Without destinations it is the original web-plus-firewall
 * binding, so existing callers are unchanged; with destinations a terminal-only set needs no hostname.
 */
export const bindingForPersonalSet = (
  destinations: readonly SecretDestinationId[] | undefined,
  targets: unknown
): SecretBinding =>
  destinations === undefined
    ? {
        surfaces: ['browser', 'secret-firewall'],
        purposes: ['browser-fill', 'opaque-use'],
        targets: normalizeExactSecretHostnames(targets as string[]),
      }
    : bindingForDestinations(destinations, Array.isArray(targets) ? (targets as string[]) : []);
