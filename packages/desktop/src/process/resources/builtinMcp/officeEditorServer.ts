/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in Office-editor MCP server — the **Agent plane** for the Studio editor.
 *
 * Lets a CLI agent (Claude Code / Codex / Gemini …) edit the LIVE document the
 * user has open in the Studio editor, with fast, formatting-preserving tools.
 * The editor chat (`renderer/pages/studio/components/DocAssistantPanel.tsx`)
 * embeds the main `<ChatConversation>` and attaches this server, so "ask the
 * assistant to edit this file" is now the same full chat as the main app, plus
 * real document-editing tools.
 *
 * ## How it reaches the live editor
 *
 * ONLYOFFICE runs in the renderer; MCP servers run in Main. Each tool maps to an
 * {@link EditorToolAction} and calls {@link runEditorTool}, which `invoke`s the
 * renderer-registered editor-tools provider over the symmetric platform bridge.
 * The renderer dispatches the action to `onlyOfficeConnector` against the live
 * editor and returns a short observation. When no editor is open the tool
 * returns a clear "open the document first" error instead of hanging.
 *
 * ## Design mirrors automationMcpServer.ts
 *
 * - Factory `createOfficeEditorServer(deps)` — the single injected dep is the
 *   `runTool` invoker, so the server is pure and testable without a live editor.
 * - `McpServer` from the MCP SDK; Zod schemas per tool; `office_*` snake_case
 *   names (match `^[a-zA-Z0-9_-]+$` required by function calling).
 *
 * Process boundary: Main-process (Node.js / Electron) module — no DOM APIs.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EditorToolAction, EditorToolRunResult } from '@process/editor/editorToolsBridge';
import {
  OBJECT_ANIMATION_EFFECTS,
  OBJECT_ANIMATION_PURPOSES,
  OBJECT_ANIMATION_TRIGGERS,
  type ObjectAnimationSpec,
} from '@/common/presentationDesign';
import { validateOfficeApiScript } from '@/common/types/office/officeApiScript';

/** Canonical MCP server name for the built-in Office-editor server. */
export const BUILTIN_OFFICE_EDITOR_NAME = 'tomny-office-editor';

/** Stable identifier (parity with the other built-in server constants). */
export const BUILTIN_OFFICE_EDITOR_ID = 'builtin-office-editor';

/**
 * The slice of the editor-tools bridge this server needs. Declared structurally
 * so the factory stays pure and testable; the host injects the real invoker
 * ({@link runEditorTool}), tests inject a fake.
 */
export type OfficeEditorServerDeps = {
  /** Run one editor action against the live document for `filePath`. */
  runTool: (filePath: string, action: EditorToolAction) => Promise<EditorToolRunResult>;
};

/** Standard MCP text payload, optionally flagged as an error. */
const textResult = (
  text: string,
  isError = false
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

/** Zod schema for the shared text-format object. */
const formatSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikeout: z.boolean().optional(),
    color: z.string().optional().describe('Hex text color, e.g. "#C00000".'),
    highlight: z.string().optional().describe('Hex highlight color, e.g. "#FFFF00".'),
    fontSize: z.number().optional().describe('Font size in points.'),
    fontFamily: z.string().optional().describe('Font family name, e.g. "Times New Roman".'),
  })
  .describe('Character/paragraph formatting to apply.');

const objectAnimationSchema = z
  .object({
    slideIndex: z.number().int().min(1).describe('One-based slide index.'),
    drawingName: z.string().min(1).max(180).optional().describe('Preferred stable drawing name from animation review.'),
    drawingIndex: z.number().int().min(0).optional().describe('Zero-based same-session fallback drawing index.'),
    effect: z.enum(OBJECT_ANIMATION_EFFECTS),
    trigger: z.enum(OBJECT_ANIMATION_TRIGGERS),
    durationMs: z.number().int().min(100).max(10_000).default(500),
    delayMs: z.number().int().min(0).max(30_000).default(0),
    repeatCount: z.number().int().min(1).max(10).default(1),
    order: z.number().int().min(0).optional(),
    purpose: z.enum(OBJECT_ANIMATION_PURPOSES),
    rationale: z.string().trim().min(8).max(500),
  })
  .refine((value) => Boolean(value.drawingName) || value.drawingIndex !== undefined, {
    message: 'Provide drawingName or drawingIndex.',
  });

/** The Zod schema validates every required field; this gives bridge actions their exact shared shape. */
const normalizeObjectAnimationSpecs = (animations: z.output<typeof objectAnimationSchema>[]): ObjectAnimationSpec[] =>
  animations.map((animation, index) => ({
    slideIndex: animation.slideIndex!,
    drawingName: animation.drawingName,
    drawingIndex: animation.drawingIndex,
    effect: animation.effect!,
    trigger: animation.trigger!,
    durationMs: animation.durationMs!,
    delayMs: animation.delayMs!,
    repeatCount: animation.repeatCount!,
    order: animation.order ?? index,
    purpose: animation.purpose!,
    rationale: animation.rationale!,
  }));

const premiumDeckPlanSchema = z
  .object({
    title: z.string().describe('Deck title.'),
    subtitle: z.string().optional().describe('Deck subtitle or promise.'),

    designStyle: z
      .enum(['modern', 'minimal', 'editorial', 'technical', 'cinematic', 'academic'])
      .optional()
      .describe('Creative direction for composition, geometry and visual rhythm.'),
    theme: z
      .object({
        primary: z.string().optional().describe('Primary brand color, #RRGGBB.'),
        secondary: z.string().optional().describe('Secondary accent color, #RRGGBB.'),
        background: z.string().optional().describe('Slide background color, #RRGGBB.'),
        text: z.string().optional().describe('Main text color, #RRGGBB.'),
        fontFamily: z.string().optional().describe('Presentation font family.'),
      })
      .optional(),
    slides: z
      .array(
        z.object({
          title: z.string().describe('Slide headline.'),
          subtitle: z.string().optional().describe('Slide supporting line.'),
          bullets: z.array(z.string()).optional().describe('Short speaker-friendly bullets.'),
          layout: z
            .enum([
              'cover',
              'section',
              'content',
              'split',
              'image',
              'chart',
              'quote',
              'agenda',
              'comparison',
              'timeline',
              'process',
              'metrics',
              'architecture',
              'closing',
            ])
            .optional(),
          imageUrl: z.string().optional().describe('Generated/user-provided image URL or data:image URI.'),
          accentColor: z.string().optional().describe('Slide accent color, #RRGGBB.'),
          chartValues: z.array(z.array(z.number())).optional().describe('0-100 values for simple visual bars.'),

          chartLabels: z.array(z.string()).optional().describe('Category labels for a native chart.'),
          items: z
            .array(
              z.object({
                label: z.string(),
                value: z.string().optional(),
                detail: z.string().optional(),
                group: z.string().optional(),
              })
            )
            .optional()
            .describe('Structured items for agenda, timeline, process, metrics and architecture layouts.'),
          columns: z
            .array(z.object({ heading: z.string(), bullets: z.array(z.string()) }))
            .optional()
            .describe('Two or three structured columns for comparison layouts.'),
          source: z.string().optional().describe('Short evidence/source label rendered in the footer.'),
          speakerNotes: z.string().optional().describe('Presenter notes stored on the slide.'),
          transition: z.enum(['none', 'fade', 'push', 'wipe', 'split']).optional(),
        })
      )
      .min(1)
      .max(20),
  })
  .describe(
    'Structured premium PPTX plan with story, design direction, rich layouts, evidence, visuals and native charts.'
  );
const premiumDocPlanSchema = z
  .object({
    title: z.string().describe('Document title.'),
    subtitle: z.string().optional().describe('Executive promise or subtitle.'),

    includeToc: z.boolean().optional().describe('Apply real heading styles and insert an automatic table of contents.'),
    theme: z
      .object({
        primary: z.string().optional().describe('Primary brand color, #RRGGBB.'),
        secondary: z.string().optional().describe('Secondary accent color, #RRGGBB.'),
        background: z.string().optional().describe('Callout/background color, #RRGGBB.'),
        text: z.string().optional().describe('Main text color, #RRGGBB.'),
        fontFamily: z.string().optional().describe('Document font family.'),
      })
      .optional(),
    sections: z
      .array(
        z.object({
          heading: z.string().describe('Section heading.'),
          body: z.array(z.string()).optional().describe('Short paragraphs.'),
          bullets: z.array(z.string()).optional().describe('Scannable bullet points.'),
          callout: z.string().optional().describe('Highlighted insight/callout.'),
          imageUrl: z.string().optional().describe('Generated/user-provided image URL or data:image URI.'),
          table: z
            .object({
              headers: z.array(z.string()),
              rows: z.array(z.array(z.string())),
            })
            .optional(),
        })
      )
      .min(1)
      .max(12),
  })
  .describe('Structured premium DOCX plan with hierarchy, callouts, tables and visual blocks.');

const deckMacroThemeSchema = z
  .object({
    primary: z.string().optional(),
    secondary: z.string().optional(),
    background: z.string().optional(),
    text: z.string().optional(),
    fontFamily: z.string().optional(),
  })
  .optional();

const deckDesignStyleSchema = z
  .enum(['modern', 'minimal', 'editorial', 'technical', 'cinematic', 'academic'])
  .optional();

const deckTransitionSchema = z.enum(['none', 'fade', 'push', 'wipe', 'split']).optional();

const deckMacroItemSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
  detail: z.string().optional(),
  group: z.string().optional(),
});

/**
 * Build the Office-editor {@link McpServer} bound to the injected deps.
 *
 * @param deps The editor-tools invoker (real bridge in production, fake in tests).
 * @returns A configured MCP server; the caller (host) connects a transport.
 */
export const createOfficeEditorServer = (deps: OfficeEditorServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_OFFICE_EDITOR_NAME, version: '1.0.0' });

  /** Run an action and project the result envelope onto an MCP text payload. */
  const run = async (filePath: string, action: EditorToolAction) => {
    const result = await deps.runTool(filePath, action);
    if (result.ok) return textResult(result.observation);
    // strictNullChecks is off in the root tsconfig, so TS does not narrow the
    // `{ ok: false }` branch of the union; cast locally to read `error`.
    return textResult((result as Extract<EditorToolRunResult, { ok: false }>).error, true);
  };

  // --- office_get_capabilities ---------------------------------------------
  server.tool(
    'office_get_capabilities',
    `Inspect live Office support before using advanced tools. This probe never waits for a connector and
fails closed when the current Document Server lacks ONLYOFFICE createConnector()/Automation API.
It reports editor readiness plus separate automationApi, objectAnimation, slideShowControl and
recording statuses with concrete reasons.

Input:
- filePath: absolute path of the Office document to inspect (required).`,
    {
      filePath: z.string().describe('Absolute path of the Office document to inspect.'),
    },
    ({ filePath }) => run(filePath, { tool: 'get_capabilities' })
  );

  // --- office_read_document ------------------------------------------------
  server.tool(
    'office_read_document',
    `Read the current plain text of the document open in the Studio editor. Call this first when you
need to know the document's content before editing it.

Input:
- filePath: absolute path of the open document (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
    },
    ({ filePath }) => run(filePath, { tool: 'read_document' })
  );

  // --- office_search_replace -----------------------------------------------
  server.tool(
    'office_search_replace',
    `Replace EVERY occurrence of a string in the document. Works for Word, spreadsheet and slides.

Input:
- filePath: absolute path of the open document (required)
- search: the exact text to find (required)
- replace: the replacement text (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      search: z.string().describe('Exact text to find.'),
      replace: z.string().describe('Replacement text.'),
    },
    ({ filePath, search, replace }) => run(filePath, { tool: 'search_replace', search, replace })
  );

  // --- office_replace_passage ----------------------------------------------
  server.tool(
    'office_replace_passage',
    `Replace ONE specific passage (Word only), located by an anchor — the reliable way to edit a
particular paragraph. With "find" alone it replaces the FIRST occurrence. With "find"+"until" it
replaces everything from the start of "find" through the end of the first following "until" — pass
the first words as "find" and the last words as "until" to target a long paragraph.

Input:
- filePath (required), find (required), replacement (required), until (optional).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      find: z.string().describe('Anchor text at the start of the passage.'),
      replacement: z.string().describe('Text to write in place of the passage.'),
      until: z.string().optional().describe('Anchor text at the end of the passage (for long passages).'),
    },
    ({ filePath, find, replacement, until }) =>
      run(filePath, { tool: 'replace_passage', find, replacement, ...(until !== undefined ? { until } : {}) })
  );

  // --- office_insert_text --------------------------------------------------
  server.tool(
    'office_insert_text',
    `Insert/paste text at the current cursor (replacing any selection).

Input:
- filePath (required), text (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      text: z.string().describe('Text to insert at the cursor.'),
    },
    ({ filePath, text }) => run(filePath, { tool: 'insert_text', text })
  );

  // --- office_append_text --------------------------------------------------
  server.tool(
    'office_append_text',
    `Append a paragraph at the end of the document (Word only).

Input:
- filePath (required), text (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      text: z.string().describe('Paragraph text to append.'),
    },
    ({ filePath, text }) => run(filePath, { tool: 'append_text', text })
  );

  // --- office_replace_all --------------------------------------------------
  server.tool(
    'office_replace_all',
    `Replace the WHOLE document with new text (Word only). Use only when rewriting the entire
document; prefer office_search_replace / office_replace_passage for targeted edits.

Input:
- filePath (required), text (required) — the complete new document text.`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      text: z.string().describe('Complete new document text.'),
    },
    ({ filePath, text }) => run(filePath, { tool: 'replace_all', text })
  );

  // --- office_apply_headings -----------------------------------------------
  server.tool(
    'office_apply_headings',
    `Apply real heading styles (Heading 1–9) to paragraphs by their exact text (Word only). Use this
to mark section titles so a table of contents can pick them up.

Input:
- filePath (required)
- headings: array of { text: exact paragraph text, level: 1–9 } (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      headings: z
        .array(z.object({ text: z.string(), level: z.number() }))
        .describe('Paragraphs to style: { text, level 1–9 }.'),
    },
    ({ filePath, headings }) =>
      run(filePath, {
        tool: 'apply_headings',
        headings: headings.map((h) => ({ text: String(h.text), level: Number(h.level) })),
      })
  );

  // --- office_insert_toc ---------------------------------------------------
  server.tool(
    'office_insert_toc',
    `Insert a real, auto-updating Table of Contents from the heading-styled paragraphs (Word only).
Apply headings FIRST (office_apply_headings).

Input:
- filePath (required)
- atStart: insert at the document start (optional, default true).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      atStart: z.boolean().optional().describe('Insert at the document start (default true).'),
    },
    ({ filePath, atStart }) => run(filePath, { tool: 'insert_toc', ...(atStart !== undefined ? { atStart } : {}) })
  );

  // --- office_format_text --------------------------------------------------
  server.tool(
    'office_format_text',
    `Apply character formatting to EVERY occurrence of a string (Word only): bold/italic/underline/
strikeout/color/highlight/fontSize/fontFamily.

Input:
- filePath (required), search (required), format (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      search: z.string().describe('Exact text to format.'),
      format: formatSchema,
    },
    ({ filePath, search, format }) => run(filePath, { tool: 'format_text', search, format })
  );

  // --- office_format_passage -----------------------------------------------
  server.tool(
    'office_format_passage',
    `Format ONE specific passage (Word only), located by an anchor — like selecting the whole
paragraph then applying bold/italic/etc. "find" alone targets the first occurrence; "find"+"until"
covers a long passage (first words as "find", last words as "until").

Input:
- filePath (required), find (required), format (required), until (optional).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      find: z.string().describe('Anchor text at the start of the passage.'),
      format: formatSchema,
      until: z.string().optional().describe('Anchor text at the end of the passage (for long passages).'),
    },
    ({ filePath, find, format, until }) =>
      run(filePath, { tool: 'format_passage', find, format, ...(until !== undefined ? { until } : {}) })
  );

  // --- office_insert_table -------------------------------------------------
  server.tool(
    'office_insert_table',
    `Insert a table at the end of the document (Word only). When "data" is given it fills the cells
and sets the size.

Input:
- filePath (required), rows (required), cols (required), data (optional 2D string array).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      rows: z.number().describe('Number of rows (>= 1).'),
      cols: z.number().describe('Number of columns (>= 1).'),
      data: z.array(z.array(z.string())).optional().describe('Optional cell values, row by row.'),
    },
    ({ filePath, rows, cols, data }) =>
      run(filePath, { tool: 'insert_table', rows, cols, ...(data !== undefined ? { data } : {}) })
  );

  // --- office_set_cells ----------------------------------------------------
  server.tool(
    'office_set_cells',
    `Write a block of spreadsheet cells (spreadsheet only). Values are written row-by-row from the
"start" cell.

Input:
- filePath (required), start (e.g. "A1", required), values (2D array, required), sheet (optional).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      start: z.string().describe('Top-left cell reference, e.g. "A1".'),
      values: z.array(z.array(z.union([z.string(), z.number()]))).describe('2D array of values written from "start".'),
      sheet: z.string().optional().describe('Sheet name (defaults to the active sheet).'),
    },
    ({ filePath, start, values, sheet }) =>
      run(filePath, { tool: 'set_cells', start, values, ...(sheet !== undefined ? { sheet } : {}) })
  );

  // --- office_create_premium_doc ------------------------------------------
  server.tool(
    'office_create_premium_doc',
    `Create or redesign the open DOCX as a polished, document-native deliverable from a structured plan.
Use this for proposals, reports, briefs, strategy docs, SOPs, and polished documents that should not
look like plain model output. It creates hierarchy, styled title treatment, callouts, tables, image
blocks when imageUrl is supplied, and scannable executive density.

Input:
- filePath (required), plan (required).`,
    {
      filePath: z.string().describe('Absolute path of the open DOCX.'),
      plan: premiumDocPlanSchema,
    },
    ({ filePath, plan }) => run(filePath, { tool: 'create_premium_doc', plan })
  );

  // --- office_create_premium_deck -----------------------------------------
  server.tool(
    'office_create_premium_deck',
    `Create or redesign the open PPTX as a polished, presentation-native deck from a structured plan.
Use this instead of raw text insertion when the user asks for a beautiful deck, pitch deck, proposal,
or any PPTX that should compete with dedicated presentation generators. It creates real slides with
layout, theme colors, visual hierarchy, chart-like bars, image backgrounds when imageUrl is supplied,
and speaker-friendly density. Generate/attach image assets first when strong visuals are required.

Input:
- filePath (required), plan (required).`,
    {
      filePath: z.string().describe('Absolute path of the open PPTX.'),
      plan: premiumDeckPlanSchema,
    },
    ({ filePath, plan }) => run(filePath, { tool: 'create_premium_deck', plan })
  );

  // --- presentation-native slide macros -----------------------------------
  server.tool(
    'office_add_agenda_slide',
    'Append a polished agenda/table-of-contents slide to the open PPTX without rebuilding existing slides.',
    {
      filePath: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      sections: z.array(z.string()).min(2).max(8),
      designStyle: deckDesignStyleSchema,
      theme: deckMacroThemeSchema,
      source: z.string().optional(),
      speakerNotes: z.string().optional(),
      transition: deckTransitionSchema,
    },
    ({ filePath, title, subtitle, sections, designStyle, theme, source, speakerNotes, transition }) =>
      run(filePath, {
        tool: 'add_premium_slide',
        plan: {
          title,
          subtitle,
          designStyle,
          theme,
          slides: [
            {
              title,
              subtitle,
              layout: 'agenda',
              items: sections.map((label) => ({ label })),
              source,
              speakerNotes,
              transition,
            },
          ],
        },
      })
  );

  server.tool(
    'office_add_comparison_slide',
    'Append a presentation-native two/three-column comparison slide with clear visual hierarchy.',
    {
      filePath: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      columns: z
        .array(z.object({ heading: z.string(), bullets: z.array(z.string()).min(1).max(5) }))
        .min(2)
        .max(3),
      designStyle: deckDesignStyleSchema,
      theme: deckMacroThemeSchema,
      source: z.string().optional(),
      speakerNotes: z.string().optional(),
      transition: deckTransitionSchema,
    },
    ({ filePath, title, subtitle, columns, designStyle, theme, source, speakerNotes, transition }) =>
      run(filePath, {
        tool: 'add_premium_slide',
        plan: {
          title,
          subtitle,
          designStyle,
          theme,
          slides: [{ title, subtitle, layout: 'comparison', columns, source, speakerNotes, transition }],
        },
      })
  );

  server.tool(
    'office_add_timeline_slide',
    'Append a milestone timeline slide. Use value for date/phase and detail for supporting evidence.',
    {
      filePath: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      steps: z.array(deckMacroItemSchema).min(2).max(5),
      designStyle: deckDesignStyleSchema,
      theme: deckMacroThemeSchema,
      source: z.string().optional(),
      speakerNotes: z.string().optional(),
      transition: deckTransitionSchema,
    },
    ({ filePath, title, subtitle, steps, designStyle, theme, source, speakerNotes, transition }) =>
      run(filePath, {
        tool: 'add_premium_slide',
        plan: {
          title,
          subtitle,
          designStyle,
          theme,
          slides: [{ title, subtitle, layout: 'timeline', items: steps, source, speakerNotes, transition }],
        },
      })
  );

  server.tool(
    'office_add_process_slide',
    'Append a numbered process/demo-flow slide with up to six concise steps.',
    {
      filePath: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      steps: z.array(deckMacroItemSchema).min(2).max(6),
      designStyle: deckDesignStyleSchema,
      theme: deckMacroThemeSchema,
      source: z.string().optional(),
      speakerNotes: z.string().optional(),
      transition: deckTransitionSchema,
    },
    ({ filePath, title, subtitle, steps, designStyle, theme, source, speakerNotes, transition }) =>
      run(filePath, {
        tool: 'add_premium_slide',
        plan: {
          title,
          subtitle,
          designStyle,
          theme,
          slides: [{ title, subtitle, layout: 'process', items: steps, source, speakerNotes, transition }],
        },
      })
  );

  server.tool(
    'office_add_metrics_slide',
    'Append a strong metric-card slide. Each metric supports value, label and a short detail.',
    {
      filePath: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      metrics: z.array(deckMacroItemSchema).min(1).max(4),
      designStyle: deckDesignStyleSchema,
      theme: deckMacroThemeSchema,
      source: z.string().optional(),
      speakerNotes: z.string().optional(),
      transition: deckTransitionSchema,
    },
    ({ filePath, title, subtitle, metrics, designStyle, theme, source, speakerNotes, transition }) =>
      run(filePath, {
        tool: 'add_premium_slide',
        plan: {
          title,
          subtitle,
          designStyle,
          theme,
          slides: [{ title, subtitle, layout: 'metrics', items: metrics, source, speakerNotes, transition }],
        },
      })
  );

  server.tool(
    'office_add_architecture_slide',
    'Append a layered system-architecture slide for components, trust boundaries or technology stacks.',
    {
      filePath: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      layers: z.array(deckMacroItemSchema).min(2).max(5),
      designStyle: deckDesignStyleSchema,
      theme: deckMacroThemeSchema,
      source: z.string().optional(),
      speakerNotes: z.string().optional(),
      transition: deckTransitionSchema,
    },
    ({ filePath, title, subtitle, layers, designStyle, theme, source, speakerNotes, transition }) =>
      run(filePath, {
        tool: 'add_premium_slide',
        plan: {
          title,
          subtitle,
          designStyle,
          theme,
          slides: [{ title, subtitle, layout: 'architecture', items: layers, source, speakerNotes, transition }],
        },
      })
  );

  server.tool(
    'office_add_speaker_notes',
    'Add presenter notes to one slide without placing the notes on the visible canvas.',
    {
      filePath: z.string(),
      slideIndex: z.number().int().min(1).describe('One-based slide index.'),
      text: z.string().min(1).max(2000),
    },
    ({ filePath, slideIndex, text }) => run(filePath, { tool: 'add_speaker_notes', slideIndex, text })
  );

  server.tool(
    'office_apply_slide_transitions',
    'Apply one restrained transition consistently across the open deck.',
    {
      filePath: z.string(),
      effect: z.enum(['fade', 'push', 'wipe', 'split']),
      speed: z.enum(['slow', 'medium', 'fast']).optional(),
    },
    ({ filePath, effect, speed }) =>
      run(filePath, { tool: 'apply_slide_transitions', effect, speed: speed ?? 'medium' })
  );

  server.tool(
    'office_apply_object_animations',
    `Apply purpose-led object animations to an open PPTX. Call office_get_capabilities and
office_review_object_animations first: use drawingName as the stable target and drawingIndex only as a
same-session guard. Every animation must explain its instructional purpose. This tool alters only the
main sequence; interactive sequences are preserved. It runtime-checks ONLYOFFICE timeline APIs before
making a change and never claims slide-show recording or playback support.`,
    {
      filePath: z.string(),
      animations: z.array(objectAnimationSchema).min(1).max(256),
      replaceExistingMainSequence: z.boolean().optional(),
    },
    ({ filePath, animations, replaceExistingMainSequence }) =>
      run(filePath, {
        tool: 'apply_object_animations',
        animations: normalizeObjectAnimationSpecs(animations),
        replaceExistingMainSequence: replaceExistingMainSequence === true,
      })
  );

  server.tool(
    'office_review_object_animations',
    `Inspect the live presentation timeline and drawing inventory for purpose-led animation QA.
It reports stable drawing names, temporary drawing indices, timing/density issues, and can reconcile
the live timeline against an expected animation plan. Call it before target selection and after apply.`,
    {
      filePath: z.string(),
      expectedAnimations: z.array(objectAnimationSchema).min(1).max(256).optional(),
    },
    ({ filePath, expectedAnimations }) =>
      run(filePath, {
        tool: 'review_object_animations',
        expectedAnimations: expectedAnimations ? normalizeObjectAnimationSpecs(expectedAnimations) : undefined,
      })
  );

  server.tool(
    'office_structure_report',
    'Apply real Word heading styles and optionally insert an automatic table of contents in one operation.',
    {
      filePath: z.string(),
      headings: z
        .array(z.object({ text: z.string(), level: z.number().int().min(1).max(9) }))
        .min(1)
        .max(40),
      insertToc: z.boolean().optional(),
    },
    ({ filePath, headings, insertToc }) =>
      run(filePath, {
        tool: 'structure_report',
        headings: headings.map((heading) => ({ text: String(heading.text), level: Number(heading.level) })),
        insertToc: insertToc !== false,
      })
  );

  server.tool(
    'office_open_visual_review',
    'Open the current DOCX/PPTX/XLSX in the rendered preview panel for human visual QA.',
    { filePath: z.string() },
    ({ filePath }) => run(filePath, { tool: 'open_visual_review' })
  );

  // --- office_review_premium_quality --------------------------------------
  server.tool(
    'office_review_premium_quality',
    `Audit the open DOCX/PPTX after creation or edits and return a concrete premium-quality checklist.
Call this before final response for decks/docs intended to beat generic presentation/document agents.
It reads the live editor content and flags weak structure, density, missing proof, missing visuals,
and missing next actions so the agent can revise with office_* tools before reporting completion.

Input:
- filePath (required).`,
    {
      filePath: z.string().describe('Absolute path of the open Office document.'),
    },
    ({ filePath }) => run(filePath, { tool: 'review_premium_quality' })
  );

  // --- office_run_api ------------------------------------------------------
  server.tool(
    'office_run_api',
    `Run ANY ONLYOFFICE Document Builder API script in the live editor - the "do anything Office can
do" tool for things the specific tools above do not cover (tables, images, charts, fonts/colors,
page setup, sections, comments, complex formatting). For premium PPTX decks, use this to create
real presentation structure: add slides, place shapes/images, build visual hierarchy, apply brand
colors, create charts/diagrams, tune typography, and add transitions/effects when supported.

"code" is a JS function body that uses the editor global \`Api\` and may \`return\` a JSON-serializable
value. Word: \`Api.GetDocument()\`; Spreadsheet: \`Api.GetActiveSheet()\`; Presentation:
\`Api.GetPresentation()\`. It is sandboxed to the document (no file/network/Node access).

Input:
- filePath (required), code (required).`,
    {
      filePath: z.string().describe('Absolute path of the open document.'),
      code: z.string().describe('Document Builder API script body (uses the global `Api`).'),
    },
    ({ filePath, code }) => {
      const validation = validateOfficeApiScript(code);
      if (validation.ok === false) {
        return textResult(`Office API script rejected: ${validation.reason}.`, true);
      }
      return run(filePath, { tool: 'run_office_api', code: validation.code });
    }
  );

  return server;
};
