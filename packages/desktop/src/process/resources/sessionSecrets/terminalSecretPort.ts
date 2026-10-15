import type { TerminalSecretPort } from '@process/agentRuntime/agentMesh/mcp/secret-context/sinks';

type Options = {
  /** Terminals that are open right now. */
  list: () => ReadonlyArray<{ id: string }>;
  write: (terminalId: string, data: string) => void;
  /** Native approval dialog. Resolves true only when the person allows secrets to be typed there. */
  ask: (terminalId: string) => Promise<boolean>;
};

/**
 * Lets the secret firewall type into a terminal. The person approves each terminal once; the approval ends with
 * the terminal, so a new terminal that reuses an id is asked about again.
 */
export const createTerminalSecretPort = (options: Options): TerminalSecretPort => {
  const approved = new Set<string>();
  const open = (): Set<string> => {
    const ids = new Set(options.list().map((terminal) => terminal.id));
    for (const id of approved) if (!ids.has(id)) approved.delete(id);
    return ids;
  };
  return {
    exists: (terminalId) => open().has(terminalId),
    confirm: async (terminalId) => {
      if (!open().has(terminalId)) return false;
      if (approved.has(terminalId)) return true;
      if (!(await options.ask(terminalId))) return false;
      // The terminal may have closed while the dialog was open.
      if (!open().has(terminalId)) return false;
      approved.add(terminalId);
      return true;
    },
    write: (terminalId, data) => options.write(terminalId, data),
  };
};
