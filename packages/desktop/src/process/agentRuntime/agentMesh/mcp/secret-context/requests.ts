import { randomUUID } from 'node:crypto';

/** Where the app may type a secret. Each maps to a vault binding and a trusted Main-owned sink. */
export type SecretDestination = 'browser' | 'terminal' | 'process' | 'deploy';

/** An agent's ask for a secret that does not exist yet. It carries no value: the person supplies it. */
export type SecretRequest = Readonly<{
  id: string;
  label: string;
  note: string;
  fields: readonly string[];
  destinations: readonly SecretDestination[];
  hosts?: readonly string[];
  createdAt: number;
}>;

export type SecretRequestInput = Omit<SecretRequest, 'id' | 'createdAt'>;

export type SecretRequestStore = {
  add(sessionId: string, input: SecretRequestInput): SecretRequest;
  list(sessionId: string): SecretRequest[];
  dismiss(sessionId: string, id: string): boolean;
  clearSession(sessionId: string): void;
};

const MAX_PER_SESSION = 16;
const MAX_SESSIONS = 256;

/** Pending requests live in RAM only and end with the conversation, like the session secrets they lead to. */
export const createSecretRequestStore = (now: () => number = Date.now): SecretRequestStore => {
  const sessions = new Map<string, SecretRequest[]>();
  return {
    add: (sessionId, input) => {
      const request: SecretRequest = { ...structuredClone(input), id: randomUUID(), createdAt: now() };
      const current = sessions.get(sessionId) ?? [];
      // A session keeps its newest requests; the oldest conversation is forgotten first when the table is full.
      sessions.delete(sessionId);
      sessions.set(sessionId, [...current, request].slice(-MAX_PER_SESSION));
      while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
      return request;
    },
    list: (sessionId) => structuredClone(sessions.get(sessionId) ?? []),
    dismiss: (sessionId, id) => {
      const current = sessions.get(sessionId) ?? [];
      const next = current.filter((request) => request.id !== id);
      if (next.length === current.length) return false;
      if (next.length === 0) sessions.delete(sessionId);
      else sessions.set(sessionId, next);
      return true;
    },
    clearSession: (sessionId) => {
      sessions.delete(sessionId);
    },
  };
};

let shared: SecretRequestStore | undefined;

/** Process-wide store shared by the agent tool and the Hub panel. */
export const getSecretRequestStore = (): SecretRequestStore => {
  shared ??= createSecretRequestStore();
  return shared;
};
