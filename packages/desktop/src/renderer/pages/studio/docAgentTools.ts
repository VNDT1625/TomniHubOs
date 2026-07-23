/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `docAgentTools` — the tool catalogue + dispatcher used to edit the *live*
 * ONLYOFFICE document via {@link onlyOfficeConnector}.
 *
 * The Office-editor MCP server (Main process) sends ONE action at a time over
 * the editor-tools bridge; the renderer provider
 * ({@link file://./editorToolsProvider.ts}) validates it with {@link parseAction}
 * and runs it with {@link runTool} against the live editor, returning a short
 * observation. Tools run locally inside the editor, and the Office API escape
 * hatch is timeout-guarded so a stalled editor command cannot hang the agent.
 *
 * Renderer-only.
 */

import {
  appendText,
  applyHeadings,
  formatPassage,
  formatText,
  getOfficeCapabilities,
  insertHtml,
  insertTable,
  insertTableOfContents,
  insertText,
  readText,
  replaceAllText,
  replacePassage,
  runOfficeScript,
  searchReplace,
  setCells,
  type OfficeDocKind,
  type TextFormat,
} from '@renderer/pages/editor/adapters/onlyOfficeConnector';
import type { PreviewContentType } from '@/common/types/office/preview';
import type { EditorToolCapabilities } from '@process/editor/editorToolsBridge';
import {
  buildPremiumDeckDesignScript,
  OBJECT_ANIMATION_EFFECTS,
  OBJECT_ANIMATION_PURPOSES,
  OBJECT_ANIMATION_TRIGGERS,
  preflightDeckDesignPlan,
  renderDeckPreflightReport,
  type ObjectAnimationSpec,
} from '@/common/presentationDesign';
import { validateOfficeApiScript } from '@/common/types/office/officeApiScript';
import { emitter } from '@/renderer/utils/emitter';

export type PremiumDeckSlideLayout =
  | 'cover'
  | 'section'
  | 'content'
  | 'split'
  | 'image'
  | 'chart'
  | 'quote'
  | 'agenda'
  | 'comparison'
  | 'timeline'
  | 'process'
  | 'metrics'
  | 'architecture'
  | 'closing';

export type PremiumDeckDesignStyle = 'modern' | 'minimal' | 'editorial' | 'technical' | 'cinematic' | 'academic';

export type PremiumDeckTransition = 'none' | 'fade' | 'push' | 'wipe' | 'split';

export type PremiumDeckItem = {
  label: string;
  value?: string;
  detail?: string;
  group?: string;
};

export type PremiumDeckColumn = {
  heading: string;
  bullets: string[];
};

export type PremiumDeckTheme = {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  fontFamily: string;
};

export type PremiumDeckSlide = {
  title: string;
  subtitle?: string;
  bullets: string[];
  layout: PremiumDeckSlideLayout;
  imageUrl?: string;
  accentColor?: string;
  chartValues?: number[][];
  chartLabels?: string[];
  items?: PremiumDeckItem[];
  columns?: PremiumDeckColumn[];
  source?: string;
  speakerNotes?: string;
  transition?: PremiumDeckTransition;
};

export type PremiumDeckPlan = {
  title: string;
  subtitle?: string;
  designStyle?: PremiumDeckDesignStyle;
  theme: PremiumDeckTheme;
  slides: PremiumDeckSlide[];
};
export type PremiumDocTable = {
  headers: string[];
  rows: string[][];
};

export type PremiumDocSection = {
  heading: string;
  body: string[];
  bullets: string[];
  callout?: string;
  table?: PremiumDocTable;
  imageUrl?: string;
};

export type PremiumDocPlan = {
  title: string;
  subtitle?: string;
  theme: PremiumDeckTheme;
  sections: PremiumDocSection[];

  includeToc?: boolean;
};

export type PremiumSlideVisualSummary = {
  slideCount: number;
  drawingCount: number;
  textBoxCount: number;
  imageLikeCount: number;
  avgDrawingsPerSlide: number;
};

/** A single action the model may request. */
export type DocAgentAction =
  | { tool: 'get_capabilities' }
  | { tool: 'read_document' }
  | { tool: 'replace_all'; text: string }
  | { tool: 'search_replace'; search: string; replace: string }
  | { tool: 'replace_passage'; find: string; replacement: string; until?: string }
  | { tool: 'insert_text'; text: string }
  | { tool: 'append_text'; text: string }
  | { tool: 'apply_headings'; headings: Array<{ text: string; level: number }> }
  | { tool: 'insert_toc'; atStart?: boolean }
  | { tool: 'format_text'; search: string; format: TextFormat }
  | { tool: 'format_passage'; find: string; format: TextFormat; until?: string }
  | { tool: 'insert_table'; rows: number; cols: number; data?: string[][] }
  | { tool: 'set_cells'; start: string; values: Array<Array<string | number>>; sheet?: string }
  | { tool: 'create_premium_doc'; plan: PremiumDocPlan }
  | { tool: 'create_premium_deck'; plan: PremiumDeckPlan }
  | { tool: 'add_premium_slide'; plan: PremiumDeckPlan }
  | { tool: 'structure_report'; headings: Array<{ text: string; level: number }>; insertToc: boolean }
  | { tool: 'add_speaker_notes'; slideIndex: number; text: string }
  | {
      tool: 'apply_slide_transitions';
      effect: Exclude<PremiumDeckTransition, 'none'>;
      speed: 'slow' | 'medium' | 'fast';
    }
  | {
      tool: 'apply_object_animations';
      animations: ObjectAnimationSpec[];
      replaceExistingMainSequence: boolean;
    }
  | { tool: 'review_object_animations'; expectedAnimations?: ObjectAnimationSpec[] }
  | { tool: 'review_premium_quality' }
  | { tool: 'open_visual_review' }
  | { tool: 'run_office_api'; code: string }
  | { tool: 'finish'; summary: string };

/** Result of executing one action. `done` ends the loop. */
export type ToolResult = { observation: string; done: boolean; capabilities?: EditorToolCapabilities };

/** Human-readable tool list embedded in the system prompt (kept in sync with the union). */
export const TOOL_GUIDE = [
  'get_capabilities — inspect live, fail-closed Office support before planning advanced edits. Distinguishes automationApi, objectAnimation, slideShowControl and recording, with concrete unsupported reasons. Args: none.',
  'read_document — read the current document text. Args: none. Returns the text.',
  'replace_all — replace the WHOLE document with new text (Word only). Args: { "text": string }.',
  'search_replace — replace every occurrence of a string. Args: { "search": string, "replace": string }.',
  'replace_passage — replace ONE specific passage (Word only), the reliable way to edit a particular paragraph. Args: { "find": string, "replacement": string, "until"?: string }. With "find" alone it replaces the FIRST occurrence. With "find"+"until" it replaces everything from the start of "find" through the end of the first following "until" — pass the first few words as "find" and the last few words as "until" to target a long paragraph without quoting it all.',
  'insert_text — paste text at the cursor (replacing any selection). Args: { "text": string }.',
  'append_text — add a paragraph at the end (Word only). Args: { "text": string }.',
  'apply_headings — apply real heading styles (Heading 1–9) to paragraphs by exact text (Word only). Args: { "headings": [{ "text": string, "level": number }] }. Use this to mark section titles so a table of contents can pick them up.',
  'insert_toc — insert a real, auto-updating Table of Contents from the heading-styled paragraphs (Word only). Args: { "atStart": boolean }. Apply headings FIRST.',
  'format_text — apply character formatting to EVERY occurrence of a string (Word only). Args: { "search": string, "format": { "bold"?: boolean, "italic"?: boolean, "underline"?: boolean, "strikeout"?: boolean, "color"?: "#RRGGBB", "highlight"?: "#RRGGBB", "fontSize"?: number, "fontFamily"?: string } }.',
  'format_passage — format ONE specific passage (Word only) — like selecting the whole paragraph then applying bold/italic/etc. Args: { "find": string, "format": {…same as format_text…}, "until"?: string }. "find" alone targets the first occurrence; "find"+"until" covers everything from the start of "find" through the end of the first following "until" (pass first words as "find", last words as "until" for a long paragraph).',
  'insert_table — insert a table at the end (Word only). Args: { "rows": number, "cols": number, "data"?: string[][] }. When "data" is given it fills the cells and sets the size.',
  'set_cells — write a block of spreadsheet cells (Excel only). Args: { "start": "A1", "values": (string|number)[][], "sheet"?: string }. Values are written row-by-row from "start".',
  'create_premium_doc - build a polished DOCX from a structured plan. Args: { plan: { title: string, subtitle?: string, includeToc?: boolean, theme?: { primary?: #RRGGBB, secondary?: #RRGGBB, background?: #RRGGBB, text?: #RRGGBB, fontFamily?: string }, sections: [{ heading: string, body?: string[], bullets?: string[], callout?: string, imageUrl?: string, table?: { headers: string[], rows: string[][] } }] } }. Use for reports, proposals, briefs, SOPs and executive docs that need hierarchy, an optional automatic TOC, callouts, tables and image blocks rather than plain text.',

  'create_premium_deck - build a polished PPTX deck from a structured plan. Args: { plan: { title: string, subtitle?: string, designStyle?: modern|minimal|editorial|technical|cinematic|academic, theme?: { primary?: #RRGGBB, secondary?: #RRGGBB, background?: #RRGGBB, text?: #RRGGBB, fontFamily?: string }, slides: [{ title: string, subtitle?: string, bullets?: string[], layout?: cover|section|content|split|image|chart|quote|agenda|comparison|timeline|process|metrics|architecture|closing, imageUrl?: string, items?: object[], columns?: object[], source?: string, speakerNotes?: string, transition?: string, chartValues?: number[][] }] } }. Use after planning the story, evidence and visual system; generate or attach image assets first when the deck needs hero visuals.',

  'add_premium_slide - append one polished slide without rebuilding the deck. Supports agenda, comparison, timeline, process, metrics, architecture and closing layouts plus items, columns, source, notes and transitions.',
  'structure_report - apply heading levels to report sections and optionally insert an automatic TOC in one operation. Args: { headings: [{ text: string, level: number }], insertToc?: boolean }.',
  'add_speaker_notes - add presenter notes to a 1-based slide index. Args: { slideIndex: number, text: string }.',
  'apply_slide_transitions - apply one restrained transition to every slide. Args: { effect: fade|push|wipe|split, speed?: slow|medium|fast }.',
  'review_object_animations - inspect live object inventory and timeline effects before/after animation work. Returns stable drawing names, ephemeral indices, effect timing and purpose-aware QA. Args: { "expectedAnimations"?: [...] }. Call this first to target drawings safely.',
  'apply_object_animations - add restrained, purpose-led animation to named/inspected objects in a PPTX. Every item requires slideIndex (1-based), drawingName (preferred) or drawingIndex (0-based fallback), effect, trigger, durationMs, delayMs, repeatCount, purpose and rationale. Args: { "animations": [{ "slideIndex": 1, "drawingName": "Title", "effect": "entranceFade", "trigger": "onclick", "durationMs": 450, "delayMs": 0, "repeatCount": 1, "purpose": "progressive-disclosure", "rationale": "Reveal the conclusion only after its evidence." }], "replaceExistingMainSequence"?: false }. This never claims playback or recording support; it first checks live Office capability and preserves interactive sequences.',

  'review_premium_quality - audit the live DOCX/PPTX after creation or edits. Args: none. Returns score, strengths and required improvements; call before final response for premium deliverables.',
  'open_visual_review - open the current DOCX/PPTX/XLSX in the preview panel for visual QA. Args: none. Use after premium creation plus audit so the rendered Office preview is visible before final delivery.',
  'run_office_api - run ANY ONLYOFFICE Document Builder API script in the live editor. Args: { "code": string } where code is a JS body that uses the global `Api` and may `return` a JSON-serializable value. Word: `Api.GetDocument()`; Spreadsheet: `Api.GetActiveSheet()` / `Api.GetSheet(i)`; Presentation: `Api.GetPresentation()`. For premium PPTX work, use this for real slide structures: add slides, place shapes/images, build visual hierarchy, apply brand colors, create charts/diagrams, tune typography, and add transitions/effects when supported by ONLYOFFICE. Example (Word, insert a 2x2 table): "const d=Api.GetDocument(); const t=Api.CreateTable(2,2); d.Push(t); return \'ok\';". Scripts are capped and must stay within ONLYOFFICE Document Builder APIs: no network, browser globals, Node.js APIs, imports, eval, or Function. Prefer the specific tools above for common edits; use this for everything else (images, charts, page setup, find by style, etc.).',
  'finish — stop and report what you did. Args: { "summary": string }.',
].join('\n');

/** Tools available per document kind (others are rejected with guidance). */
const ALLOWED: Record<OfficeDocKind, ReadonlySet<string>> = {
  word: new Set([
    'get_capabilities',
    'read_document',
    'replace_all',
    'search_replace',
    'replace_passage',
    'insert_text',
    'append_text',
    'apply_headings',
    'insert_toc',
    'format_text',
    'format_passage',
    'insert_table',
    'create_premium_doc',
    'structure_report',
    'review_premium_quality',
    'open_visual_review',
    'run_office_api',
    'finish',
  ]),
  cell: new Set([
    'get_capabilities',
    'read_document',
    'search_replace',
    'insert_text',
    'set_cells',
    'open_visual_review',
    'run_office_api',
    'finish',
  ]),
  slide: new Set([
    'get_capabilities',
    'read_document',
    'search_replace',
    'insert_text',
    'create_premium_deck',
    'add_premium_slide',
    'add_speaker_notes',
    'apply_slide_transitions',
    'apply_object_animations',
    'review_object_animations',
    'review_premium_quality',
    'open_visual_review',
    'run_office_api',
    'finish',
  ]),
};

const OFFICE_API_SCRIPT_TIMEOUT_MS = 12000;

const PREMIUM_DECK_TIMEOUT_MS = 30_000;

const withTimeout = <T>(label: string, promise: Promise<T>, timeoutMs = OFFICE_API_SCRIPT_TIMEOUT_MS): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const MAX_PREMIUM_DECK_SLIDES = 20;
const MAX_PREMIUM_DECK_BULLETS = 6;
const MAX_PREMIUM_DECK_JSON_CHARS = 16_000;
const PREMIUM_DECK_LAYOUTS = new Set<PremiumDeckSlideLayout>([
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
]);
const PREMIUM_DECK_STYLES = new Set<PremiumDeckDesignStyle>([
  'modern',
  'minimal',
  'editorial',
  'technical',
  'cinematic',
  'academic',
]);
const PREMIUM_DECK_TRANSITIONS = new Set<PremiumDeckTransition>(['none', 'fade', 'push', 'wipe', 'split']);

const DEFAULT_PREMIUM_DECK_THEME: PremiumDeckTheme = {
  primary: '#246BFD',
  secondary: '#10A37F',
  background: '#F7F8FA',
  text: '#121826',
  fontFamily: 'Aptos',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const cleanText = (value: unknown, maxChars: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxChars) : undefined;
};

const cleanHex = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? '#' + match[1].toUpperCase() : fallback;
};

const cleanImageUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed) === false) return undefined;
  return trimmed.slice(0, 1200);
};

const cleanChartValues = (value: unknown): number[][] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .slice(0, 4)
    .map((row) =>
      Array.isArray(row)
        ? row
            .slice(0, 8)
            .map((n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null))
            .filter((n): n is number => n !== null)
        : []
    )
    .filter((row) => row.length > 0);
  return rows.length > 0 ? rows : undefined;
};

const cleanDeckItems = (value: unknown): PremiumDeckItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.slice(0, 8).flatMap((raw): PremiumDeckItem[] => {
    if (!isRecord(raw)) return [];
    const label = cleanText(raw.label, 90);
    if (!label) return [];
    return [
      {
        label,
        value: cleanText(raw.value, 32),
        detail: cleanText(raw.detail, 140),
        group: cleanText(raw.group, 40),
      },
    ];
  });
  return items.length > 0 ? items : undefined;
};

const cleanDeckColumns = (value: unknown): PremiumDeckColumn[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const columns = value.slice(0, 3).flatMap((raw): PremiumDeckColumn[] => {
    if (!isRecord(raw)) return [];
    const heading = cleanText(raw.heading, 60);
    if (!heading || !Array.isArray(raw.bullets)) return [];
    const bullets = raw.bullets.flatMap((item) => {
      const text = cleanText(item, 120);
      return text ? [text] : [];
    });
    return bullets.length > 0 ? [{ heading, bullets: bullets.slice(0, 5) }] : [];
  });
  return columns.length > 0 ? columns : undefined;
};

export const normalizePremiumDeckPlan = (value: unknown): PremiumDeckPlan | null => {
  if (!isRecord(value)) return null;
  const title = cleanText(value.title, 120);
  if (!title) return null;
  if (!Array.isArray(value.slides) || value.slides.length === 0) return null;

  const themeSource = isRecord(value.theme) ? value.theme : {};
  const theme: PremiumDeckTheme = {
    primary: cleanHex(themeSource.primary, DEFAULT_PREMIUM_DECK_THEME.primary),
    secondary: cleanHex(themeSource.secondary, DEFAULT_PREMIUM_DECK_THEME.secondary),
    background: cleanHex(themeSource.background, DEFAULT_PREMIUM_DECK_THEME.background),
    text: cleanHex(themeSource.text, DEFAULT_PREMIUM_DECK_THEME.text),
    fontFamily: cleanText(themeSource.fontFamily, 48) ?? DEFAULT_PREMIUM_DECK_THEME.fontFamily,
  };

  const rawDesignStyle = typeof value.designStyle === 'string' ? value.designStyle : 'modern';
  const designStyle = PREMIUM_DECK_STYLES.has(rawDesignStyle as PremiumDeckDesignStyle)
    ? (rawDesignStyle as PremiumDeckDesignStyle)
    : 'modern';

  const slides = value.slides.slice(0, MAX_PREMIUM_DECK_SLIDES).flatMap((raw): PremiumDeckSlide[] => {
    if (!isRecord(raw)) return [];
    const slideTitle = cleanText(raw.title, 120);
    if (!slideTitle) return [];
    const rawLayout = typeof raw.layout === 'string' ? raw.layout : 'content';
    const layout = PREMIUM_DECK_LAYOUTS.has(rawLayout as PremiumDeckSlideLayout)
      ? (rawLayout as PremiumDeckSlideLayout)
      : 'content';
    const bullets = Array.isArray(raw.bullets)
      ? raw.bullets.flatMap((item) => {
          const bullet = cleanText(item, 150);
          return bullet ? [bullet] : [];
        })
      : [];
    return [
      {
        title: slideTitle,
        subtitle: cleanText(raw.subtitle, 180),
        bullets: bullets.slice(0, MAX_PREMIUM_DECK_BULLETS),
        layout,
        imageUrl: cleanImageUrl(raw.imageUrl),
        accentColor: cleanHex(raw.accentColor, theme.primary),
        chartValues: cleanChartValues(raw.chartValues),
        chartLabels: cleanStringArray(raw.chartLabels, 8, 40),
        items: cleanDeckItems(raw.items),
        columns: cleanDeckColumns(raw.columns),
        source: cleanText(raw.source, 180),
        speakerNotes: cleanText(raw.speakerNotes, 1_200),
        transition:
          typeof raw.transition === 'string' && PREMIUM_DECK_TRANSITIONS.has(raw.transition as PremiumDeckTransition)
            ? (raw.transition as PremiumDeckTransition)
            : undefined,
      },
    ];
  });

  if (slides.length === 0) return null;
  const normalized: PremiumDeckPlan = {
    title,
    subtitle: cleanText(value.subtitle, 180),
    designStyle,
    theme,
    slides,
  };
  return JSON.stringify(normalized).length <= MAX_PREMIUM_DECK_JSON_CHARS ? normalized : null;
};

export const buildPremiumDeckScript = (plan: PremiumDeckPlan): string => buildPremiumDeckDesignScript(plan);

export const buildPremiumDeckAppendScript = (plan: PremiumDeckPlan): string =>
  buildPremiumDeckDesignScript(plan, { mode: 'append' });

const MAX_PREMIUM_DOC_SECTIONS = 12;
const MAX_PREMIUM_DOC_PARAGRAPHS = 5;
const MAX_PREMIUM_DOC_BULLETS = 8;
const MAX_PREMIUM_DOC_TABLE_ROWS = 8;
const MAX_PREMIUM_DOC_JSON_CHARS = 7000;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const cleanStringArray = (value: unknown, maxItems: number, maxChars: number): string[] =>
  Array.isArray(value)
    ? value
        .flatMap((item) => {
          const text = cleanText(item, maxChars);
          return text ? [text] : [];
        })
        .slice(0, maxItems)
    : [];

const cleanDocTable = (value: unknown): PremiumDocTable | undefined => {
  if (!isRecord(value)) return undefined;
  const headers = cleanStringArray(value.headers, 6, 60);
  if (headers.length === 0 || !Array.isArray(value.rows)) return undefined;
  const rows = value.rows.slice(0, MAX_PREMIUM_DOC_TABLE_ROWS).flatMap((row): string[][] => {
    if (!Array.isArray(row)) return [];
    const cells = row.slice(0, headers.length).map((cell) => cleanText(cell, 100) ?? '');
    return [cells];
  });
  return rows.length > 0 ? { headers, rows } : undefined;
};

export const normalizePremiumDocPlan = (value: unknown): PremiumDocPlan | null => {
  if (!isRecord(value)) return null;
  const title = cleanText(value.title, 140);
  if (!title) return null;
  if (!Array.isArray(value.sections) || value.sections.length === 0) return null;

  const themeSource = isRecord(value.theme) ? value.theme : {};
  const theme: PremiumDeckTheme = {
    primary: cleanHex(themeSource.primary, DEFAULT_PREMIUM_DECK_THEME.primary),
    secondary: cleanHex(themeSource.secondary, DEFAULT_PREMIUM_DECK_THEME.secondary),
    background: cleanHex(themeSource.background, DEFAULT_PREMIUM_DECK_THEME.background),
    text: cleanHex(themeSource.text, DEFAULT_PREMIUM_DECK_THEME.text),
    fontFamily: cleanText(themeSource.fontFamily, 48) ?? DEFAULT_PREMIUM_DECK_THEME.fontFamily,
  };

  const sections = value.sections.slice(0, MAX_PREMIUM_DOC_SECTIONS).flatMap((raw): PremiumDocSection[] => {
    if (!isRecord(raw)) return [];
    const heading = cleanText(raw.heading, 120);
    if (!heading) return [];
    return [
      {
        heading,
        body: cleanStringArray(raw.body, MAX_PREMIUM_DOC_PARAGRAPHS, 500),
        bullets: cleanStringArray(raw.bullets, MAX_PREMIUM_DOC_BULLETS, 160),
        callout: cleanText(raw.callout, 260),
        table: cleanDocTable(raw.table),
        imageUrl: cleanImageUrl(raw.imageUrl),
      },
    ];
  });

  if (sections.length === 0) return null;
  const normalized: PremiumDocPlan = {
    title,
    subtitle: cleanText(value.subtitle, 180),
    theme,
    sections,
    includeToc: value.includeToc === true,
  };
  return JSON.stringify(normalized).length <= MAX_PREMIUM_DOC_JSON_CHARS ? normalized : null;
};

export const buildPremiumDocHtml = (plan: PremiumDocPlan): string => {
  const theme = plan.theme;
  const styles = [
    'font-family:' + escapeHtml(theme.fontFamily) + ';color:' + theme.text + ';line-height:1.45;',
    'font-size:11.5pt;',
  ].join('');
  const html = [
    `<div style="${styles}">`,
    `<h1 style="font-size:30pt;line-height:1.08;margin:0 0 10px;color:${theme.primary};">${escapeHtml(plan.title)}</h1>`,
    plan.subtitle
      ? `<p style="font-size:15pt;margin:0 0 22px;color:${theme.text};">${escapeHtml(plan.subtitle)}</p>`
      : '',
    `<div style="height:4px;background:${theme.secondary};width:160px;margin:0 0 26px;"></div>`,
  ];
  for (const section of plan.sections) {
    html.push(
      `<h2 style="font-size:18pt;margin:24px 0 8px;color:${theme.primary};">${escapeHtml(section.heading)}</h2>`
    );
    for (const paragraph of section.body) html.push(`<p style="margin:8px 0;">${escapeHtml(paragraph)}</p>`);
    if (section.callout) {
      html.push(
        `<div style="border-left:4px solid ${theme.secondary};background:${theme.background};padding:10px 14px;margin:14px 0;font-weight:600;">${escapeHtml(section.callout)}</div>`
      );
    }
    if (section.imageUrl) {
      html.push(
        `<p><img src="${escapeHtml(section.imageUrl)}" style="max-width:100%;height:auto;border-radius:6px;" /></p>`
      );
    }
    if (section.bullets.length > 0) {
      html.push('<ul style="margin:8px 0 12px 22px;">');
      for (const bullet of section.bullets) html.push(`<li>${escapeHtml(bullet)}</li>`);
      html.push('</ul>');
    }
    if (section.table) {
      html.push('<table style="border-collapse:collapse;width:100%;margin:12px 0;">');
      html.push('<thead><tr>');
      for (const header of section.table.headers)
        html.push(
          `<th style="border:1px solid #D7DEE8;background:${theme.primary};color:#FFFFFF;padding:7px;text-align:left;">${escapeHtml(header)}</th>`
        );
      html.push('</tr></thead><tbody>');
      for (const row of section.table.rows) {
        html.push('<tr>');
        for (const cell of row) html.push(`<td style="border:1px solid #D7DEE8;padding:7px;">${escapeHtml(cell)}</td>`);
        html.push('</tr>');
      }
      html.push('</tbody></table>');
    }
  }
  html.push('</div>');
  return html.join('');
};

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const parseSlideVisualSummary = (value: string): PremiumSlideVisualSummary | null => {
  try {
    const parsed = JSON.parse(value) as Partial<PremiumSlideVisualSummary>;
    const slideCount = typeof parsed.slideCount === 'number' ? parsed.slideCount : 0;
    const drawingCount = typeof parsed.drawingCount === 'number' ? parsed.drawingCount : 0;
    const textBoxCount = typeof parsed.textBoxCount === 'number' ? parsed.textBoxCount : 0;
    const imageLikeCount = typeof parsed.imageLikeCount === 'number' ? parsed.imageLikeCount : 0;
    const avgDrawingsPerSlide = typeof parsed.avgDrawingsPerSlide === 'number' ? parsed.avgDrawingsPerSlide : 0;
    return { slideCount, drawingCount, textBoxCount, imageLikeCount, avgDrawingsPerSlide };
  } catch {
    return null;
  }
};

const buildSlideVisualSummaryScript = (): string =>
  [
    'const pres = Api.GetPresentation();',
    'const slideCount = pres.GetSlidesCount();',
    'let drawingCount = 0;',
    'let textBoxCount = 0;',
    'let imageLikeCount = 0;',
    'for (let i = 0; i < slideCount; i++) {',
    '  const slide = pres.GetSlideByIndex(i);',
    '  const drawings = slide && slide.GetAllDrawings ? slide.GetAllDrawings() : [];',
    '  drawingCount += drawings.length;',
    '  for (let j = 0; j < drawings.length; j++) {',
    '    const drawing = drawings[j];',
    '    const content = drawing && drawing.GetContent ? drawing.GetContent() : null;',
    '    if (content) textBoxCount++;',
    '    const classType = drawing && drawing.GetClassType ? String(drawing.GetClassType()) : String();',
    '    if (/image|picture|graphic|chart|shape/i.test(classType) && !content) imageLikeCount++;',
    '  }',
    '}',
    'return JSON.stringify({ slideCount, drawingCount, textBoxCount, imageLikeCount, avgDrawingsPerSlide: slideCount ? drawingCount / slideCount : 0 });',
  ].join('\n');

const buildSpeakerNotesScript = (slideIndex: number, text: string): string =>
  [
    'const pres = Api.GetPresentation();',
    `const index = ${slideIndex - 1};`,
    `const note = ${JSON.stringify(text)};`,
    'if (index < 0 || index >= pres.GetSlidesCount()) return "Slide index is out of range.";',
    'const slide = pres.GetSlideByIndex(index);',
    'if (!slide || !slide.AddNotesText) return "Speaker notes are not supported by this editor.";',
    'return slide.AddNotesText(note) ? "Speaker notes added." : "Could not add speaker notes.";',
  ].join('\n');

const buildSlideTransitionsScript = (
  effect: Exclude<PremiumDeckTransition, 'none'>,
  speed: 'slow' | 'medium' | 'fast'
): string => {
  const effectMap: Record<Exclude<PremiumDeckTransition, 'none'>, string> = {
    fade: 'effectFade',
    push: 'effectPushLeft',
    wipe: 'effectWipeRight',
    split: 'effectSplitVerticalIn',
  };
  return [
    'const pres = Api.GetPresentation();',
    `const effect = ${JSON.stringify(effectMap[effect])};`,
    `const speed = ${JSON.stringify(speed)};`,
    'let applied = 0;',
    'for (let i = 0; i < pres.GetSlidesCount(); i++) {',
    '  const slide = pres.GetSlideByIndex(i);',
    '  if (!slide || !slide.SetSlideShowTransition || !Api.CreateSlideShowTransition) continue;',
    '  const transition = Api.CreateSlideShowTransition();',
    '  transition.SetEntryEffect(effect);',
    '  transition.SetSpeed(speed);',
    '  transition.SetAdvanceOnClick(true);',
    '  slide.SetSlideShowTransition(transition);',
    '  applied++;',
    '}',
    'return "Applied transitions to " + applied + " slide(s).";',
  ].join('\n');
};

/** Build an isolated-realm script that adds only verified, purpose-led main-sequence effects. */
export const buildObjectAnimationsScript = (
  animations: ObjectAnimationSpec[],
  replaceExistingMainSequence: boolean
): string =>
  [
    `const animationPlan = ${JSON.stringify({ animations, replaceExistingMainSequence })};`,
    'const fail = (message, applied = 0) => JSON.stringify({ ok: false, error: message, applied });',
    'try {',
    '  const pres = Api.GetPresentation();',
    '  if (!pres || typeof pres.GetSlidesCount !== "function") return fail("The presentation API is unavailable.");',
    '  const slideCount = pres.GetSlidesCount();',
    '  const resolved = [];',
    '  for (let inputIndex = 0; inputIndex < animationPlan.animations.length; inputIndex++) {',
    '    const spec = animationPlan.animations[inputIndex];',
    '    const slideIndex = spec.slideIndex - 1;',
    '    if (slideIndex < 0 || slideIndex >= slideCount) return fail("Animation " + inputIndex + " targets an out-of-range slide.");',
    '    const slide = pres.GetSlideByIndex(slideIndex);',
    '    if (!slide || typeof slide.GetAllDrawings !== "function" || typeof slide.GetTimeLine !== "function") return fail("Slide " + spec.slideIndex + " lacks drawing or timeline APIs.");',
    '    const drawings = slide.GetAllDrawings() || [];',
    '    let drawing = null;',
    '    let drawingIndex = -1;',
    '    if (spec.drawingName) {',
    '      for (let i = 0; i < drawings.length; i++) {',
    '        if (typeof drawings[i].GetName === "function" && drawings[i].GetName() === spec.drawingName) { drawing = drawings[i]; drawingIndex = i; break; }',
    '      }',
    '      if (!drawing) return fail("Slide " + spec.slideIndex + " has no drawing named " + spec.drawingName + ".");',
    '    }',
    '    if (typeof spec.drawingIndex === "number") {',
    '      if (spec.drawingIndex < 0 || spec.drawingIndex >= drawings.length) return fail("Animation " + inputIndex + " targets an out-of-range drawing index.");',
    '      if (drawing && drawing !== drawings[spec.drawingIndex]) return fail("Drawing name/index mismatch on slide " + spec.slideIndex + ". Re-run animation review.");',
    '      drawing = drawings[spec.drawingIndex]; drawingIndex = spec.drawingIndex;',
    '    }',
    '    if (!drawing) return fail("Animation " + inputIndex + " has no resolvable drawing target.");',
    '    const timeline = slide.GetTimeLine();',
    '    const sequence = timeline && typeof timeline.GetMainSequence === "function" ? timeline.GetMainSequence() : null;',
    '    if (!timeline || !sequence || typeof sequence.AddEffect !== "function" || typeof sequence.RemoveAllEffects !== "function" || typeof sequence.GetCount !== "function") return fail("Slide " + spec.slideIndex + " lacks ONLYOFFICE animation APIs (requires a current Document Server). ");',
    '    resolved.push({ spec, slide, sequence, drawing, drawingIndex, inputIndex });',
    '  }',
    '  resolved.sort((a, b) => a.spec.slideIndex - b.spec.slideIndex || a.spec.order - b.spec.order || a.inputIndex - b.inputIndex);',
    '  if (typeof pres.CreateNewHistoryPoint === "function") pres.CreateNewHistoryPoint();',
    '  if (animationPlan.replaceExistingMainSequence) {',
    '    const cleared = {};',
    '    for (let i = 0; i < resolved.length; i++) {',
    '      const slideIndex = resolved[i].spec.slideIndex;',
    '      if (!cleared[slideIndex]) {',
    '        if (resolved[i].sequence.RemoveAllEffects() === false) return fail("Could not clear the main animation sequence on slide " + slideIndex + ".");',
    '        cleared[slideIndex] = true;',
    '      }',
    '    }',
    '  }',
    '  const applied = [];',
    '  for (let i = 0; i < resolved.length; i++) {',
    '    const item = resolved[i];',
    '    const effect = item.sequence.AddEffect(item.drawing, item.spec.effect, item.spec.trigger);',
    '    if (!effect) return fail("ONLYOFFICE rejected effect " + item.spec.effect + " on slide " + item.spec.slideIndex + ".", applied.length);',
    '    if (typeof effect.SetDuration !== "function" || typeof effect.SetDelay !== "function" || typeof effect.SetRepeatCount !== "function") return fail("The animation timing API is unavailable.", applied.length);',
    '    if (effect.SetDuration(item.spec.durationMs) === false || effect.SetDelay(item.spec.delayMs) === false || effect.SetRepeatCount(item.spec.repeatCount) === false) return fail("Could not apply animation timing on slide " + item.spec.slideIndex + ".", applied.length);',
    '    applied.push({',
    '      ...item.spec,',
    '      drawingIndex: item.drawingIndex,',
    '      drawingName: typeof item.drawing.GetName === "function" ? String(item.drawing.GetName() || "") : "",',
    '      drawingId: typeof item.drawing.GetInternalId === "function" ? String(item.drawing.GetInternalId() || "") : "",',
    '      sequenceIndex: item.sequence.GetCount() - 1,',
    '    });',
    '  }',
    '  return JSON.stringify({ ok: true, applied, replaceExistingMainSequence: animationPlan.replaceExistingMainSequence });',
    '} catch (cause) {',
    '  return fail(cause && cause.message ? String(cause.message) : String(cause));',
    '}',
  ].join('\n');

/** Build a timeline/object inventory script. It reads both main and interactive sequences without mutating. */
export const buildObjectAnimationReviewScript = (): string =>
  [
    'const fail = (message) => JSON.stringify({ ok: false, error: message, drawings: [], effects: [] });',
    'try {',
    '  const pres = Api.GetPresentation();',
    '  if (!pres || typeof pres.GetSlidesCount !== "function") return fail("The presentation API is unavailable.");',
    '  const drawingsOut = []; const effects = []; const slideCount = pres.GetSlidesCount();',
    '  const collect = (sequence, slideIndex, sequenceType, interactiveSequenceIndex, drawings) => {',
    '    if (!sequence || typeof sequence.GetCount !== "function" || typeof sequence.GetEffect !== "function") return;',
    '    for (let effectIndex = 0; effectIndex < sequence.GetCount(); effectIndex++) {',
    '      const effect = sequence.GetEffect(effectIndex); if (!effect) continue;',
    '      const shape = typeof effect.GetShape === "function" ? effect.GetShape() : null;',
    '      const drawingId = shape && typeof shape.GetInternalId === "function" ? String(shape.GetInternalId() || "") : "";',
    '      let drawingIndex = -1;',
    '      for (let j = 0; j < drawings.length; j++) {',
    '        const candidateId = typeof drawings[j].GetInternalId === "function" ? String(drawings[j].GetInternalId() || "") : "";',
    '        if ((drawingId && candidateId === drawingId) || (!drawingId && drawings[j] === shape)) { drawingIndex = j; break; }',
    '      }',
    '      effects.push({ slideIndex, sequenceType, interactiveSequenceIndex, sequenceIndex: effectIndex, drawingIndex, drawingName: shape && typeof shape.GetName === "function" ? String(shape.GetName() || "") : "", drawingId, effect: typeof effect.GetEffectType === "function" ? effect.GetEffectType() : null, trigger: typeof effect.GetTriggerType === "function" ? String(effect.GetTriggerType() || "") : "", durationMs: typeof effect.GetDuration === "function" ? Number(effect.GetDuration() || 0) : 0, delayMs: typeof effect.GetDelay === "function" ? Number(effect.GetDelay() || 0) : 0, repeatCount: typeof effect.GetRepeatCount === "function" ? Number(effect.GetRepeatCount() || 0) : 0 });',
    '    }',
    '  };',
    '  for (let slideZeroIndex = 0; slideZeroIndex < slideCount; slideZeroIndex++) {',
    '    const slide = pres.GetSlideByIndex(slideZeroIndex);',
    '    const drawings = slide && typeof slide.GetAllDrawings === "function" ? slide.GetAllDrawings() || [] : [];',
    '    for (let drawingIndex = 0; drawingIndex < drawings.length; drawingIndex++) {',
    '      const drawing = drawings[drawingIndex]; drawingsOut.push({ slideIndex: slideZeroIndex + 1, drawingIndex, drawingName: typeof drawing.GetName === "function" ? String(drawing.GetName() || "") : "", drawingId: typeof drawing.GetInternalId === "function" ? String(drawing.GetInternalId() || "") : "", classType: typeof drawing.GetClassType === "function" ? String(drawing.GetClassType() || "") : "" });',
    '    }',
    '    if (!slide || typeof slide.GetTimeLine !== "function") continue;',
    '    const timeline = slide.GetTimeLine(); if (!timeline || typeof timeline.GetMainSequence !== "function") continue;',
    '    collect(timeline.GetMainSequence(), slideZeroIndex + 1, "main", null, drawings);',
    '    const interactive = typeof timeline.GetInteractiveSequences === "function" ? timeline.GetInteractiveSequences() || [] : [];',
    '    for (let i = 0; i < interactive.length; i++) collect(interactive[i], slideZeroIndex + 1, "interactive", i, drawings);',
    '  }',
    '  return JSON.stringify({ ok: true, slideCount, drawings: drawingsOut, effects });',
    '} catch (cause) {',
    '  return fail(cause && cause.message ? String(cause.message) : String(cause));',
    '}',
  ].join('\n');

type ObjectAnimationReviewEffect = {
  slideIndex: number;
  sequenceType: 'main' | 'interactive';
  drawingName: string;
  drawingId: string;
  effect: string | null;
  trigger: string;
  durationMs: number;
  delayMs: number;
  repeatCount: number;
};

const reviewObjectAnimations = (value: string, expected: ObjectAnimationSpec[] | undefined): string => {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return 'Purposeful animation QA could not parse the Office timeline response.';
  }
  if (!isRecord(raw) || raw.ok !== true || !Array.isArray(raw.effects) || !Array.isArray(raw.drawings)) {
    return `Purposeful animation QA failed: ${isRecord(raw) && typeof raw.error === 'string' ? raw.error : 'Office animation APIs are unavailable.'}`;
  }
  const effects = raw.effects.filter((effect): effect is ObjectAnimationReviewEffect => {
    if (!isRecord(effect)) return false;
    return (
      typeof effect.slideIndex === 'number' &&
      (effect.sequenceType === 'main' || effect.sequenceType === 'interactive') &&
      typeof effect.drawingName === 'string' &&
      typeof effect.drawingId === 'string' &&
      (typeof effect.effect === 'string' || effect.effect === null) &&
      typeof effect.trigger === 'string' &&
      typeof effect.durationMs === 'number' &&
      typeof effect.delayMs === 'number' &&
      typeof effect.repeatCount === 'number'
    );
  });
  const issues: string[] = [];
  if (effects.length === 0) issues.push('[required] no object animation effects were found.');
  const bySlide = new Map<number, ObjectAnimationReviewEffect[]>();
  for (const effect of effects) {
    const slideEffects = bySlide.get(effect.slideIndex) ?? [];
    slideEffects.push(effect);
    bySlide.set(effect.slideIndex, slideEffects);
    if (effect.durationMs < 150 || effect.durationMs > 2500)
      issues.push(`[recommended] slide ${effect.slideIndex}: duration should usually be 150–2500 ms.`);
    if (effect.delayMs > 2000)
      issues.push(`[recommended] slide ${effect.slideIndex}: delay above 2000 ms disrupts pacing.`);
    if (effect.repeatCount > 2)
      issues.push(`[recommended] slide ${effect.slideIndex}: repeat count above 2 is rarely purposeful.`);
  }
  for (const [slideIndex, slideEffects] of bySlide) {
    if (slideEffects.length > 6)
      issues.push(`[recommended] slide ${slideIndex}: more than six effects risks visual noise.`);
    if (slideEffects.filter((effect) => effect.trigger === 'onclick').length > 4)
      issues.push(`[recommended] slide ${slideIndex}: more than four click stops fragments delivery.`);
  }
  if (expected) {
    const missing = expected.filter(
      (target) =>
        !effects.some(
          (effect) =>
            effect.sequenceType === 'main' &&
            effect.slideIndex === target.slideIndex &&
            effect.effect === target.effect &&
            effect.trigger === target.trigger &&
            (!target.drawingName || effect.drawingName === target.drawingName)
        )
    );
    if (missing.length > 0)
      issues.push(`[required] ${missing.length} expected purpose-led animation(s) do not match the live timeline.`);
  }
  const drawings = raw.drawings
    .filter(isRecord)
    .slice(0, 200)
    .map(
      (drawing) =>
        `- slide ${drawing.slideIndex} [${drawing.drawingIndex}] "${drawing.drawingName || '(unnamed)'}" (${drawing.classType || 'drawing'})`
    );
  const required = issues.filter((issue) => issue.startsWith('[required]')).length;
  const score = Math.max(0, 100 - required * 20 - (issues.length - required) * 5);
  return [
    `Purposeful animation QA: ${score}/100 (${required === 0 ? 'passed' : 'revision required'}).`,
    `Effects: ${effects.length}; drawings inspected: ${raw.drawings.length}.`,
    ...(issues.length > 0
      ? ['Issues:', ...issues.map((issue) => `- ${issue}`)]
      : ['No timing, density, or expected-timeline issues detected.']),
    'Drawing inventory (prefer drawingName; index is only a same-session fallback):',
    ...drawings,
  ].join('\n');
};

export const reviewPremiumQuality = (
  kind: OfficeDocKind,
  text: string,
  visualSummary?: PremiumSlideVisualSummary | null
): string => {
  const issues: string[] = [];
  const strengths: string[] = [];
  let score = 100;
  const words = wordCount(text);

  if (kind === 'slide') {
    const slideCount = Math.max(1, visualSummary?.slideCount ?? (text.match(/--- Slide \d+ ---/g) ?? []).length);
    const wordsPerSlide = Math.round(words / slideCount);
    if (slideCount < 3) {
      issues.push('Deck is too short for a premium narrative; add cover, proof, and closing/CTA slides.');
      score -= 20;
    } else {
      strengths.push('Deck has a multi-slide narrative structure.');
    }
    if (wordsPerSlide > 70) {
      issues.push('Slides are text-heavy; reduce copy and move detail into speaker notes or visuals.');
      score -= 20;
    } else {
      strengths.push('Slide text density is presentation-friendly.');
    }
    if (visualSummary) {
      if (visualSummary.slideCount >= 3 && visualSummary.avgDrawingsPerSlide >= 3) {
        strengths.push('Deck has visible slide objects beyond plain text.');
      } else {
        issues.push('Slide canvas looks under-designed; add shapes, image blocks, charts, or diagram objects.');
        score -= 20;
      }
      if (visualSummary.imageLikeCount === 0) {
        issues.push('No image/chart-like visual objects detected; add at least one strong image, chart, or diagram.');
        score -= 15;
      }
    } else {
      issues.push('Could not inspect slide visual objects; run a visual/preview check before final delivery.');
      score -= 10;
    }
    if (
      /chart|metric|growth|revenue|pipeline|trend|score|%|biểu đồ|chỉ số|tăng trưởng|độ chính xác|tỷ lệ|điểm số/i.test(
        text
      ) === false
    ) {
      issues.push('No clear quantitative proof or chart cue detected; add a metric/chart slide.');
      score -= 15;
    }
    if (
      /image|visual|diagram|map|workflow|architecture|hình ảnh|sơ đồ|bản đồ|quy trình|luồng|kiến trúc/i.test(text) ===
      false
    ) {
      issues.push(
        'No visual/diagram cue detected in text; add at least one strong visual slide or image-backed section.'
      );
      score -= 15;
    }
  } else if (kind === 'word') {
    const sectionLike = text.split(/\n+/).filter((line) => line.trim().length > 0 && line.trim().length < 90).length;
    if (words < 300) {
      issues.push('Document is too thin for a premium deliverable; add analysis, rationale, and next steps.');
      score -= 20;
    }
    if (sectionLike < 4) {
      issues.push('Not enough apparent structure; add executive summary, sections, callouts, and conclusion.');
      score -= 20;
    } else {
      strengths.push('Document appears to have multiple scannable sections.');
    }
    if (
      /table|metric|comparison|option|risk|impact|timeline|bảng|chỉ số|so sánh|phương án|rủi ro|tác động|lộ trình/i.test(
        text
      ) === false
    ) {
      issues.push('No table/comparison/metric cue detected; add a decision table or quantified proof block.');
      score -= 15;
    }
    if (
      /recommend|next step|action|decision|priority|khuyến nghị|bước tiếp theo|hành động|quyết định|ưu tiên/i.test(
        text
      ) === false
    ) {
      issues.push('No clear recommendation or next action detected; add an executive decision section.');
      score -= 15;
    }
  } else {
    issues.push('Premium audit currently covers DOCX and PPTX only.');
    score -= 30;
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const next =
    issues.length > 0
      ? issues.map((issue) => '- ' + issue).join('\n')
      : '- Product passes the current premium structure and slide-object audit; do a visual render check next.';
  const good =
    strengths.length > 0
      ? strengths.map((strength) => '- ' + strength).join('\n')
      : '- No major strengths detected yet.';
  const visual =
    kind === 'slide' && visualSummary
      ? `\nVisual object summary:\n- ${visualSummary.slideCount} slide(s), ${visualSummary.drawingCount} drawing object(s), ${visualSummary.textBoxCount} text box(es), ${visualSummary.imageLikeCount} image/chart-like object(s).`
      : '';
  return `Premium quality audit (${kind}): ${finalScore}/100${visual}\nStrengths:\n${good}\nRequired improvements:\n${next}`;
};

/** Parse a {@link TextFormat} object from untrusted input (or null if invalid). */
const parseTextFormat = (value: unknown): TextFormat | null => {
  if (typeof value !== 'object' || value === null) return null;
  const f = value as Record<string, unknown>;
  const fmt: TextFormat = {};
  if (typeof f.bold === 'boolean') fmt.bold = f.bold;
  if (typeof f.italic === 'boolean') fmt.italic = f.italic;
  if (typeof f.underline === 'boolean') fmt.underline = f.underline;
  if (typeof f.strikeout === 'boolean') fmt.strikeout = f.strikeout;
  if (typeof f.color === 'string') fmt.color = f.color;
  if (typeof f.highlight === 'string') fmt.highlight = f.highlight;
  if (typeof f.fontSize === 'number') fmt.fontSize = f.fontSize;
  if (typeof f.fontFamily === 'string') fmt.fontFamily = f.fontFamily;
  return fmt;
};

const parseObjectAnimationSpecs = (value: unknown): ObjectAnimationSpec[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return null;
  const animations: ObjectAnimationSpec[] = [];
  for (let inputIndex = 0; inputIndex < value.length; inputIndex++) {
    const raw = value[inputIndex];
    if (!isRecord(raw)) return null;
    const slideIndex = typeof raw.slideIndex === 'number' ? Math.round(raw.slideIndex) : 0;
    const drawingName = cleanText(raw.drawingName, 180);
    const drawingIndex = typeof raw.drawingIndex === 'number' ? Math.round(raw.drawingIndex) : undefined;
    const effect =
      typeof raw.effect === 'string' && OBJECT_ANIMATION_EFFECTS.includes(raw.effect as ObjectAnimationSpec['effect'])
        ? (raw.effect as ObjectAnimationSpec['effect'])
        : null;
    const trigger =
      typeof raw.trigger === 'string' &&
      OBJECT_ANIMATION_TRIGGERS.includes(raw.trigger as ObjectAnimationSpec['trigger'])
        ? (raw.trigger as ObjectAnimationSpec['trigger'])
        : null;
    const purpose =
      typeof raw.purpose === 'string' &&
      OBJECT_ANIMATION_PURPOSES.includes(raw.purpose as ObjectAnimationSpec['purpose'])
        ? (raw.purpose as ObjectAnimationSpec['purpose'])
        : null;
    const durationMs = typeof raw.durationMs === 'number' ? Math.round(raw.durationMs) : 500;
    const delayMs = typeof raw.delayMs === 'number' ? Math.round(raw.delayMs) : 0;
    const repeatCount = typeof raw.repeatCount === 'number' ? Math.round(raw.repeatCount) : 1;
    const order = typeof raw.order === 'number' ? Math.round(raw.order) : inputIndex;
    const rationale = cleanText(raw.rationale, 500);
    if (
      slideIndex < 1 ||
      (!drawingName && (drawingIndex === undefined || drawingIndex < 0)) ||
      !effect ||
      !trigger ||
      !purpose ||
      durationMs < 100 ||
      durationMs > 10_000 ||
      delayMs < 0 ||
      delayMs > 30_000 ||
      repeatCount < 1 ||
      repeatCount > 10 ||
      order < 0 ||
      rationale.length < 8
    ) {
      return null;
    }
    animations.push({
      slideIndex,
      drawingName: drawingName || undefined,
      drawingIndex,
      effect,
      trigger,
      durationMs,
      delayMs,
      repeatCount,
      order,
      purpose,
      rationale,
    });
  }
  return animations;
};

/** Validate that `value` is a well-formed {@link DocAgentAction}. */
export const parseAction = (value: unknown): DocAgentAction | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const tool = v.tool;
  switch (tool) {
    case 'get_capabilities':
    case 'read_document':
      return { tool };
    case 'replace_all':
      return typeof v.text === 'string' ? { tool, text: v.text } : null;
    case 'search_replace':
      return typeof v.search === 'string' && typeof v.replace === 'string'
        ? { tool, search: v.search, replace: v.replace }
        : null;
    case 'replace_passage':
      return typeof v.find === 'string' && v.find.length > 0 && typeof v.replacement === 'string'
        ? { tool, find: v.find, replacement: v.replacement, until: typeof v.until === 'string' ? v.until : undefined }
        : null;
    case 'insert_text':
      return typeof v.text === 'string' ? { tool, text: v.text } : null;
    case 'append_text':
      return typeof v.text === 'string' ? { tool, text: v.text } : null;
    case 'apply_headings': {
      if (!Array.isArray(v.headings)) return null;
      const headings: Array<{ text: string; level: number }> = [];
      for (const raw of v.headings) {
        if (typeof raw !== 'object' || raw === null) return null;
        const h = raw as Record<string, unknown>;
        const text = h.text;
        const level = h.level;
        if (typeof text !== 'string' || typeof level !== 'number') return null;
        // Clamp to valid Word heading levels.
        const lvl = Math.min(9, Math.max(1, Math.round(level)));
        headings.push({ text, level: lvl });
      }
      return headings.length > 0 ? { tool, headings } : null;
    }
    case 'insert_toc':
      return { tool, atStart: typeof v.atStart === 'boolean' ? v.atStart : true };
    case 'format_text': {
      if (typeof v.search !== 'string' || v.search.length === 0) return null;
      const fmt = parseTextFormat(v.format);
      return fmt ? { tool, search: v.search, format: fmt } : null;
    }
    case 'format_passage': {
      if (typeof v.find !== 'string' || v.find.length === 0) return null;
      const fmt = parseTextFormat(v.format);
      return fmt ? { tool, find: v.find, format: fmt, until: typeof v.until === 'string' ? v.until : undefined } : null;
    }
    case 'insert_table': {
      const rows = typeof v.rows === 'number' ? Math.round(v.rows) : 0;
      const cols = typeof v.cols === 'number' ? Math.round(v.cols) : 0;
      let data: string[][] | undefined;
      if (Array.isArray(v.data)) {
        const grid: string[][] = [];
        for (const row of v.data) {
          if (!Array.isArray(row)) return null;
          grid.push(row.map((c) => String(c)));
        }
        data = grid;
      }
      if ((rows < 1 || cols < 1) && !data) return null;
      return { tool, rows: Math.max(1, rows), cols: Math.max(1, cols), data };
    }
    case 'set_cells': {
      if (typeof v.start !== 'string' || v.start.length === 0) return null;
      if (!Array.isArray(v.values)) return null;
      const values: Array<Array<string | number>> = [];
      for (const row of v.values) {
        if (!Array.isArray(row)) return null;
        values.push(row.map((c) => (typeof c === 'number' ? c : String(c))));
      }
      if (values.length === 0) return null;
      return { tool, start: v.start, values, sheet: typeof v.sheet === 'string' ? v.sheet : undefined };
    }
    case 'create_premium_doc': {
      const plan = normalizePremiumDocPlan(v.plan);
      return plan ? { tool, plan } : null;
    }

    case 'create_premium_deck': {
      const plan = normalizePremiumDeckPlan(v.plan);
      return plan ? { tool, plan } : null;
    }
    case 'add_premium_slide': {
      const plan = normalizePremiumDeckPlan(v.plan);
      return plan && plan.slides.length === 1 ? { tool, plan } : null;
    }
    case 'structure_report': {
      if (!Array.isArray(v.headings)) return null;
      const headings = v.headings.flatMap((raw): Array<{ text: string; level: number }> => {
        if (!isRecord(raw)) return [];
        const text = cleanText(raw.text, 120);
        if (!text || typeof raw.level !== 'number') return [];
        return [{ text, level: Math.min(9, Math.max(1, Math.round(raw.level))) }];
      });
      return headings.length > 0 ? { tool, headings, insertToc: v.insertToc !== false } : null;
    }
    case 'add_speaker_notes': {
      const slideIndex = typeof v.slideIndex === 'number' ? Math.round(v.slideIndex) : 0;
      const text = cleanText(v.text, 2_000);
      return slideIndex >= 1 && text ? { tool, slideIndex, text } : null;
    }
    case 'apply_slide_transitions': {
      const effect =
        typeof v.effect === 'string' && PREMIUM_DECK_TRANSITIONS.has(v.effect as PremiumDeckTransition)
          ? (v.effect as PremiumDeckTransition)
          : null;
      const speed = v.speed === 'slow' || v.speed === 'fast' ? v.speed : 'medium';
      return effect && effect !== 'none' ? { tool, effect, speed } : null;
    }
    case 'apply_object_animations': {
      const animations = parseObjectAnimationSpecs(v.animations);
      return animations
        ? {
            tool,
            animations,
            replaceExistingMainSequence: v.replaceExistingMainSequence === true,
          }
        : null;
    }
    case 'review_object_animations': {
      if (v.expectedAnimations === undefined) return { tool };
      const expectedAnimations = parseObjectAnimationSpecs(v.expectedAnimations);
      return expectedAnimations ? { tool, expectedAnimations } : null;
    }
    case 'review_premium_quality':
    case 'open_visual_review':
      return { tool };
    case 'run_office_api':
      if (typeof v.code !== 'string') return null;
      const validation = validateOfficeApiScript(v.code);
      return validation.ok ? { tool, code: validation.code } : null;
    case 'finish':
      return { tool, summary: typeof v.summary === 'string' ? v.summary : '' };
    default:
      return null;
  }
};

/** How much document text to feed back per read (avoid oversized prompts). */
const MAX_READ_CHARS = 12000;

/**
 * Execute one validated action against the live editor for `filePath`.
 * Returns a short observation and whether the loop should stop.
 */
export const runTool = async (filePath: string, kind: OfficeDocKind, action: DocAgentAction): Promise<ToolResult> => {
  if (action.tool === 'finish') {
    return { observation: action.summary || 'Done.', done: true };
  }
  if (!ALLOWED[kind].has(action.tool)) {
    return {
      observation: `Tool "${action.tool}" is not available for this ${kind} document. Allowed: ${[...ALLOWED[kind]].join(', ')}.`,
      done: false,
    };
  }
  try {
    switch (action.tool) {
      case 'get_capabilities': {
        const capabilities = getOfficeCapabilities(filePath);
        return {
          observation: `Office capabilities:\n${JSON.stringify(capabilities, null, 2)}`,
          done: false,
          capabilities,
        };
      }
      case 'read_document': {
        const text = await readText(filePath);
        const clipped = text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n…(truncated)` : text;
        return { observation: `Document text:\n${clipped}`, done: false };
      }
      case 'replace_all':
        await replaceAllText(filePath, action.text);
        return { observation: 'Replaced the whole document.', done: false };
      case 'search_replace':
        await searchReplace(filePath, action.search, action.replace);
        return { observation: `Replaced "${action.search}" with "${action.replace}".`, done: false };
      case 'replace_passage': {
        const ok = await replacePassage(filePath, action.find, action.replacement, action.until);
        return {
          observation: ok
            ? `Replaced the passage starting "${action.find.slice(0, 40)}".`
            : `Could not locate the passage starting "${action.find.slice(0, 40)}". Read the document and use the exact text.`,
          done: false,
        };
      }
      case 'insert_text':
        await insertText(filePath, action.text);
        return { observation: 'Inserted text at the cursor.', done: false };
      case 'append_text':
        await appendText(filePath, action.text);
        return { observation: 'Appended a paragraph at the end.', done: false };
      case 'apply_headings': {
        const applied = await applyHeadings(filePath, action.headings);
        return {
          observation:
            applied > 0
              ? `Applied heading styles to ${applied} of ${action.headings.length} paragraph(s).`
              : 'No paragraphs matched the given heading texts (check they match the document text exactly).',
          done: false,
        };
      }
      case 'insert_toc':
        await insertTableOfContents(filePath, action.atStart ?? true);
        return { observation: 'Inserted an automatic table of contents.', done: false };
      case 'format_text': {
        const n = await formatText(filePath, action.search, action.format);
        return {
          observation:
            n > 0
              ? `Formatted ${n} occurrence(s) of "${action.search}".`
              : `No occurrences of "${action.search}" were found to format.`,
          done: false,
        };
      }
      case 'format_passage': {
        const ok = await formatPassage(filePath, action.find, action.format, action.until);
        return {
          observation: ok
            ? `Formatted the passage starting "${action.find.slice(0, 40)}".`
            : `Could not locate the passage starting "${action.find.slice(0, 40)}". Read the document and use the exact text.`,
          done: false,
        };
      }
      case 'insert_table':
        await insertTable(filePath, action.rows, action.cols, action.data);
        return { observation: `Inserted a ${action.rows}×${action.cols} table.`, done: false };
      case 'set_cells': {
        const n = await setCells(filePath, action.start, action.values, action.sheet);
        return { observation: `Wrote ${n} cell(s) starting at ${action.start}.`, done: false };
      }
      case 'create_premium_doc': {
        const html = buildPremiumDocHtml(action.plan);
        await replaceAllText(filePath, '');
        await insertHtml(filePath, html);
        let tocSummary = '';
        if (action.plan.includeToc) {
          const headings = action.plan.sections.map((section) => ({ text: section.heading, level: 1 }));
          const applied = await applyHeadings(filePath, headings);
          await insertTableOfContents(filePath, true);
          tocSummary = ` Applied ${applied} heading style(s) and inserted an automatic TOC.`;
        }
        return {
          observation: `Created premium document with ${action.plan.sections.length} section(s).${tocSummary}`,
          done: false,
        };
      }

      case 'create_premium_deck': {
        const preflight = preflightDeckDesignPlan(action.plan);
        if (!preflight.passed) {
          return { observation: renderDeckPreflightReport(preflight), done: false };
        }
        const script = buildPremiumDeckScript(action.plan);
        const result = await withTimeout(
          'Premium deck generation',
          runOfficeScript(filePath, script),
          PREMIUM_DECK_TIMEOUT_MS
        );
        const recommendations = preflight.issues.length > 0 ? `\n${renderDeckPreflightReport(preflight)}` : '';
        return {
          observation:
            (result.length > 0
              ? result.slice(0, 500)
              : `Created premium deck with ${action.plan.slides.length} slides.`) + recommendations,
          done: false,
        };
      }

      case 'add_premium_slide': {
        const preflight = preflightDeckDesignPlan(action.plan, 'append');
        if (!preflight.passed) {
          return { observation: renderDeckPreflightReport(preflight), done: false };
        }
        const script = buildPremiumDeckAppendScript(action.plan);
        const result = await withTimeout(
          'Premium slide generation',
          runOfficeScript(filePath, script),
          PREMIUM_DECK_TIMEOUT_MS
        );
        const recommendations = preflight.issues.length > 0 ? `\n${renderDeckPreflightReport(preflight)}` : '';
        return {
          observation: (result.length > 0 ? result.slice(0, 500) : 'Appended one premium slide.') + recommendations,
          done: false,
        };
      }

      case 'structure_report': {
        const applied = await applyHeadings(filePath, action.headings);
        if (action.insertToc) await insertTableOfContents(filePath, true);
        return {
          observation: `Applied ${applied} of ${action.headings.length} heading style(s)${action.insertToc ? ' and inserted an automatic TOC' : ''}.`,
          done: false,
        };
      }

      case 'add_speaker_notes': {
        const result = await withTimeout(
          'Add speaker notes',
          runOfficeScript(filePath, buildSpeakerNotesScript(action.slideIndex, action.text))
        );
        return { observation: result || 'Speaker notes command completed.', done: false };
      }

      case 'apply_slide_transitions': {
        const result = await withTimeout(
          'Apply slide transitions',
          runOfficeScript(filePath, buildSlideTransitionsScript(action.effect, action.speed))
        );
        return { observation: result || 'Slide transitions applied.', done: false };
      }

      case 'apply_object_animations': {
        const capability = getOfficeCapabilities(filePath).objectAnimation;
        if (!capability.supported) {
          return { observation: `Object animation is unavailable: ${capability.reason}`, done: false };
        }
        const result = await withTimeout(
          'Apply object animations',
          runOfficeScript(filePath, buildObjectAnimationsScript(action.animations, action.replaceExistingMainSequence))
        );
        return { observation: result || 'Object animation command completed.', done: false };
      }

      case 'review_object_animations': {
        const capability = getOfficeCapabilities(filePath).objectAnimation;
        if (!capability.supported) {
          return { observation: `Object animation review is unavailable: ${capability.reason}`, done: false };
        }
        const result = await withTimeout(
          'Review object animations',
          runOfficeScript(filePath, buildObjectAnimationReviewScript())
        );
        return { observation: reviewObjectAnimations(result, action.expectedAnimations), done: false };
      }

      case 'open_visual_review': {
        const contentType: PreviewContentType = kind === 'slide' ? 'ppt' : kind === 'cell' ? 'excel' : 'word';
        emitter.emit('preview.open', {
          content: filePath,
          contentType,
          metadata: { title: filePath.split(/[\\/]/).at(-1), file_name: filePath, file_path: filePath },
        });
        return { observation: 'Opened the current Office file in the visual preview panel.', done: false };
      }

      case 'review_premium_quality': {
        const text = await readText(filePath);
        let visualSummary: PremiumSlideVisualSummary | null = null;
        if (kind === 'slide') {
          try {
            visualSummary = parseSlideVisualSummary(
              await withTimeout('Slide visual audit', runOfficeScript(filePath, buildSlideVisualSummaryScript()))
            );
          } catch {
            visualSummary = null;
          }
        }
        return { observation: reviewPremiumQuality(kind, text, visualSummary), done: false };
      }

      case 'run_office_api': {
        const validation = validateOfficeApiScript(action.code);
        if (validation.ok === false) {
          return { observation: `Office API script rejected: ${validation.reason}.`, done: false };
        }
        const result = await withTimeout('Office API script', runOfficeScript(filePath, validation.code));
        return {
          observation: result.length > 0 ? `Office API ran. Result: ${result.slice(0, 500)}` : 'Office API ran.',
          done: false,
        };
      }
      default:
        return { observation: 'Unknown tool.', done: false };
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { observation: `Tool error: ${message}`, done: false };
  }
};

/** Extract the first JSON object from a model reply (handles fenced blocks). */
export const extractActionJson = (reply: string): unknown => {
  // Prefer a ```json fenced block; else the first balanced {...}.
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : reply;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  // Walk to the matching closing brace to tolerate trailing prose.
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};
