/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * On-demand page perception for the embedded browser agent (Requirement 1 —
 * "Tích hợp trình duyệt và tác nhân duyệt web", criteria 1.4 and 1.9).
 *
 * The browsing agent does not need the same depth of information for every step,
 * so perception is split into **three layers that are paid for only when used**
 * (criterion 1.4). They map one-to-one onto the table in `design.md`:
 *
 * | Layer            | How                                                        | Cost                         | Lease?                       |
 * | ---------------- | ---------------------------------------------------------- | ---------------------------- | ---------------------------- |
 * | a) Text / DOM    | `executeJavaScript` → page text + a lightweight a11y tree  | Light — the **default**      | No (cheap, read-only DOM)    |
 * | b) Screenshot    | `capturePage()` → PNG / data-URL for a vision model        | Medium                       | **Yes** — `kind: 'browser'`  |
 * | c) Audio / Video | delegate to {@link IMediaPipeline} (summarise / transcribe)| Heavy                        | Yes — owned by `mediaPipeline` |
 *
 * Because layers (b) and (c) are heavy, they MUST go through the
 * ResourceCoordinator (criterion 1.9). Screenshot/vision capture acquires a
 * `'browser'` lease here and releases it in a `try/finally`; the media layer's
 * leases are acquired *inside* {@link IMediaPipeline} (it wraps every ffmpeg /
 * transcribe / summarise step), so this module simply delegates to it.
 *
 * ## Process boundary
 *
 * This is a **Main-process (Node.js / Electron) module — no DOM APIs at module
 * scope.** The DOM-reading snippets are plain **strings** handed to
 * {@link PageDriver.executeJavaScript}; that code runs *inside the page* (where
 * `document` exists), never in Node. Nothing here touches `document` directly.
 *
 * ## Testability (no Electron required)
 *
 * Every collaborator is injected via {@link PagePerceptionDeps}:
 *  - {@link PageDriver} is a **structural subset** of Electron's `WebContents`
 *    (just `executeJavaScript` + `capturePage`), so the real
 *    `browserViewManager.getWebContents(tabId)` satisfies it directly while unit
 *    tests pass a tiny fake;
 *  - {@link LeaseCoordinator} is the same minimal `{ requestLease, releaseLease }`
 *    surface the real `ResourceCoordinator` satisfies structurally;
 *  - {@link IMediaPipeline} is injected for the audio/video layer.
 *
 * The DI style mirrors `mediaPipeline.ts` and `browserViewManager.ts`.
 */

import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { redactSecretText } from '@process/agentRuntime/agentMesh/security';
import type { BrowserTabId } from './browserViewManager';
import type { IMediaPipeline, MediaSource, MediaSummary, TranscribeOptions, TranscriptResult } from './mediaPipeline';
import type { Lease, LeaseRequest, TaskKind } from '@process/resource/leaseTypes';

// ---------------------------------------------------------------------------
// Injected collaborators (interfaces only — no Electron dependency)
// ---------------------------------------------------------------------------

/**
 * The size of a captured image, in device pixels. Mirrors Electron's `Size`
 * (`NativeImage.getSize()`) so a real `NativeImage` satisfies {@link CapturedImage}.
 */
export type ImageSize = {
  /** Image width in device pixels. */
  width: number;
  /** Image height in device pixels. */
  height: number;
};

/**
 * Minimal structural subset of Electron's `NativeImage` that the screenshot
 * layer consumes. A real `NativeImage` satisfies this (it has all these methods
 * plus more), and tests can supply a tiny fake. PNG bytes are typed as
 * `Uint8Array` (which `Buffer` extends) to avoid depending on Node's `Buffer`.
 */
export type CapturedImage = {
  /** Encode the image as a `data:image/png;base64,...` URL (vision-model ready). */
  toDataURL(): string;
  /** Encode the image as raw PNG bytes. */
  toPNG(): Uint8Array;
  /** Image dimensions in device pixels. */
  getSize(): ImageSize;
  /** Whether the image is empty (e.g. capture failed). */
  isEmpty(): boolean;
};

/**
 * Minimal structural subset of Electron's `WebContents` needed to perceive a
 * page. Declared locally (rather than importing `WebContents`) so this module
 * has **no** Electron dependency and stays unit-testable. The real
 * `WebContents` is assignable to this because it exposes both methods with
 * compatible signatures.
 */
export type PageDriver = {
  /**
   * Evaluate `code` in the page's main world and resolve with its result. The
   * `code` is a string that runs *in the page* (where `document` exists).
   */
  executeJavaScript(code: string): Promise<unknown>;
  /** Evaluate in an isolated renderer world when Electron exposes it. */
  executeJavaScriptInIsolatedWorld?(
    worldId: number,
    scripts: Array<{ code: string }>,
    userGesture?: boolean
  ): Promise<unknown>;
  /** Current top-level URL, used for an exact-origin race check. */
  getURL?(): string;
  /** Capture the current page as an image for the vision layer. */
  capturePage(): Promise<CapturedImage>;
};

/**
 * Minimal subset of the ResourceCoordinator used by the screenshot layer. The
 * real `IResourceCoordinator` satisfies this structurally, so it can be passed
 * directly; tests inject a lightweight fake. Mirrors `mediaPipeline.ts`.
 */
export type LeaseCoordinator = {
  /** Request a lease for a heavy task; resolves when the budget allows. */
  requestLease: (req: LeaseRequest) => Promise<Lease>;
  /** Release a previously granted lease by id. */
  releaseLease: (id: string) => void;
};

// ---------------------------------------------------------------------------
// Public data models
// ---------------------------------------------------------------------------

/**
 * A node in the lightweight accessibility tree produced by the text/DOM layer.
 * This is **not** Chromium's full accessibility tree (which is not reachable via
 * `executeJavaScript`); it is a compact, JSON-serialisable approximation built
 * from ARIA roles and accessible names — enough for the agent to locate and
 * reason about interactive elements cheaply.
 */
export type AccessibilityNode = {
  /** ARIA role (explicit `role` attribute, else the lowercased tag name). */
  role: string;
  /** Accessible name: `aria-label`, `alt`, `title`, or trimmed text content. */
  name: string;
  /** Form value for inputs/selects/textareas, when present. */
  value?: string;
  /** Child nodes, in document order (bounded by depth/breadth limits). */
  children: AccessibilityNode[];
};

/** Result of the screenshot/vision layer ({@link IPagePerception.capture}). */
export type CaptureResult = {
  /** `data:image/png;base64,...` URL, directly consumable by a vision model. */
  dataUrl: string;
  /** Raw PNG bytes, for callers that prefer a binary payload. */
  png: Uint8Array;
  /** Captured image width in device pixels. */
  width: number;
  /** Captured image height in device pixels. */
  height: number;
  /** Opaque metadata explaining which known secret fields were protected. */
  secretContext?: SecretRedactionSummary;
};

/** Agent-safe metadata for a registered secret field. Never contains a value. */
export type SecretRedactionReference = {
  name: string;
  reference?: string;
  status: 'redacted';
};

/** Summary attached to protected screenshots. */
export type SecretRedactionSummary = {
  redactedRegions: number;
  sensitiveMode: boolean;
  detected: SecretRedactionReference[];
};

/** Exact tab/origin selector registration retained only for a bounded TTL. */
export type SecretSelectorRegistration = {
  tabId: BrowserTabId;
  hostname: string;
  selector: string;
  name: string;
  reference?: string;
  ttlMs?: number;
};

type SecretSelectorRule = Omit<SecretSelectorRegistration, 'tabId' | 'hostname' | 'ttlMs'> & {
  expiresAt: number;
};

export type SecretRedactionSnapshot = {
  selectors: SecretSelectorRule[];
  sensitiveMode: boolean;
};

/** Main-process registry used by secret sinks and page perception. */
export type BrowserSecretRedactionRegistry = {
  registerSelector(request: SecretSelectorRegistration): void;
  enableSensitiveMode(request: { tabId: BrowserTabId; hostname: string; ttlMs?: number }): void;
  snapshot(tabId: BrowserTabId, hostname: string): SecretRedactionSnapshot;
  clearTab(tabId: BrowserTabId): void;
};

/**
 * What the audio/video layer should do with a {@link MediaSource}. Discriminated
 * by `action` so {@link IPagePerception.perceiveMedia} stays type-safe while
 * delegating to the matching {@link IMediaPipeline} method.
 */
export type MediaPerceptionRequest =
  | {
      /** Summarise the media (YouTube fast path or transcript fallback). */
      action: 'summarize';
      /** The media to perceive. */
      source: MediaSource;
      /** Optional transcription options forwarded to the pipeline. */
      options?: TranscribeOptions;
    }
  | {
      /** Transcribe the media into timestamped segments. */
      action: 'transcribe';
      /** The media to perceive. */
      source: MediaSource;
      /** Optional transcription options forwarded to the pipeline. */
      options?: TranscribeOptions;
    };

/** Result of {@link IPagePerception.perceiveMedia}, discriminated by `action`. */
export type MediaPerceptionResult =
  | {
      /** Matches a `'summarize'` request. */
      action: 'summarize';
      /** The summary produced by the pipeline. */
      summary: MediaSummary;
    }
  | {
      /** Matches a `'transcribe'` request. */
      action: 'transcribe';
      /** The transcript produced by the pipeline. */
      transcript: TranscriptResult;
    };

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/**
 * The three on-demand perception layers for one embedded browser. Each method
 * resolves the target tab's {@link PageDriver} via the injected accessor, so an
 * unknown/destroyed tab fails fast with a descriptive error.
 */
export type IPagePerception = {
  /**
   * **Layer (a) — light, default.** Read visible text from the page, optionally
   * scoped to the first element matching `selector`. No lease (cheap DOM read).
   *
   * @param tabId    The tab to read.
   * @param selector Optional CSS selector; when omitted, the whole `<body>`.
   * @returns The element's rendered text (empty string if nothing matched).
   * @throws if the tab is unknown or already destroyed.
   */
  readText(tabId: BrowserTabId, selector?: string): Promise<string>;

  /**
   * **Layer (a) — light, default.** Build a compact accessibility tree (role /
   * name / value) from the page's DOM. No lease (cheap DOM read).
   *
   * @param tabId The tab to inspect.
   * @returns The root {@link AccessibilityNode} of the page.
   * @throws if the tab is unknown or already destroyed.
   */
  readAccessibilityTree(tabId: BrowserTabId): Promise<AccessibilityNode>;

  /**
   * **Layer (b) — medium, vision.** Capture the page as an image for a vision
   * model. Heavy, so it is wrapped in a `'browser'` {@link Lease} that is always
   * released in a `try/finally` (criteria 1.4b and 1.9).
   *
   * @param tabId The tab to capture.
   * @returns The captured image as a data-URL + PNG bytes + size.
   * @throws if the tab is unknown/destroyed, or if the capture is empty.
   */
  capture(tabId: BrowserTabId): Promise<CaptureResult>;

  /**
   * Protect an image produced by another trusted browser capture engine. The
   * callback runs between two DOM scans so navigation or layout races fail
   * closed before any pixels are returned to an agent.
   */
  protectCapture(
    tabId: BrowserTabId,
    mode: 'viewport' | 'fullPage',
    capture: () => Promise<Uint8Array>
  ): Promise<CaptureResult>;

  /**
   * **Layer (c) — heavy, audio/video.** Delegate media perception to the injected
   * {@link IMediaPipeline}. The pipeline owns its own ResourceCoordinator leases
   * (criterion 1.9), so this method does not acquire one itself.
   *
   * @param request What to do and the media source.
   * @returns The pipeline result, discriminated by the request `action`.
   */
  perceiveMedia(request: MediaPerceptionRequest): Promise<MediaPerceptionResult>;
};

// ---------------------------------------------------------------------------
// Dependencies + defaults
// ---------------------------------------------------------------------------

/** Injected dependencies and tunables for {@link createPagePerception}. */
export type PagePerceptionDeps = {
  /**
   * Resolve the {@link PageDriver} for a tab. In production this is
   * `browserViewManager.getWebContents` (a `WebContents` satisfies
   * {@link PageDriver}); returns `undefined` for unknown/destroyed tabs.
   */
  getWebContents: (tabId: BrowserTabId) => PageDriver | undefined;
  /** The media pipeline backing the audio/video layer. */
  mediaPipeline?: IMediaPipeline;
  /** Lease gate for the screenshot/vision layer (criterion 1.9). */
  coordinator: LeaseCoordinator;
  /** Estimated RAM cost (MB) charged while a screenshot capture runs. */
  captureCostMB?: number;
  /** Lease kind for screenshot/vision capture. Defaults to `'browser'`. */
  captureLeaseKind?: TaskKind;
  /** Max recursion depth for {@link IPagePerception.readAccessibilityTree}. */
  accessibilityMaxDepth?: number;
  /** Exact tab/origin secret selector registry. Defaults to the process singleton. */
  redactionRegistry?: BrowserSecretRedactionRegistry;
};

/** Default estimated RAM cost (MB) for one screenshot capture (medium weight). */
const DEFAULT_CAPTURE_COST_MB = 256;

/** Default lease kind for screenshot/vision capture (criterion 1.9). */
const DEFAULT_CAPTURE_LEASE_KIND: TaskKind = 'browser';

/** Default maximum depth walked when building the accessibility tree. */
const DEFAULT_ACCESSIBILITY_MAX_DEPTH = 24;

const REDACTION_WORLD_ID = 1002;
const DEFAULT_SECRET_RULE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SENSITIVE_MODE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SECRET_RULE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REDACTION_SELECTORS_PER_ORIGIN = 64;
const MAX_REDACTION_ORIGINS = 128;
const REDACTED_TEXT = '[REDACTED]';

type RegistryEntry = {
  tabId: BrowserTabId;
  hostname: string;
  selectors: Map<string, SecretSelectorRule>;
  sensitiveUntil: number;
  touchedAt: number;
};

const normalizeExactHostname = (value: string): string => {
  const hostname = value.trim().toLowerCase();
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes('://') ||
    hostname.includes('/') ||
    hostname.includes(':') ||
    hostname.includes('*') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(hostname)
  ) {
    throw new Error('Secret redaction requires one exact hostname.');
  }
  return hostname;
};

const boundedTtl = (ttlMs: number | undefined, fallback: number): number =>
  Math.min(MAX_SECRET_RULE_TTL_MS, Math.max(1_000, Math.floor(ttlMs ?? fallback)));

/** Create a bounded, in-memory selector registry. It never stores plaintext. */
export const createBrowserSecretRedactionRegistry = (now: () => number = Date.now): BrowserSecretRedactionRegistry => {
  const entries = new Map<string, RegistryEntry>();
  const keyOf = (tabId: BrowserTabId, hostname: string): string => `${tabId}\n${hostname}`;

  const prune = (): void => {
    const current = now();
    for (const [key, entry] of entries) {
      for (const [selector, rule] of entry.selectors) {
        if (rule.expiresAt <= current) entry.selectors.delete(selector);
      }
      if (entry.selectors.size === 0 && entry.sensitiveUntil <= current) entries.delete(key);
    }
    if (entries.size <= MAX_REDACTION_ORIGINS) return;
    const oldest = [...entries.entries()].toSorted((left, right) => left[1].touchedAt - right[1].touchedAt);
    for (const [key] of oldest.slice(0, entries.size - MAX_REDACTION_ORIGINS)) entries.delete(key);
  };

  const getOrCreate = (tabId: BrowserTabId, hostname: string): RegistryEntry => {
    prune();
    const key = keyOf(tabId, hostname);
    const existing = entries.get(key);
    if (existing) {
      existing.touchedAt = now();
      return existing;
    }
    const created: RegistryEntry = {
      tabId,
      hostname,
      selectors: new Map(),
      sensitiveUntil: 0,
      touchedAt: now(),
    };
    entries.set(key, created);
    return created;
  };

  return {
    registerSelector: (request) => {
      const hostname = normalizeExactHostname(request.hostname);
      const selector = request.selector.trim();
      const name = request.name.trim();
      if (!selector || selector.length > 2_048) throw new Error('Secret redaction selector is invalid.');
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new Error('Secret redaction name is invalid.');
      if (request.reference !== undefined && request.reference.length > 512) {
        throw new Error('Secret redaction reference is invalid.');
      }
      const entry = getOrCreate(request.tabId, hostname);
      if (!entry.selectors.has(selector) && entry.selectors.size >= MAX_REDACTION_SELECTORS_PER_ORIGIN) {
        const first = entry.selectors.keys().next().value;
        if (typeof first === 'string') entry.selectors.delete(first);
      }
      entry.selectors.set(selector, {
        selector,
        name,
        ...(request.reference ? { reference: request.reference } : {}),
        expiresAt: now() + boundedTtl(request.ttlMs, DEFAULT_SECRET_RULE_TTL_MS),
      });
      prune();
    },
    enableSensitiveMode: (request) => {
      const hostname = normalizeExactHostname(request.hostname);
      const entry = getOrCreate(request.tabId, hostname);
      entry.sensitiveUntil = Math.max(
        entry.sensitiveUntil,
        now() + boundedTtl(request.ttlMs, DEFAULT_SENSITIVE_MODE_TTL_MS)
      );
      prune();
    },
    snapshot: (tabId, rawHostname) => {
      const hostname = normalizeExactHostname(rawHostname);
      prune();
      const entry = entries.get(keyOf(tabId, hostname));
      if (!entry) return { selectors: [], sensitiveMode: false };
      entry.touchedAt = now();
      return {
        selectors: [...entry.selectors.values()].map((rule) => ({ ...rule })),
        sensitiveMode: entry.sensitiveUntil > now(),
      };
    },
    clearTab: (tabId) => {
      for (const [key, entry] of entries) {
        if (entry.tabId === tabId) entries.delete(key);
      }
    },
  };
};

const sharedSecretRedactionRegistry = createBrowserSecretRedactionRegistry();

/** Shared Main-process registry used by browser secret capture/fill sinks. */
export const getBrowserSecretRedactionRegistry = (): BrowserSecretRedactionRegistry => sharedSecretRedactionRegistry;

const isAlreadyMasked = (value: string): boolean =>
  /^(?:\*{3,}|[•●xX]{3,}|\[?redacted(?::[^\]]+)?\]?|<redacted>)$/i.test(value.trim());

const SECRET_KEY_NAME =
  /(?:password|passphrase|secret|api[_ .-]?key|access[_ .-]?token|refresh[_ .-]?token|private[_ .-]?key|client[_ .-]?secret|authorization|credential)/i;

/** Final Main-process text scrubber applied after DOM extraction. */
export const redactAgentVisibleText = (input: string, sensitiveMode = false): string => {
  let output = input.replace(
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
    REDACTED_TEXT
  );

  output = output
    .split(/(\r?\n)/)
    .map((line) => {
      if (/^\r?\n$/.test(line)) return line;
      const assignment = line.match(/^(\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]{0,127})["']?\s*[:=]\s*)(.*)$/);
      if (!assignment || !SECRET_KEY_NAME.test(assignment[2] ?? '')) return line;
      const value = (assignment[3] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
      return !value || isAlreadyMasked(value) ? line : `${assignment[1]}${REDACTED_TEXT}`;
    })
    .join('');

  output = output.replace(
    /((?:client[_ .-]?secret|api[_ .-]?key|access[_ .-]?token|refresh[_ .-]?token|password|passphrase|authorization)\s*[:=]\s*)(["']?)([^\s,"';&]+)\2/gi,
    (match, prefix: string, _quote: string, value: string) =>
      isAlreadyMasked(value) ? match : `${prefix}${REDACTED_TEXT}`
  );
  output = output.replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, `Bearer ${REDACTED_TEXT}`);
  output = output.replace(
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|GOCSPX-[0-9A-Za-z_-]{12,}|AKIA[0-9A-Z]{16})\b/g,
    REDACTED_TEXT
  );
  output = output.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED_TEXT);

  if (sensitiveMode) {
    output = output.replace(
      /\b(?=[A-Za-z0-9+/_=-]{24,}\b)(?=[^\s]*[A-Za-z])(?=[^\s]*\d)[A-Za-z0-9+/_=-]+\b/g,
      (value) => (isAlreadyMasked(value) ? value : REDACTED_TEXT)
    );
  }
  return redactSecretText(output).text;
};

// ---------------------------------------------------------------------------
// In-page snippets (run in the page via executeJavaScript — NOT in Node)
// ---------------------------------------------------------------------------

/**
 * Build the in-page snippet that reads rendered text, optionally scoped to a
 * selector. The selector is embedded via `JSON.stringify` so it is safely
 * escaped and cannot break out of the string literal.
 *
 * @param selector Optional CSS selector; when omitted, reads `<body>`.
 * @returns A self-invoking expression string for `executeJavaScript`.
 */
type PageRedactionContext = {
  expectedHostname?: string;
  snapshot: SecretRedactionSnapshot;
};

type PageRedactionRect = { x: number; y: number; width: number; height: number };

type PageRedactionScan = {
  hostname: string;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  rects: PageRedactionRect[];
  matchedSelectors: string[];
  detectedNames: string[];
};

const redactionPrelude = (context: PageRedactionContext, screenshotMode?: 'viewport' | 'fullPage'): string => `
  const __tomnyExpectedHostname = ${JSON.stringify(context.expectedHostname ?? '')};
  const __tomnyRegisteredSelectors = ${JSON.stringify(context.snapshot.selectors.map((rule) => rule.selector))};
  const __tomnySensitiveMode = ${JSON.stringify(context.snapshot.sensitiveMode)};
  const __tomnyScreenshotMode = ${JSON.stringify(screenshotMode ?? '')};
  const __tomnyHostname = String(location.hostname || '').toLowerCase();
  if (__tomnyExpectedHostname && __tomnyHostname !== __tomnyExpectedHostname) {
    return { __tomnyRedactionError: 'origin-changed' };
  }
  const __tomnySecretLabel = /(?:password|passphrase|secret|api[_ .-]?key|access[_ .-]?token|refresh[_ .-]?token|private[_ .-]?key|client[_ .-]?secret|authorization|credential)/i;
  const __tomnyKnownToken = /(?:-----BEGIN [^-\\n]*PRIVATE KEY-----|\\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\\bgh[pousr]_[A-Za-z0-9_]{20,}|\\bgithub_pat_[A-Za-z0-9_]{20,}|\\bAIza[0-9A-Za-z_-]{20,}|\\bGOCSPX-[0-9A-Za-z_-]{12,}|\\bAKIA[0-9A-Z]{16}|\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,})/i;
  const __tomnyAlreadyMasked = (value) => /^(?:\\*{3,}|[•●xX]{3,}|\\[?redacted(?::[^\\]]+)?\\]?|<redacted>)$/i.test(String(value || '').trim());
  const __tomnyOwnText = (element) => Array.from(element.childNodes || [])
    .filter((node) => node.nodeType === 3)
    .map((node) => String(node.textContent || '').trim())
    .join(' ')
    .trim();
  const __tomnyAttributeText = (element) => [
    'type', 'name', 'id', 'placeholder', 'aria-label', 'title', 'autocomplete',
    'data-tomny-secret', 'data-secret', 'data-testid'
  ].map((name) => String(element.getAttribute && element.getAttribute(name) || '')).join(' ');
  const __tomnyDetectedName = (element) => {
    const ownText = __tomnyOwnText(element);
    const assignment = ownText.match(/(?:^|\\s)([A-Za-z_][A-Za-z0-9_.-]{1,127})\\s*[:=]/);
    const semantic = [
      element.getAttribute && element.getAttribute('name'),
      element.id,
      element.getAttribute && element.getAttribute('aria-label'),
      element.getAttribute && element.getAttribute('autocomplete'),
    ].filter(Boolean).join(' ');
    const label = semantic.match(__tomnySecretLabel);
    const raw = assignment && assignment[1] || label && label[0] || 'DETECTED_SECRET';
    const normalized = String(raw).trim().replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 128);
    return /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(normalized) ? normalized : 'DETECTED_SECRET';
  };
  const __tomnyFindById = (root, id) => {
    if (!id) return null;
    for (const element of Array.from(root.querySelectorAll('[id]'))) {
      if (element.id === id) return element;
    }
    return null;
  };
  const __tomnyAddLabelTarget = (root, label, targets) => {
    const htmlFor = String(label.getAttribute && label.getAttribute('for') || '');
    const control = htmlFor ? __tomnyFindById(root, htmlFor) : label.querySelector && label.querySelector('input, textarea, select');
    if (control) targets.add(control);
    const sibling = label.nextElementSibling;
    if (sibling && String(sibling.textContent || '').trim().length <= 4096) targets.add(sibling);
    const parent = label.parentElement;
    if (parent) {
      for (const candidate of Array.from(parent.querySelectorAll('input, textarea, select, code, pre, [data-value]'))) {
        if (candidate !== label) targets.add(candidate);
      }
    }
  };
  const __tomnyCollectTargets = (root) => {
    const targets = new Set();
    const matchedSelectors = [];
    let invalidSelector = false;
    for (const selector of __tomnyRegisteredSelectors) {
      try {
        const matches = [];
        if (root.matches && root.matches(selector)) matches.push(root);
        matches.push(...Array.from(root.querySelectorAll(selector)));
        if (matches.length > 0) matchedSelectors.push(selector);
        for (const match of matches) targets.add(match);
      } catch {
        invalidSelector = true;
      }
    }
    const genericSelector = [
      'input[type="password"]',
      'input[autocomplete="current-password"]',
      'input[autocomplete="new-password"]',
      'input[autocomplete="one-time-code"]',
      '[data-tomny-secret]',
      '[data-secret-redact]'
    ].join(',');
    for (const element of Array.from(root.querySelectorAll(genericSelector))) targets.add(element);
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const attributes = __tomnyAttributeText(element);
      const ownText = __tomnyOwnText(element);
      const tag = String(element.tagName || '').toUpperCase();
      if (__tomnySecretLabel.test(attributes)) {
        if (tag === 'LABEL') __tomnyAddLabelTarget(root, element, targets);
        else targets.add(element);
      }
      if (__tomnySecretLabel.test(ownText) && ownText.length <= 160) {
        if (/[:=]/.test(ownText) || __tomnyKnownToken.test(ownText)) targets.add(element);
        __tomnyAddLabelTarget(root, element, targets);
      }
      if ((tag === 'CODE' || tag === 'PRE' || tag === 'SAMP') && __tomnyKnownToken.test(String(element.textContent || ''))) {
        targets.add(element);
      }
    }
    if (__tomnySensitiveMode && __tomnyScreenshotMode) {
      for (const element of Array.from(root.querySelectorAll('iframe, frame, canvas, video, object, embed'))) {
        targets.add(element);
      }
    }
    return { targets, matchedSelectors, invalidSelector };
  };
`;

const buildReadTextScript = (selector: string | undefined, context: PageRedactionContext): string => {
  const selectorLiteral = selector === undefined ? 'null' : JSON.stringify(selector);
  return `(() => {
  ${redactionPrelude(context)}
  const selector = ${selectorLiteral};
  let source;
  try {
    source = selector ? document.querySelector(selector) : document.body;
  } catch {
    return { __tomnyRedactionError: 'invalid-read-selector' };
  }
  if (!source) return { text: '', matchedSelectors: [] };
  const root = source.cloneNode(true);
  const collected = __tomnyCollectTargets(root);
  if (collected.invalidSelector) return { __tomnyRedactionError: 'invalid-secret-selector' };
  for (const element of collected.targets) {
    const current = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : String(element.textContent || '').trim();
    if (__tomnyAlreadyMasked(current)) continue;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      element.value = '${REDACTED_TEXT}';
      element.setAttribute('value', '${REDACTED_TEXT}');
      element.setAttribute('aria-valuetext', '${REDACTED_TEXT}');
    } else {
      element.textContent = '${REDACTED_TEXT}';
    }
  }
  const text = root.innerText != null ? root.innerText : root.textContent;
  return { text: text ? String(text).trim() : '', matchedSelectors: collected.matchedSelectors };
})()`;
};

/**
 * Build the in-page snippet that produces a compact accessibility tree. The
 * walk is bounded by `maxDepth` (and skips invisible / script / style nodes) so
 * the serialised payload stays small even on large pages.
 *
 * @param maxDepth Maximum recursion depth.
 * @returns A self-invoking expression string for `executeJavaScript`.
 */
const buildAccessibilityScript = (maxDepth: number, context: PageRedactionContext): string => `(() => {
  ${redactionPrelude(context)}
  const MAX_DEPTH = ${maxDepth};
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
  const isHidden = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    return el.getAttribute('aria-hidden') === 'true';
  };
  const collected = __tomnyCollectTargets(document.documentElement);
  if (collected.invalidSelector) return { __tomnyRedactionError: 'invalid-secret-selector' };
  const nameOf = (el) => {
    if (collected.targets.has(el)) {
      const current = [
        el.getAttribute('aria-label'),
        el.getAttribute('alt'),
        el.getAttribute('title'),
        String(el.textContent || '').trim(),
      ].filter(Boolean).join(' ');
      if (current && !__tomnyAlreadyMasked(current)) return '${REDACTED_TEXT}';
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();
    const title = el.getAttribute('title');
    if (title) return title.trim();
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || '').trim())
      .join(' ')
      .trim();
    return own;
  };
  const valueOf = (el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (collected.targets.has(el) && !__tomnyAlreadyMasked(el.value)) return '${REDACTED_TEXT}';
      return el.value || undefined;
    }
    return undefined;
  };
  const build = (el, depth) => {
    const node = {
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name: nameOf(el),
      children: [],
    };
    const value = valueOf(el);
    if (value !== undefined) node.value = value;
    if (depth < MAX_DEPTH) {
      for (const child of Array.from(el.children)) {
        if (SKIP.has(child.tagName) || isHidden(child)) continue;
        node.children.push(build(child, depth + 1));
      }
    }
    return node;
  };
  const root = document.body || document.documentElement;
  return build(root, 0);
})()`;

const buildScreenshotScanScript = (context: PageRedactionContext, mode: 'viewport' | 'fullPage'): string => `(() => {
  ${redactionPrelude(context, mode)}
  const root = document.documentElement;
  if (!root) return { __tomnyRedactionError: 'missing-document' };
  const collected = __tomnyCollectTargets(root);
  if (collected.invalidSelector) return { __tomnyRedactionError: 'invalid-secret-selector' };
  const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
  const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
  const documentWidth = Math.max(viewportWidth, root.scrollWidth || 0, document.body && document.body.scrollWidth || 0);
  const documentHeight = Math.max(viewportHeight, root.scrollHeight || 0, document.body && document.body.scrollHeight || 0);
  const rects = [];
  const detectedNames = [];
  for (const element of collected.targets) {
    const visualValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : String(element.textContent || '').trim();
    if (__tomnyAlreadyMasked(visualValue)) continue;
    let detected = false;
    for (const rawRect of Array.from(element.getClientRects ? element.getClientRects() : [])) {
      if (!rawRect || rawRect.width <= 0 || rawRect.height <= 0) continue;
      let x = rawRect.left;
      let y = rawRect.top;
      let width = rawRect.width;
      let height = rawRect.height;
      if (__tomnyScreenshotMode === 'fullPage') {
        x += window.scrollX || 0;
        y += window.scrollY || 0;
      } else {
        const right = Math.min(viewportWidth, rawRect.right);
        const bottom = Math.min(viewportHeight, rawRect.bottom);
        x = Math.max(0, x);
        y = Math.max(0, y);
        width = right - x;
        height = bottom - y;
      }
      if (width > 0 && height > 0) {
        rects.push({ x, y, width, height });
        if (!detected) {
          detectedNames.push(__tomnyDetectedName(element));
          detected = true;
        }
      }
      if (rects.length >= 256) break;
    }
    if (rects.length >= 256) break;
  }
  return {
    hostname: __tomnyHostname,
    viewportWidth,
    viewportHeight,
    documentWidth,
    documentHeight,
    rects,
    matchedSelectors: collected.matchedSelectors,
    detectedNames,
  };
})()`;

const exactHostnameFromDriver = (driver: PageDriver): string | undefined => {
  if (!driver.getURL) return undefined;
  try {
    const url = new URL(driver.getURL());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return normalizeExactHostname(url.hostname);
  } catch {
    return undefined;
  }
};

const evaluateTrusted = async (driver: PageDriver, code: string): Promise<unknown> => {
  if (driver.executeJavaScriptInIsolatedWorld) {
    return driver.executeJavaScriptInIsolatedWorld(REDACTION_WORLD_ID, [{ code }]);
  }
  return driver.executeJavaScript(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeScriptResult = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value) || typeof value.__tomnyRedactionError === 'string') {
    throw new Error('[PagePerception] Secret redaction could not be guaranteed.');
  }
  return value;
};

const sanitizeAccessibilityNode = (value: unknown, sensitiveMode: boolean): AccessibilityNode => {
  if (!isRecord(value) || typeof value.role !== 'string' || !Array.isArray(value.children)) {
    throw new Error('[PagePerception] Accessibility output was not safely structured.');
  }
  const node: AccessibilityNode = {
    role: redactAgentVisibleText(value.role, sensitiveMode),
    name: redactAgentVisibleText(typeof value.name === 'string' ? value.name : '', sensitiveMode),
    children: value.children.map((child) => sanitizeAccessibilityNode(child, sensitiveMode)),
  };
  if (typeof value.value === 'string') node.value = redactAgentVisibleText(value.value, sensitiveMode);
  return node;
};

const parseRedactionScan = (value: unknown): PageRedactionScan => {
  const result = assertSafeScriptResult(value);
  const rects = Array.isArray(result.rects)
    ? result.rects.flatMap((raw): PageRedactionRect[] => {
        if (!isRecord(raw)) return [];
        const { x, y, width, height } = raw;
        if (
          typeof x !== 'number' ||
          typeof y !== 'number' ||
          typeof width !== 'number' ||
          typeof height !== 'number' ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0
        ) {
          return [];
        }
        return [{ x, y, width, height }];
      })
    : [];
  const numeric = (key: string): number => {
    const raw = result[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new Error('[PagePerception] Secret redaction geometry was unavailable.');
    }
    return raw;
  };
  if (typeof result.hostname !== 'string') {
    throw new Error('[PagePerception] Secret redaction origin was unavailable.');
  }
  return {
    hostname: result.hostname.toLowerCase(),
    viewportWidth: numeric('viewportWidth'),
    viewportHeight: numeric('viewportHeight'),
    documentWidth: numeric('documentWidth'),
    documentHeight: numeric('documentHeight'),
    rects: rects.slice(0, 256),
    matchedSelectors: Array.isArray(result.matchedSelectors)
      ? result.matchedSelectors.filter((selector): selector is string => typeof selector === 'string').slice(0, 64)
      : [],
    detectedNames: Array.isArray(result.detectedNames)
      ? result.detectedNames
          .filter((name): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(name))
          .slice(0, 64)
      : [],
  };
};

const scansAreCompatible = (
  before: PageRedactionScan,
  after: PageRedactionScan,
  mode: 'viewport' | 'fullPage'
): boolean => {
  if (before.hostname !== after.hostname) return false;
  const beforeWidth = mode === 'viewport' ? before.viewportWidth : before.documentWidth;
  const beforeHeight = mode === 'viewport' ? before.viewportHeight : before.documentHeight;
  const afterWidth = mode === 'viewport' ? after.viewportWidth : after.documentWidth;
  const afterHeight = mode === 'viewport' ? after.viewportHeight : after.documentHeight;
  return Math.abs(beforeWidth - afterWidth) <= 1 && Math.abs(beforeHeight - afterHeight) <= 1;
};

const rectsAreStable = (before: PageRedactionRect[], after: PageRedactionRect[]): boolean =>
  before.length === after.length &&
  before.every((rect, index) => {
    const next = after[index];
    return (
      Boolean(next) &&
      Math.abs(rect.x - next.x) <= 2 &&
      Math.abs(rect.y - next.y) <= 2 &&
      Math.abs(rect.width - next.width) <= 2 &&
      Math.abs(rect.height - next.height) <= 2
    );
  });

const protectPng = async (
  png: Uint8Array,
  mode: 'viewport' | 'fullPage',
  before: PageRedactionScan,
  after: PageRedactionScan,
  context: PageRedactionContext
): Promise<CaptureResult> => {
  if (!scansAreCompatible(before, after, mode)) {
    throw new Error('[PagePerception] Page changed while secret-safe capture was running.');
  }
  if (context.snapshot.sensitiveMode && !rectsAreStable(before.rects, after.rects)) {
    throw new Error('[PagePerception] Secret regions moved while the protected capture was running.');
  }
  if (context.expectedHostname && before.hostname !== context.expectedHostname) {
    throw new Error('[PagePerception] Page origin changed while secret-safe capture was running.');
  }

  const matchedSelectors = new Set([...before.matchedSelectors, ...after.matchedSelectors]);
  const registered = context.snapshot.selectors.map((rule) => rule.selector);
  const rects = [...before.rects, ...after.rects];
  if (
    context.snapshot.sensitiveMode &&
    (rects.length === 0 || registered.some((selector) => !matchedSelectors.has(selector)))
  ) {
    throw new Error('[PagePerception] Sensitive page could not be safely redacted.');
  }

  const source = Buffer.from(png);
  const metadata = await sharp(source).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error('[PagePerception] Captured image dimensions are unavailable.');

  const coordinateWidth = mode === 'viewport' ? before.viewportWidth : before.documentWidth;
  const coordinateHeight = mode === 'viewport' ? before.viewportHeight : before.documentHeight;
  const scaleX = width / coordinateWidth;
  const scaleY = height / coordinateHeight;
  const pixelRects = rects.flatMap((rect): PageRedactionRect[] => {
    const left = Math.max(0, Math.floor(rect.x * scaleX) - 2);
    const top = Math.max(0, Math.floor(rect.y * scaleY) - 2);
    const right = Math.min(width, Math.ceil((rect.x + rect.width) * scaleX) + 2);
    const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * scaleY) + 2);
    return right > left && bottom > top ? [{ x: left, y: top, width: right - left, height: bottom - top }] : [];
  });

  let protectedPng: Uint8Array = source;
  if (pixelRects.length > 0) {
    const rectangles = pixelRects
      .map((rect) => `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#111"/>`)
      .join('');
    const overlay = Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rectangles}</svg>`
    );
    protectedPng = await sharp(source)
      .composite([{ input: overlay, left: 0, top: 0 }])
      .png()
      .toBuffer();
  }

  const detected = context.snapshot.selectors
    .filter((rule) => matchedSelectors.has(rule.selector))
    .map((rule): SecretRedactionReference => {
      const item: SecretRedactionReference = { name: rule.name, status: 'redacted' };
      if (rule.reference) item.reference = rule.reference;
      return item;
    })
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.name === item.name && candidate.reference === item.reference) === index
    );
  for (const name of new Set([...before.detectedNames, ...after.detectedNames])) {
    if (!detected.some((item) => item.name === name)) detected.push({ name, status: 'redacted' });
  }
  const secretContext: SecretRedactionSummary = {
    redactedRegions: pixelRects.length,
    sensitiveMode: context.snapshot.sensitiveMode,
    detected,
  };
  return {
    dataUrl: `data:image/png;base64,${Buffer.from(protectedPng).toString('base64')}`,
    png: protectedPng,
    width,
    height,
    secretContext,
  };
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link IPagePerception} from injected collaborators.
 *
 * @param deps Page-driver accessor, media pipeline, lease coordinator and tunables.
 * @returns A ready-to-use three-layer page perceiver.
 *
 * @example
 * ```ts
 * const perception = createPagePerception({
 *   getWebContents: (id) => browserViewManager.getWebContents(id),
 *   mediaPipeline,
 *   coordinator: resourceCoordinator,
 * });
 * const text = await perception.readText(tabId);          // layer (a), no lease
 * const shot = await perception.capture(tabId);           // layer (b), 'browser' lease
 * ```
 */
export const createPagePerception = (deps: PagePerceptionDeps): IPagePerception => {
  const { getWebContents, mediaPipeline, coordinator } = deps;
  const captureCostMB = deps.captureCostMB ?? DEFAULT_CAPTURE_COST_MB;
  const captureLeaseKind = deps.captureLeaseKind ?? DEFAULT_CAPTURE_LEASE_KIND;
  const accessibilityMaxDepth = deps.accessibilityMaxDepth ?? DEFAULT_ACCESSIBILITY_MAX_DEPTH;
  const redactionRegistry = deps.redactionRegistry ?? sharedSecretRedactionRegistry;

  /** Resolve a live {@link PageDriver} or throw a descriptive error. */
  const requireDriver = (tabId: BrowserTabId): PageDriver => {
    const driver = getWebContents(tabId);
    if (!driver) {
      throw new Error(`[PagePerception] No web contents for tab: ${tabId}`);
    }
    return driver;
  };

  const resolveRedactionContext = (tabId: BrowserTabId, driver: PageDriver): PageRedactionContext => {
    const expectedHostname = exactHostnameFromDriver(driver);
    return {
      ...(expectedHostname ? { expectedHostname } : {}),
      snapshot: expectedHostname
        ? redactionRegistry.snapshot(tabId, expectedHostname)
        : { selectors: [], sensitiveMode: false },
    };
  };

  const scanPage = async (
    driver: PageDriver,
    context: PageRedactionContext,
    mode: 'viewport' | 'fullPage'
  ): Promise<PageRedactionScan> =>
    parseRedactionScan(await evaluateTrusted(driver, buildScreenshotScanScript(context, mode)));

  const protectCapture = async (
    tabId: BrowserTabId,
    mode: 'viewport' | 'fullPage',
    captureImage: () => Promise<Uint8Array>
  ): Promise<CaptureResult> => {
    const driver = requireDriver(tabId);
    const context = resolveRedactionContext(tabId, driver);
    const before = await scanPage(driver, context, mode);
    const png = await captureImage();
    const after = await scanPage(driver, context, mode);
    return protectPng(png, mode, before, after, context);
  };

  const readText = async (tabId: BrowserTabId, selector?: string): Promise<string> => {
    // Layer (a): light DOM read — no lease required (criterion 1.4a).
    const driver = requireDriver(tabId);
    const context = resolveRedactionContext(tabId, driver);
    const result = assertSafeScriptResult(await evaluateTrusted(driver, buildReadTextScript(selector, context)));
    return redactAgentVisibleText(typeof result.text === 'string' ? result.text : '', context.snapshot.sensitiveMode);
  };

  const readAccessibilityTree = async (tabId: BrowserTabId): Promise<AccessibilityNode> => {
    // Layer (a): light DOM read — no lease required (criterion 1.4a).
    const driver = requireDriver(tabId);
    const context = resolveRedactionContext(tabId, driver);
    const result = await evaluateTrusted(driver, buildAccessibilityScript(accessibilityMaxDepth, context));
    assertSafeScriptResult(result);
    return sanitizeAccessibilityNode(result, context.snapshot.sensitiveMode);
  };

  const capture = async (tabId: BrowserTabId): Promise<CaptureResult> => {
    // Layer (b): heavy vision capture — resolve the tab first (cheap, avoids
    // wasting a lease on an impossible request), then gate the capture behind a
    // 'browser' lease that is ALWAYS released in finally (criteria 1.4b, 1.9).
    const driver = requireDriver(tabId);
    const lease = await coordinator.requestLease({ kind: captureLeaseKind, estCostMB: captureCostMB });
    try {
      return await protectCapture(tabId, 'viewport', async () => {
        const image = await driver.capturePage();
        if (image.isEmpty()) {
          throw new Error(`[PagePerception] Captured an empty image for tab: ${tabId}`);
        }
        return image.toPNG();
      });
    } finally {
      coordinator.releaseLease(lease.id);
    }
  };

  const perceiveMedia = async (request: MediaPerceptionRequest): Promise<MediaPerceptionResult> => {
    // Layer (c): delegate to the media pipeline, which owns its own heavy-step
    // leases (criterion 1.9), so no lease is acquired here.
    switch (request.action) {
      case 'summarize': {
        if (!mediaPipeline) throw new Error('[PagePerception] Media pipeline is unavailable.');
        const summary = await mediaPipeline.summarizeVideo(request.source, request.options);
        return { action: 'summarize', summary };
      }
      case 'transcribe': {
        if (!mediaPipeline) throw new Error('[PagePerception] Media pipeline is unavailable.');
        const transcript = await mediaPipeline.transcribe(request.source, request.options);
        return { action: 'transcribe', transcript };
      }
    }
  };

  return { readText, readAccessibilityTree, capture, protectCapture, perceiveMedia };
};
