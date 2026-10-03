/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { IBrowserViewManager } from '@process/browser/browserViewManager';
import type {
  ViuCaptureRequest,
  ViuDocument,
  ViuNode,
  ViuProject,
  ViuRect,
} from '@package-apps/design/process/viu/types';

const MAX_CAPTURE_PAGES = 5;
const MAX_CAPTURE_NODES = 1800;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

type RawCaptureNode = {
  id: string;
  parentId: string | null;
  tag: string;
  text: string;
  rect: ViuRect;
  selector: string;
  styles: Record<string, string>;
  attributes: Record<string, string>;
};

type RawCapturePayload = {
  title: string;
  url: string;
  pageWidth: number;
  pageHeight: number;
  bodyBackground: string;
  nodes: RawCaptureNode[];
  links: string[];
};

const CAPTURE_SCRIPT = `(() => {
  const MAX_NODES = ${MAX_CAPTURE_NODES};
  const styleNames = [
    'background-color','background-image','background-position','background-repeat','background-size',
    'border-color','border-radius','border-width','box-shadow','clip-path','color','filter','font-family',
    'font-size','font-weight','line-height','mix-blend-mode','opacity','object-fit','overflow','position','transform','z-index'
  ];
  const elements = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      elements.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
      if (elements.length >= MAX_NODES * 3) return;
    }
  };
  visit(document.body);
  const visible = elements.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0.5 && rect.height > 0.5;
  }).slice(0, MAX_NODES);
  const ids = new Map(visible.map((element, index) => [element, 'node-' + String(index + 1)]));
  const selectorFor = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let cursor = element;
    while (cursor && cursor !== document.body && parts.length < 6) {
      let part = cursor.tagName.toLowerCase();
      const parent = cursor.parentElement;
      if (parent) {
        const peers = Array.from(parent.children).filter((item) => item.tagName === cursor.tagName);
        if (peers.length > 1) part += ':nth-of-type(' + String(peers.indexOf(cursor) + 1) + ')';
      }
      parts.unshift(part);
      cursor = parent;
    }
    return 'body > ' + parts.join(' > ');
  };
  const safeUrl = (value) => {
    try {
      const parsed = new URL(value, location.href);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      return parsed.href.slice(0, 4096);
    } catch { return ''; }
  };
  const nodes = visible.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const styles = {};
    for (const name of styleNames) {
      const value = style.getPropertyValue(name);
      styles[name] = value && !value.includes('data:') ? value.slice(0, 1024) : '';
    }
    let parent = element.parentElement;
    while (parent && !ids.has(parent)) parent = parent.parentElement;
    const attributes = {};
    for (const name of ['alt','aria-label','role','href','src','type']) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      attributes[name] = ['href','src'].includes(name) ? safeUrl(value) : value.slice(0, 512);
    }
    const text = Array.from(element.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent || '')
      .join(' ')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 1000);
    return {
      id: ids.get(element),
      parentId: parent ? ids.get(parent) : null,
      tag: element.tagName.toLowerCase(),
      text,
      rect: { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height },
      selector: selectorFor(element),
      styles,
      attributes,
    };
  });
  const root = document.documentElement;
  const origin = location.origin;
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((anchor) => safeUrl(anchor.href))
    .filter((url) => url && new URL(url).origin === origin);
  return {
    title: document.title || location.hostname,
    url: safeUrl(location.href),
    pageWidth: Math.max(innerWidth, root.scrollWidth, document.body?.scrollWidth || 0),
    pageHeight: Math.max(innerHeight, root.scrollHeight, document.body?.scrollHeight || 0),
    bodyBackground: getComputedStyle(document.body).backgroundColor || '#ffffff',
    nodes,
    links: [...new Set(links)].slice(0, 80),
  };
})()`;

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

const validateUrl = (rawUrl: string): URL => {
  if (rawUrl.length > 4096) throw new Error('The Viu URL is too long.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const url = new URL(withScheme);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Viu Clone supports only HTTP and HTTPS URLs.');
  if (url.username || url.password) throw new Error('Viu Clone does not accept credentials embedded in a URL.');
  url.hash = '';
  return url;
};

const canonicalUrl = (rawUrl: string): string => {
  const value = validateUrl(rawUrl);
  value.hash = '';
  return value.href;
};

const parsePixels = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseZIndex = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? Math.max(-128, Math.min(100_000, parsed)) : 0;
};

const nodeKind = (raw: RawCaptureNode): ViuNode['kind'] => {
  if (raw.tag === 'canvas') return 'runtime';
  if (raw.tag === 'img' || raw.tag === 'video' || raw.tag === 'iframe') return 'image';
  if (['button', 'input', 'select'].includes(raw.tag) || raw.attributes.role === 'button') return 'button';
  if (raw.text) return 'text';
  if (['svg', 'path'].includes(raw.tag)) return 'shape';
  return 'frame';
};

const mapNode = (raw: RawCaptureNode, sourceUrl: string): ViuNode => {
  const kind = nodeKind(raw);
  const runtime =
    kind === 'runtime'
      ? {
          kind: 'unknown' as const,
          width: Math.max(1, Math.round(raw.rect.width)),
          height: Math.max(1, Math.round(raw.rect.height)),
        }
      : undefined;
  const strategy =
    kind === 'runtime' ? 'runtime' : raw.tag === 'iframe' ? 'raster' : raw.tag === 'video' ? 'preserved' : 'native';
  const confidence =
    strategy === 'native' ? 0.98 : strategy === 'runtime' ? 0.78 : strategy === 'preserved' ? 0.86 : 0.7;
  const asset =
    ['img', 'video', 'iframe'].includes(raw.tag) && raw.attributes.src
      ? {
          kind: raw.tag === 'img' ? ('image' as const) : raw.tag === 'video' ? ('video' as const) : ('iframe' as const),
          url: raw.attributes.src,
          alt: raw.attributes.alt || raw.attributes['aria-label'] || '',
        }
      : undefined;
  return {
    id: raw.id,
    parentId: raw.parentId,
    name: raw.attributes['aria-label'] || raw.text.slice(0, 42) || `${raw.tag} ${raw.id}`,
    kind,
    rect: raw.rect,
    zIndex: parseZIndex(raw.styles['z-index']),
    content: raw.text,
    visible: true,
    locked: false,
    style: {
      fill: raw.styles['background-color'] || undefined,
      backgroundImage:
        raw.styles['background-image'] && raw.styles['background-image'] !== 'none'
          ? raw.styles['background-image']
          : undefined,
      backgroundPosition: raw.styles['background-position'] || undefined,
      backgroundSize: raw.styles['background-size'] || undefined,
      backgroundRepeat: raw.styles['background-repeat'] || undefined,
      color: raw.styles.color || undefined,
      fontFamily: raw.styles['font-family'] || undefined,
      fontSize: parsePixels(raw.styles['font-size']),
      fontWeight: parsePixels(raw.styles['font-weight']),
      lineHeight: parsePixels(raw.styles['line-height']),
      radius: parsePixels(raw.styles['border-radius']),
      opacity: boundedNumber(Number.parseFloat(raw.styles.opacity || '1'), 1, 0, 1),
      borderColor: raw.styles['border-color'] || undefined,
      borderWidth: parsePixels(raw.styles['border-width']),
      shadow: raw.styles['box-shadow'] || undefined,
      objectFit: ['cover', 'contain', 'fill'].includes(raw.styles['object-fit'])
        ? (raw.styles['object-fit'] as 'cover' | 'contain' | 'fill')
        : undefined,
      transform: raw.styles.transform && raw.styles.transform !== 'none' ? raw.styles.transform : undefined,
      filter: raw.styles.filter && raw.styles.filter !== 'none' ? raw.styles.filter : undefined,
      clipPath: raw.styles['clip-path'] && raw.styles['clip-path'] !== 'none' ? raw.styles['clip-path'] : undefined,
      mixBlendMode:
        raw.styles['mix-blend-mode'] && raw.styles['mix-blend-mode'] !== 'normal'
          ? raw.styles['mix-blend-mode']
          : undefined,
      overflow: ['visible', 'hidden', 'auto'].includes(raw.styles.overflow)
        ? (raw.styles.overflow as 'visible' | 'hidden' | 'auto')
        : undefined,
    },
    sourceTrace: { source: 'url', url: sourceUrl, selector: raw.selector, originalRect: raw.rect },
    fidelity: {
      strategy,
      confidence,
      editableDepth: strategy === 'native' ? 'full' : strategy === 'runtime' ? 'properties' : 'surface',
      notes: strategy === 'native' ? [] : [`${raw.tag} is retained as a ${strategy} boundary.`],
    },
    asset,
    runtime,
  };
};

const extractTokens = (nodes: ViuNode[]): ViuDocument['tokens'] => {
  const colors = new Set<string>();
  const fontFamilies = new Set<string>();
  const spacing = new Set<number>([4, 8, 12, 16, 24, 32, 48, 64]);
  const radii = new Set<number>([0, 4, 8, 12, 16, 24]);
  for (const item of nodes) {
    if (item.style.fill && item.style.fill !== 'rgba(0, 0, 0, 0)') colors.add(item.style.fill);
    if (item.style.color) colors.add(item.style.color);
    if (item.style.fontFamily) fontFamilies.add(item.style.fontFamily);
    if (item.style.radius !== undefined) radii.add(Math.round(item.style.radius));
    spacing.add(Math.max(0, Math.round(item.rect.x) % 64));
  }
  return {
    colors: [...colors].slice(0, 24),
    fontFamilies: [...fontFamilies].slice(0, 12),
    spacing: [...spacing]
      .filter((value) => value > 0)
      .toSorted((a, b) => a - b)
      .slice(0, 16),
    radii: [...radii].toSorted((a, b) => a - b).slice(0, 12),
  };
};

const isRawCapturePayload = (value: unknown): value is RawCapturePayload => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RawCapturePayload>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.pageWidth === 'number' &&
    typeof candidate.pageHeight === 'number' &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.links)
  );
};

const screenshotDataUrl = async (contents: Electron.WebContents): Promise<string> => {
  let image = await contents.capturePage();
  let png = image.toPNG();
  if (png.byteLength > MAX_SCREENSHOT_BYTES) {
    const size = image.getSize();
    const width = Math.min(1200, size.width);
    const height = Math.max(1, Math.round((size.height * width) / Math.max(1, size.width)));
    image = image.resize({ width, height, quality: 'good' });
    png = image.toPNG();
  }
  return `data:image/png;base64,${png.toString('base64')}`;
};

const captureOne = async (
  manager: IBrowserViewManager,
  tabId: string,
  url: string,
  viewport: { width: number; height: number },
  now: Date
): Promise<{ document: ViuDocument; links: string[]; preview: string }> => {
  await manager.loadURL(tabId, url);
  const contents = manager.getWebContents(tabId);
  if (!contents) throw new Error('The Viu capture tab is unavailable.');
  await contents.executeJavaScript(
    `(() => { const style = document.createElement('style'); style.dataset.viuCapture = '1'; style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(style); return document.fonts?.ready ?? true; })()`
  );
  await wait(120);
  const raw = (await contents.executeJavaScript(CAPTURE_SCRIPT)) as unknown;
  if (!isRawCapturePayload(raw)) throw new Error('The page did not return a valid Viu capture payload.');
  const pageWidth = boundedNumber(raw.pageWidth, viewport.width, 1, 7680);
  const pageHeight = boundedNumber(raw.pageHeight, viewport.height, 1, 12_000);
  manager.setBounds(tabId, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  await wait(80);
  const preview = await screenshotDataUrl(contents);
  const nodes = raw.nodes
    .filter((item) => item && typeof item.id === 'string' && item.rect && typeof item.rect.width === 'number')
    .map((item) => mapNode(item, raw.url || url));
  const id = `page-${randomUUID()}`;
  const document: ViuDocument = {
    schemaVersion: '1',
    id,
    title: raw.title.slice(0, 160),
    sourceKind: 'url',
    sourceLabel: raw.url || url,
    viewport,
    page: { width: pageWidth, height: pageHeight, background: raw.bodyBackground || '#ffffff' },
    nodes,
    tokens: extractTokens(nodes),
    interactions: [],
    motion: [],
    limitations: [
      'The capture represents one settled browser state per page.',
      'Cross-origin frames and protected runtime surfaces remain raster/runtime boundaries.',
    ],
    referencePreviewDataUrl: preview,
    createdAt: now.toISOString(),
  };
  return { document, links: raw.links, preview };
};

export const captureSiteProject = async (
  manager: IBrowserViewManager,
  request: ViuCaptureRequest,
  now = new Date()
): Promise<ViuProject> => {
  const entry = validateUrl(request.url);
  const maxPages = Math.max(1, Math.min(MAX_CAPTURE_PAGES, Math.round(request.maxPages ?? 3)));
  const viewport = {
    width: Math.round(boundedNumber(request.viewport?.width, 1440, 320, 1920)),
    height: Math.round(boundedNumber(request.viewport?.height, 900, 240, 1440)),
  };
  const tabId = manager.createTab({
    bounds: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    visible: false,
    background: true,
    partition: 'viu-capture',
  });
  const documents: ViuDocument[] = [];
  const queued = [entry.href];
  const visited = new Set<string>();
  let siteOrigin: string | null = null;
  let referencePreviewDataUrl: string | undefined;
  try {
    while (queued.length > 0 && documents.length < maxPages) {
      const next = queued.shift();
      if (!next) break;
      const canonical = canonicalUrl(next);
      if (visited.has(canonical)) continue;
      const parsed = new URL(canonical);
      if (siteOrigin && parsed.origin !== siteOrigin) continue;
      visited.add(canonical);
      // Captures share one isolated tab, so each navigation must settle before the next one starts.
      // eslint-disable-next-line no-await-in-loop
      const captured = await captureOne(manager, tabId, canonical, viewport, now);
      const finalUrl = validateUrl(captured.document.sourceLabel);
      siteOrigin ??= finalUrl.origin;
      if (finalUrl.origin !== siteOrigin) continue;
      documents.push(captured.document);
      referencePreviewDataUrl ??= captured.preview;
      for (const link of captured.links) {
        try {
          const candidate = canonicalUrl(link);
          if (new URL(candidate).origin === siteOrigin && !visited.has(candidate)) queued.push(candidate);
        } catch {
          // Invalid page links are ignored without aborting the rest of the site.
        }
      }
    }
  } finally {
    manager.destroyTab(tabId);
  }
  if (documents.length === 0) throw new Error('Viu could not capture a page from this URL.');
  const createdAt = now.toISOString();
  const projectId = `viu-clone-${randomUUID()}`;
  return {
    schemaVersion: '1',
    id: projectId,
    title: documents[0]?.title || entry.hostname,
    sourceKind: 'url',
    prompt: `Clone ${entry.href}`,
    improvedPrompt: `Reconstruct ${entry.href} from browser-observed geometry, computed styles, stacking order and runtime boundaries. Preserve uncertainty and validate each captured viewport.`,
    improveMode: 'faithful',
    documents,
    activeDocumentId: documents[0]?.id ?? '',
    referencePreviewDataUrl,
    createdAt,
    updatedAt: createdAt,
  };
};
