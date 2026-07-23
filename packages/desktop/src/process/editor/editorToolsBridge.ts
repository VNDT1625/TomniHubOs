/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Editor-tools bridge — the **Main→Renderer** RPC contract that lets the
 * Office-editor MCP server (Main process) drive the LIVE ONLYOFFICE editor that
 * only exists in the renderer.
 *
 * Unlike every other bridge in this app, the **handler is registered in the
 * renderer** (`renderer/pages/studio/editorToolsProvider.ts`) and **invoked
 * from Main** (`process/editor/editorToolsClient.ts`). The `@office-ai/platform`
 * bridge transport is symmetric — both processes call `bridge.adapter({emit,on})`
 * and `invoke`/`provider` round-trip in either direction — so a `provider`
 * registered in the renderer answers an `invoke` issued from Main. This is how a
 * Main-process MCP tool can run `onlyOfficeConnector` commands inside the live
 * editor (read/replace/insert/format/run-api), keeping the document's full
 * formatting.
 *
 * This module only DECLARES the channel + payload types (shared contract). It
 * registers no handler: the renderer owns the handler, Main owns the invoker
 * (see {@link editorToolsClient}). Keeping the declaration here (Node side) lets
 * the Main client import the channel names + types without reaching into the
 * renderer tree.
 *
 * Process boundary: type/contract module — safe to import from either side.
 */

/** Single IPC channel: the renderer runs one validated editor action. */
export const EDITOR_TOOLS_CHANNELS = {
  /** Run one {@link EditorToolAction} against the live editor for a file. */
  run: 'editor-tools.run',
} as const;

/** Document family the tools branch on (mirrors `OfficeDocKind`). */
import type { ObjectAnimationSpec } from '@/common/presentationDesign';

export type EditorToolDocKind = 'word' | 'cell' | 'slide';

/** One fail-closed, end-to-end Office capability exposed to an agent. */
export type EditorToolCapabilityStatus = {
  /** True only when the app currently has a callable implementation. */
  supported: boolean;
  /** Human-readable evidence or the concrete reason the capability is unavailable. */
  reason: string;
};

/** Live Office capability snapshot for one file. */
export type EditorToolCapabilities = {
  /** Path requested by the caller (the connector registry may resolve it tolerantly). */
  filePath: string;
  /** Document family when an editor state is registered. */
  kind: EditorToolDocKind | null;
  /** Whether the editor reported that the document is ready. */
  editorReady: boolean;
  /** ONLYOFFICE `createConnector()` is present and returned a live connector. */
  automationApi: EditorToolCapabilityStatus;
  /** Purposeful per-object animation apply/review support in the agent tool surface. */
  objectAnimation: EditorToolCapabilityStatus;
  /** Programmatic slide-show playback/control support in the app. */
  slideShowControl: EditorToolCapabilityStatus;
  /** Slide-show recording plus agent-visible playback-review support. */
  recording: EditorToolCapabilityStatus;
};

/** Character/paragraph formatting (mirrors `TextFormat` in onlyOfficeConnector). */
export type EditorToolTextFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeout?: boolean;
  /** Hex color, e.g. "#C00000". */
  color?: string;
  /** Hex highlight, e.g. "#FFFF00". */
  highlight?: string;
  /** Font size in points. */
  fontSize?: number;
  /** Font family name. */
  fontFamily?: string;
};

/**
 * One action the Office-editor MCP asks the renderer to perform on the live
 * document for `filePath`. Mirrors the tool catalogue in `docAgentTools.ts`, but
 * lives in Main so the MCP server can type its inputs without importing renderer
 * code. The renderer validates + dispatches each action to `onlyOfficeConnector`.
 */
export type EditorToolAction =
  | { tool: 'get_capabilities' }
  | { tool: 'read_document' }
  | { tool: 'replace_all'; text: string }
  | { tool: 'search_replace'; search: string; replace: string }
  | { tool: 'replace_passage'; find: string; replacement: string; until?: string }
  | { tool: 'insert_text'; text: string }
  | { tool: 'append_text'; text: string }
  | { tool: 'apply_headings'; headings: Array<{ text: string; level: number }> }
  | { tool: 'insert_toc'; atStart?: boolean }
  | { tool: 'format_text'; search: string; format: EditorToolTextFormat }
  | { tool: 'format_passage'; find: string; format: EditorToolTextFormat; until?: string }
  | { tool: 'insert_table'; rows: number; cols: number; data?: string[][] }
  | { tool: 'set_cells'; start: string; values: Array<Array<string | number>>; sheet?: string }
  | { tool: 'create_premium_doc'; plan: unknown }
  | { tool: 'create_premium_deck'; plan: unknown }
  | { tool: 'add_premium_slide'; plan: unknown }
  | { tool: 'structure_report'; headings: Array<{ text: string; level: number }>; insertToc: boolean }
  | { tool: 'add_speaker_notes'; slideIndex: number; text: string }
  | { tool: 'apply_slide_transitions'; effect: 'fade' | 'push' | 'wipe' | 'split'; speed: 'slow' | 'medium' | 'fast' }
  | {
      tool: 'apply_object_animations';
      animations: ObjectAnimationSpec[];
      /** Clears only the main sequence on touched slides. */
      replaceExistingMainSequence: boolean;
    }
  | { tool: 'review_object_animations'; expectedAnimations?: ObjectAnimationSpec[] }
  | { tool: 'review_premium_quality' }
  | { tool: 'open_visual_review' }
  | { tool: 'run_office_api'; code: string };

/** Request for {@link EDITOR_TOOLS_CHANNELS.run}. */
export type EditorToolRunRequest = {
  /** Absolute path of the open document (keys the live connector registry). */
  filePath: string;
  /** The action to run. */
  action: EditorToolAction;
};

/**
 * Result envelope — always resolves (never rejects) so the Main caller can
 * branch on `ok`. `observation` is the short text the MCP feeds back to the
 * model; `kind` reports the document family when known.
 */
export type EditorToolRunResult =
  | {
      ok: true;
      observation: string;
      kind: EditorToolDocKind | null;
      /** Present only for `get_capabilities`; MCP rejects a missing snapshot. */
      capabilities?: EditorToolCapabilities;
    }
  | { ok: false; error: string; reason: 'not-ready' | 'error' };
