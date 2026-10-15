/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Defines how a slash command is executed.
 * - `template`: Expands into a prompt template text
 * - `builtin`: Executes a built-in application action (e.g., /open for file picker)
 */
export type SlashCommandKind = 'template' | 'builtin';

/**
 * Defines what happens when the user selects a slash command from the menu.
 * - `execute`: run the command immediately
 * - `insert`: insert `/<name> ` into the input
 */
export type SlashCommandSelectionBehavior = 'execute' | 'insert';

/**
 * Indicates where the slash command originates from.
 * - `acp`: Provided by the ACP agent (e.g., Claude)
 * - `builtin`: Built into the application
 * - `package`: A prompt command of an installed, enabled package (expanded in Main, never run)
 */
export type SlashCommandSource = 'acp' | 'codex' | 'builtin' | 'package';

/** Read-only commands advertised by the connected CLI, not proof of executable UI support. */
export type DiscoveredCliCommand = Readonly<{ name: string; description: string }>;
export type CliCommandDiscovery = Readonly<{
  status: 'available' | 'unsupported' | 'unavailable' | 'authentication-required';
    commands: readonly DiscoveredCliCommand[];
  /** Distinguish Codex's explicit skill shortcuts from native ACP slash commands. */
  origin?: 'acp' | 'codex-app-server';
}>;

/**
 * Represents a single slash command item in the autocomplete list.
 */
export interface SlashCommandItem {
  /** Command name without the leading slash (e.g., "open", "test") */
  name: string;
  /** Human-readable description shown in the dropdown */
  description: string;
  /** How the command is executed */
  kind: SlashCommandKind;
  /** Where the command comes from */
  source: SlashCommandSource;
  /** Optional keyboard hint (e.g., "⌘O") */
  hint?: string;
  /** Optional override for how selection behaves in the slash menu */
  selectionBehavior?: SlashCommandSelectionBehavior;
  /** Optional text inserted into the composer when selectionBehavior is "insert" */
  insertText?: string;
  /** Package commands: shown after the name in the menu (for example `[file] [message]`) */
  argumentHint?: string;
  /** Package commands: the package that offers it, shown as the label */
  packageId?: string;
}

/**
 * What Main tells the renderer about an enabled package command (`conversation.native.package-commands`). No path and
 * no template text: those stay in Main. `name` is what is typed after the slash, already prefixed with
 * `<plugin>:` when another command or a built-in uses the same word.
 */
export type PackageCommandSummary = Readonly<{
  name: string;
  description: string;
  packageId: string;
  argumentHint?: string;
}>;
