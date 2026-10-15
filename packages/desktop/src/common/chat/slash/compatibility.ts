/**
 * Provider-native slash command compatibility boundary.
 * A discovered command is not necessarily executable through the current session/UI integration.
 */
import { SLASH_MODES } from './modes';
import type { CliCommandDiscovery } from './types';

export type SlashCommandDecision =
  | { kind: 'ordinary' }
  | { kind: 'native'; name: string }
  | { kind: 'tomni'; name: string }
  | {
      kind: 'unsupported';
      name: string;
      reason: 'unknown-command' | 'provider-unavailable' | 'provider-authentication-required' | 'requires-session' | 'requires-ui';
    };

export const TOMNI_SLASH_COMMAND_NAMES: ReadonlySet<string> = new Set([
  'repotopackage',
  'guide',
  'schedule',
  'remember',
  'forget',
  'goal',
  'goal-all',
  'goal-off',
  'build0',
  'execute',
  'open',
  'copy',
  'export',
  'btw',
  ...SLASH_MODES.map((mode) => mode.name),
]);

/** Some native commands still require host coordination beyond retained ACP session context. */
const SESSION_BOUND_COMMANDS: ReadonlySet<string> = new Set([
    'clear',
  'context',
  'resume',
  'rewind',
  'model',
  'permissions',
  'permission',
  'login',
  'logout',
  'config',
  'mcp',
]);

/** An arbitrary native TUI/picker cannot be synthesized from an advertised command name. */
const UI_BOUND_COMMANDS: ReadonlySet<string> = new Set([
  'btw',
  'theme',
  'keybindings',
  'terminal-setup',
  'status',
  'doctor',
]);

export const nativeCommandBlockReason = (name: string): 'requires-session' | 'requires-ui' | null => {
  if (SESSION_BOUND_COMMANDS.has(name)) return 'requires-session';
  if (UI_BOUND_COMMANDS.has(name)) return 'requires-ui';
  return null;
};

/** Do not confuse absolute file paths, URLs, or inline prose with slash commands. */
export const parseSlashCommandName = (input: string): string | null => {
  const match = /^\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79})(?=\s|$)/u.exec(input.trimStart());
  return match?.[1] ?? null;
};

/** Native takes priority over Tomni only when the connected CLI actually advertised it. */
export const decideCliSlashCommand = (
  input: string,
  catalog: CliCommandDiscovery,
  tomniNames: ReadonlySet<string> = TOMNI_SLASH_COMMAND_NAMES
): SlashCommandDecision => {
  const name = parseSlashCommandName(input);
  if (!name) return { kind: 'ordinary' };
  if (catalog.status === 'available' && catalog.commands.some((command) => command.name === name)) {
    const blocked = nativeCommandBlockReason(name);
    if (blocked) return { kind: 'unsupported', name, reason: blocked };
    return { kind: 'native', name };
  }
  if (tomniNames.has(name)) return { kind: 'tomni', name };
  return {
    kind: 'unsupported',
    name,
        reason: catalog.status === 'authentication-required'
      ? 'provider-authentication-required'
      : catalog.status === 'unavailable' ? 'provider-unavailable' : 'unknown-command',
  };
};
