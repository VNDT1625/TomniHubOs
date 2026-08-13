/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuDiagnostic, ViuNode, ViuProjectState } from '../types';

type Rgb = { r: number; g: number; b: number };

const INTERACTIVE_ROLES = new Set<ViuNode['semantics']['role']>(['button', 'link', 'form']);

const parseChannel = (value: string): number | undefined => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 255 ? parsed : undefined;
};

const parseCssColor = (value: string | undefined): Rgb | undefined => {
  if (!value) return undefined;
  const source = value.trim().toLowerCase();
  const shortHex = source.match(/^#([0-9a-f]{3})$/u)?.[1];
  if (shortHex) {
    return {
      r: Number.parseInt(`${shortHex[0]}${shortHex[0]}`, 16),
      g: Number.parseInt(`${shortHex[1]}${shortHex[1]}`, 16),
      b: Number.parseInt(`${shortHex[2]}${shortHex[2]}`, 16),
    };
  }
  const hex = source.match(/^#([0-9a-f]{6})$/u)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  const rgb = source.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/u);
  if (!rgb) return undefined;
  if (rgb[4] && rgb[4] !== '1' && rgb[4] !== '100%') return undefined;
  const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => parseChannel(channel ?? ''));
  return channels.every((channel): channel is number => channel !== undefined)
    ? { r: channels[0], g: channels[1], b: channels[2] }
    : undefined;
};

const luminance = ({ r, g, b }: Rgb): number =>
  [r, g, b]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

export const calculateViuContrastRatio = (foreground: string, background: string): number | undefined => {
  const foregroundRgb = parseCssColor(foreground);
  const backgroundRgb = parseCssColor(background);
  if (!foregroundRgb || !backgroundRgb) return undefined;
  const [light, dark] = [luminance(foregroundRgb), luminance(backgroundRgb)].toSorted((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
};

const nodeBackground = (node: ViuNode): string | undefined => {
  const solid = node.style.fills?.findLast((fill) => fill.visible && fill.type === 'solid');
  return solid?.type === 'solid' && solid.opacity === 1 ? solid.color : node.style.background;
};

const diagnostic = (
  code: ViuDiagnostic['code'],
  message: string,
  entityId: string,
  severity: ViuDiagnostic['severity'] = 'warning'
): ViuDiagnostic => ({ code, severity, message, entityId });

const screenNodeOrder = (state: ViuProjectState, rootNodeId: string): ViuNode[] => {
  const ordered: ViuNode[] = [];
  const visit = (nodeId: string): void => {
    const node = state.nodes[nodeId];
    if (!node) return;
    ordered.push(node);
    node.childIds.forEach(visit);
  };
  visit(rootNodeId);
  return ordered;
};

const auditNodeSemantics = (state: ViuProjectState, node: ViuNode): ViuDiagnostic[] => {
  const result: ViuDiagnostic[] = [];
  const interactions = Object.values(state.interactions).filter((interaction) => interaction.sourceNodeId === node.id);
  const interactive = node.type === 'control' || INTERACTIVE_ROLES.has(node.semantics.role) || interactions.length > 0;
  if (interactive && !node.semantics.label.trim()) {
    result.push(
      diagnostic('missing-interactive-label', `Interactive node ${node.id} needs an accessible label.`, node.id)
    );
  }
  if (
    (node.type === 'image' || node.semantics.role === 'image') &&
    node.semantics.role !== 'none' &&
    !node.semantics.label.trim()
  ) {
    result.push(diagnostic('missing-image-label', `Image node ${node.id} needs meaningful alternative text.`, node.id));
  }
  if (node.semantics.role === 'heading') {
    if (!node.semantics.headingLevel) {
      result.push(diagnostic('missing-heading-level', `Heading node ${node.id} needs a level from 1 to 6.`, node.id));
    }
    if (!node.content?.text?.trim()) {
      result.push(diagnostic('empty-heading', `Heading node ${node.id} has no text content.`, node.id));
    }
  }
  for (const interaction of interactions) {
    if (
      (interaction.trigger === 'click' || interaction.trigger === 'hover') &&
      !INTERACTIVE_ROLES.has(node.semantics.role) &&
      node.type !== 'control'
    ) {
      result.push(
        diagnostic(
          'keyboard-inaccessible-interaction',
          `Interaction ${interaction.id} is attached to ${node.id}, which is not keyboard-focusable.`,
          node.id
        )
      );
    }
    if (interaction.trigger === 'hover') {
      result.push(
        diagnostic('hover-only-interaction', `Interaction ${interaction.id} needs a non-hover alternative.`, node.id)
      );
    }
  }
  const foreground = node.style.color;
  const background = nodeBackground(node);
  if (node.content?.text?.trim() && foreground && background) {
    const ratio = calculateViuContrastRatio(foreground, background);
    const largeText =
      (node.style.fontSize ?? 0) >= 24 ||
      ((node.style.fontSize ?? 0) >= 18.66 && (node.style.fontWeight ?? 400) >= 700);
    const minimum = largeText ? 3 : 4.5;
    if (ratio !== undefined && ratio < minimum) {
      result.push(
        diagnostic(
          'low-text-contrast',
          `Text node ${node.id} has contrast ${ratio.toFixed(2)}:1; expected at least ${minimum}:1.`,
          node.id
        )
      );
    }
  }
  return result;
};

const auditOverflow = (state: ViuProjectState, parent: ViuNode): ViuDiagnostic[] => {
  if (parent.style.overflow === 'scroll') return [];
  const overflowChild = parent.childIds
    .map((childId) => state.nodes[childId])
    .find((child) => {
      if (!child || !child.visible || child.positionMode !== 'absolute') return false;
      const x = child.localTransform[4];
      const y = child.localTransform[5];
      return x < 0 || y < 0 || x + child.size.width > parent.size.width || y + child.size.height > parent.size.height;
    });
  if (!overflowChild) return [];
  const clipped = parent.style.overflow === 'hidden';
  return [
    diagnostic(
      clipped ? 'clipped-content' : 'content-overflow',
      `Child ${overflowChild.id} extends beyond ${parent.id}${clipped ? ' and will be clipped' : ''}.`,
      parent.id
    ),
  ];
};

/** Produces non-destructive accessibility and visual-quality diagnostics for user and agent review. */
export const auditViuProjectQuality = (state: ViuProjectState): ViuDiagnostic[] => {
  const diagnostics = Object.values(state.nodes).flatMap((node) => [
    ...auditNodeSemantics(state, node),
    ...auditOverflow(state, node),
  ]);
  for (const screen of Object.values(state.screens)) {
    let lastLevel = 0;
    for (const node of screenNodeOrder(state, screen.rootNodeId)) {
      const level = node.semantics.role === 'heading' ? node.semantics.headingLevel : undefined;
      if (!level) continue;
      if (lastLevel > 0 && level > lastLevel + 1) {
        diagnostics.push(
          diagnostic(
            'skipped-heading-level',
            `Heading ${node.id} skips from level ${lastLevel} to level ${level} on screen ${screen.id}.`,
            node.id
          )
        );
      }
      lastLevel = level;
    }
  }
  return diagnostics;
};
