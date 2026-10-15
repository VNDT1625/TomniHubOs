/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { commonFields, connectionId, description, packagePath, title, type Shaped } from '../primitives';

/**
 * Connections that point at files kept under `source/`: a skill, a prompt template, an agent definition, a rules
 * file, a set of knowledge files and a VS Code extension. They are data: the host copies or reads them and never
 * executes them, and none of their fields grants a capability (`tools` and `allowed-tools` are hints at most).
 */

export const buildSkillConnection = (shaped: Shaped) =>
  shaped({ kind: z.literal('skill'), path: packagePath, ...commonFields });

/** `command`: a prompt template (`.md`, `.toml` or `.prompt.md`). It runs no code and grants no permission. */
export const buildCommandConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('command'),
    id: connectionId,
    title,
    description: description.optional(),
    path: packagePath.refine((value) => /\.(?:md|toml)$/iu.test(value), 'must be a .md or .toml file'),
    format: z.enum(['markdown', 'gemini-toml', 'copilot-prompt']),
    argumentHint: z.string().max(200).optional(),
    ...commonFields,
  });

/** `agent`: becomes an Assistant. `tools` is a suggestion and grants nothing. */
export const buildAgentConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('agent'),
    id: connectionId,
    title,
    description: description.optional(),
    path: packagePath,
    format: z.enum(['claude-md', 'copilot-agent', 'opencode-md']),
    tools: z.array(z.string().min(1).max(64)).max(50).optional(),
    model: z.string().min(1).max(64).optional(),
    ...commonFields,
  });

/** `rules`: instructions for the agent, kept in whatever format the repository used. */
export const buildRulesConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('rules'),
    id: connectionId,
    title,
    path: packagePath,
    format: z.enum(['agents-md', 'claude-md', 'gemini-md', 'cursor-mdc', 'copilot', 'windsurf', 'kiro', 'plain']),
    ...commonFields,
  });

/** `knowledge`: documents the agent may search. */
export const buildKnowledgeConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('knowledge'),
    id: connectionId,
    title,
    paths: z.array(packagePath).min(1).max(200),
    ...commonFields,
  });

/** `vscode`: the themes, grammars and similar static contributions of a VS Code extension (not its code). */
export const buildVscodeConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('vscode'),
    id: connectionId,
    title,
    /** The extension's `package.json`. */
    path: packagePath,
    contributes: z
      .array(z.enum(['themes', 'grammars', 'snippets', 'languages', 'iconThemes']))
      .min(1)
      .max(5),
    ...commonFields,
  });
