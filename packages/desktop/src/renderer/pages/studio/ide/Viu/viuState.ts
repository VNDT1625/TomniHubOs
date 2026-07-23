/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuDocument, ViuNode, ViuProject } from './viuClient';

let sessionProject: ViuProject | null = null;

export const getSessionViuProject = (): ViuProject | null => sessionProject;

export const setSessionViuProject = (project: ViuProject | null): void => {
  sessionProject = project;
};

export const activeViuDocument = (project: ViuProject | null): ViuDocument | null => {
  if (!project) return null;
  return project.documents.find((document) => document.id === project.activeDocumentId) ?? project.documents[0] ?? null;
};

export const updateViuNode = (
  project: ViuProject,
  documentId: string,
  nodeId: string,
  patch: Partial<ViuNode>
): ViuProject => ({
  ...project,
  documents: project.documents.map((document) =>
    document.id === documentId
      ? {
          ...document,
          nodes: document.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
        }
      : document
  ),
  updatedAt: new Date().toISOString(),
});

export const setActiveViuDocument = (project: ViuProject, documentId: string): ViuProject =>
  project.documents.some((document) => document.id === documentId)
    ? { ...project, activeDocumentId: documentId, updatedAt: new Date().toISOString() }
    : project;

export const visualEvidenceSummary = (project: ViuProject): string => {
  const document = activeViuDocument(project);
  if (!document) return 'No Viu document is available.';
  const strategies = document.nodes.reduce<Record<string, number>>((counts, node) => {
    const key = node.fidelity.strategy;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const runtimes = document.nodes.filter((node) => node.kind === 'runtime').length;
  const lowConfidence = document.nodes.filter((node) => node.fidelity.confidence < 0.6).length;
  return [
    `Source: ${project.sourceKind}${project.referencePath ? ` (${project.referencePath})` : ''}`,
    `Document: ${document.title}; viewport ${document.viewport.width}x${document.viewport.height}; page ${Math.round(document.page.width)}x${Math.round(document.page.height)}.`,
    `Layers: ${document.nodes.length}; strategies ${JSON.stringify(strategies)}; runtime boundaries ${runtimes}; low-confidence layers ${lowConfidence}.`,
    `Tokens: colors ${document.tokens.colors.slice(0, 12).join(', ') || 'unknown'}; fonts ${document.tokens.fontFamilies.join(', ') || 'unknown'}.`,
    `Interactions: ${document.interactions.length}; motion bindings: ${document.motion.length}.`,
    ...document.limitations.slice(0, 6).map((limitation) => `Limitation: ${limitation}`),
  ].join('\n');
};

export const deterministicPromptUpgrade = (project: ViuProject, mode: ViuProject['improveMode']): string => {
  const framing = {
    faithful:
      'Prioritize measured fidelity to the reference. Preserve geometry, z-order, typography, assets, states and runtime boundaries before making stylistic changes.',
    professional:
      'Refine hierarchy, consistency, accessibility and responsive behavior while preserving the approved information architecture and primary visual identity.',
    creative:
      'Explore a more distinctive art direction and spatial composition while retaining the approved goals, content, interaction paths and measurable acceptance criteria.',
  }[mode];
  return [project.prompt.trim(), '', framing, '', 'Visual evidence:', visualEvidenceSummary(project)].join('\n');
};
