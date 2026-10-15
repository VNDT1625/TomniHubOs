/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real {@link ContextMenusPort}: a right click on a Browser tab shows the items extensions registered
 * (docs/platform/repotopackage-design.md section 12.3).
 *
 * The page's own `context-menu` event is observed, never replaced: when no extension has an item for the click, nothing
 * is shown and the tab behaves as before. What was clicked is read from Electron's `params`, not from the page. Labels
 * come from untrusted manifests and scripts, so they are stripped of control characters and bounded.
 */

import type {
  ContextKind,
  ContextMenuHost,
  ContextMenuRequest,
  ContextMenusPort,
  MenuNode,
} from '@process/integrations/browserExtensions/api/groups/browser/contextMenus';
import type { PortTab } from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import type { WatchedTab } from '@process/integrations/browserExtensions/wiring/browserTabsPort';

/** Electron's `context-menu` params, the fields used. */
export type ContextMenuParams = Readonly<{
  pageURL?: string;
  frameURL?: string;
  linkURL?: string;
  srcURL?: string;
  mediaType?: string;
  selectionText?: string;
  isEditable?: boolean;
}>;

export type MenuTemplateItem = {
  label?: string;
  type: 'normal' | 'checkbox' | 'radio' | 'separator' | 'submenu';
  checked?: boolean;
  enabled?: boolean;
  submenu?: MenuTemplateItem[];
  click?: () => void;
};

export type ContextMenusPortDeps = Readonly<{
  watch: (attach: (tab: WatchedTab) => (() => void) | void) => () => void;
  /** Shows a native menu for the template, at the place of the click. */
  popup: (contents: WatchedTab['contents'], template: MenuTemplateItem[]) => void;
  tab: (tabId: number) => PortTab | undefined;
  log?: (message: string, error?: unknown) => void;
}>;

const MAX_LABEL = 120;
const clean = (text: string): string => {
  const printable = [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127 && !(code >= 0x200b && code <= 0x200f) && !(code >= 0x202a && code <= 0x202e);
  });
  const joined = printable.join('').trim();
  return joined.length > MAX_LABEL ? `${joined.slice(0, MAX_LABEL - 1)}…` : joined;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' && value.length <= 4096 ? value : undefined;

export const requestFromParams = (tabId: number, params: ContextMenuParams): ContextMenuRequest | undefined => {
  const pageUrl = text(params.pageURL);
  if (pageUrl === undefined) return undefined;
  const media = params.mediaType === 'image' || params.mediaType === 'video' || params.mediaType === 'audio';
  const linkUrl = text(params.linkURL);
  const srcUrl = text(params.srcURL);
  const selectionText = text(params.selectionText);
  const frameUrl = text(params.frameURL);
  const contexts: ContextKind[] = [];
  if (linkUrl !== undefined) contexts.push('link');
  if (media) contexts.push(params.mediaType as 'image' | 'video' | 'audio');
  if (selectionText !== undefined) contexts.push('selection');
  if (params.isEditable === true) contexts.push('editable');
  if (contexts.length === 0) contexts.push('page');
  return {
    tabId,
    pageUrl,
    editable: params.isEditable === true,
    contexts,
    ...(frameUrl === undefined ? {} : { frameUrl }),
    ...(linkUrl === undefined ? {} : { linkUrl }),
    ...(srcUrl === undefined ? {} : { srcUrl }),
    ...(media ? { mediaType: params.mediaType as 'image' | 'video' | 'audio' } : {}),
    ...(selectionText === undefined ? {} : { selectionText }),
  };
};

const toTemplate = (nodes: readonly MenuNode[], choose: (itemId: string) => void): MenuTemplateItem[] =>
  nodes.map((node) => {
    if (node.type === 'separator') return { type: 'separator' };
    const label = clean(node.title);
    if (node.children.length > 0) {
      return { label, type: 'submenu', enabled: node.enabled, submenu: toTemplate(node.children, choose) };
    }
    return {
      label,
      type: node.type,
      enabled: node.enabled,
      ...(node.type === 'checkbox' || node.type === 'radio' ? { checked: node.checked } : {}),
      click: () => choose(node.itemId),
    };
  });

export const createContextMenusPort = (deps: ContextMenusPortDeps): ContextMenusPort => {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  return {
    tab: deps.tab,
    register: (host: ContextMenuHost) =>
      deps.watch((tab) => {
        const onMenu = (_event: unknown, params: ContextMenuParams): void => {
          try {
            const request = requestFromParams(tab.tabId, params ?? {});
            if (request === undefined) return;
            const template: MenuTemplateItem[] = [];
            for (const section of host.sectionsFor(request)) {
              if (template.length > 0) template.push({ type: 'separator' });
              const choose = (itemId: string) => host.select(section.extensionId, itemId, request);
              const [only] = section.items;
              if (section.items.length === 1 && only !== undefined && only.type !== 'separator') {
                template.push(...toTemplate([only], choose));
              } else {
                template.push({
                  label: clean(section.extensionName),
                  type: 'submenu',
                  submenu: toTemplate(section.items, choose),
                });
              }
            }
            if (template.length > 0) deps.popup(tab.contents, template);
          } catch (error) {
            log('Could not show the extension context menu.', error);
          }
        };
        tab.contents.on('context-menu', onMenu as (...args: never[]) => void);
        return () => {
          try {
            tab.contents.removeListener('context-menu', onMenu as (...args: never[]) => void);
          } catch {
            // The contents may be gone already.
          }
        };
      }),
  };
};
