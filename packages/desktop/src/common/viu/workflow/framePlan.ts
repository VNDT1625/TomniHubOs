/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { applyViuTransaction } from '../commands';
import type { ViuCommand, ViuId, ViuProjectState } from '../types';
import { validateViuProject } from '../validation';
import type {
  CreateViuFramePlanInput,
  ViuFrameAssignment,
  ViuFrameContribution,
  ViuFrameContributionReport,
  ViuFrameMergeIssue,
  ViuFrameMergeResult,
  ViuFramePlan,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

/** Stable Team lease path used by both the IDE Team coordinator and VIU. */
export const viuFrameLeaseKey = (projectId: ViuId, screenId: ViuId): string =>
  `viu/${encodeURIComponent(projectId)}/screens/${encodeURIComponent(screenId)}.frame`;

const assertNonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} is required.`);
};

/** Creates a non-overlapping one-agent-per-frame plan at the current project revision. */
export function createViuFramePlan(state: ViuProjectState, input: CreateViuFramePlanInput): ViuFramePlan {
  assertNonEmpty(input.planId, 'Plan id');
  assertNonEmpty(input.createdBy, 'Plan creator');
  if (!Number.isFinite(input.createdAt)) throw new Error('Plan creation time must be finite.');
  if (input.assignments.length === 0) throw new Error('A frame plan requires at least one assignment.');

  const assignmentIds = new Set<string>();
  const agentIds = new Set<string>();
  const screenIds = new Set<string>();
  const leaseKeys = new Set<string>();
  const assignments: ViuFrameAssignment[] = input.assignments.map((assignment) => {
    const screen = state.screens[assignment.screenId];
    if (!screen) throw new Error(`Screen ${assignment.screenId} does not exist.`);
    if (assignmentIds.has(assignment.assignmentId)) {
      throw new Error(`Assignment ${assignment.assignmentId} appears more than once.`);
    }
    if (agentIds.has(assignment.agentId))
      throw new Error(`Agent ${assignment.agentId} is assigned to more than one frame.`);
    if (screenIds.has(assignment.screenId))
      throw new Error(`Screen ${assignment.screenId} has more than one assignee.`);
    if (leaseKeys.has(assignment.lease.leaseKey)) {
      throw new Error(`Lease ${assignment.lease.leaseKey} is assigned more than once.`);
    }
    if (assignment.lease.holderId !== assignment.agentId) {
      throw new Error(`Lease ${assignment.lease.leaseKey} is not held by agent ${assignment.agentId}.`);
    }
    if (assignment.lease.leaseKey !== viuFrameLeaseKey(state.projectId, screen.id)) {
      throw new Error(`Lease ${assignment.lease.leaseKey} does not identify screen ${screen.id}.`);
    }
    if (assignment.lease.expiresAt <= assignment.lease.acquiredAt) {
      throw new Error(`Lease ${assignment.lease.leaseKey} has an invalid lifetime.`);
    }
    assignmentIds.add(assignment.assignmentId);
    agentIds.add(assignment.agentId);
    screenIds.add(screen.id);
    leaseKeys.add(assignment.lease.leaseKey);
    return {
      ...clone(assignment),
      rootNodeId: screen.rootNodeId,
      baseRevision: state.revision,
    };
  });

  return {
    planId: input.planId,
    projectId: state.projectId,
    baseRevision: state.revision,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    assignments,
  };
}

type ScopeIndex = {
  nodeScreens: Map<ViuId, ViuId>;
  componentRoots: Map<ViuId, ViuId>;
  componentSetMembers: Map<ViuId, ViuId[]>;
  interactionSources: Map<ViuId, ViuId>;
};

const createScopeIndex = (state: ViuProjectState): ScopeIndex => {
  const nodeScreens = new Map<ViuId, ViuId>();
  for (const screen of Object.values(state.screens)) {
    const pending = [screen.rootNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || nodeScreens.has(nodeId)) continue;
      nodeScreens.set(nodeId, screen.id);
      pending.push(...(state.nodes[nodeId]?.childIds ?? []));
    }
  }
  return {
    nodeScreens,
    componentRoots: new Map(Object.values(state.components).map((component) => [component.id, component.rootNodeId])),
    componentSetMembers: new Map(Object.values(state.componentSets).map((set) => [set.id, [...set.componentIds]])),
    interactionSources: new Map(
      Object.values(state.interactions).map((interaction) => [interaction.id, interaction.sourceNodeId])
    ),
  };
};

const scopedNode = (index: ScopeIndex, nodeId: ViuId, screenId: ViuId): boolean =>
  index.nodeScreens.get(nodeId) === screenId;

const scopedComponent = (index: ScopeIndex, componentId: ViuId, screenId: ViuId): boolean => {
  const rootNodeId = index.componentRoots.get(componentId);
  return Boolean(rootNodeId && scopedNode(index, rootNodeId, screenId));
};

const scopedComponentSet = (index: ScopeIndex, componentIds: ViuId[], screenId: ViuId): boolean =>
  componentIds.length > 0 && componentIds.every((componentId) => scopedComponent(index, componentId, screenId));

const commandScopeViolation = (index: ScopeIndex, command: ViuCommand, screenId: ViuId): string | undefined => {
  switch (command.type) {
    case 'insertNode': {
      if (!command.parentId || !scopedNode(index, command.parentId, screenId)) {
        return `Inserted node ${command.node.id} is outside screen ${screenId}.`;
      }
      index.nodeScreens.set(command.node.id, screenId);
      return undefined;
    }
    case 'updateNode':
    case 'deleteNode':
    case 'reorderNode':
      return scopedNode(index, command.nodeId, screenId)
        ? undefined
        : `Node ${command.nodeId} is outside screen ${screenId}.`;
    case 'reparentNode':
      return scopedNode(index, command.nodeId, screenId) &&
        Boolean(command.parentId && scopedNode(index, command.parentId, screenId))
        ? undefined
        : `Reparenting node ${command.nodeId} crosses the assigned screen boundary.`;
    case 'createComponent':
      if (!scopedNode(index, command.component.rootNodeId, screenId)) {
        return `Component ${command.component.id} is outside screen ${screenId}.`;
      }
      index.componentRoots.set(command.component.id, command.component.rootNodeId);
      return undefined;
    case 'updateComponent':
      return scopedComponent(index, command.componentId, screenId)
        ? undefined
        : `Component ${command.componentId} is outside screen ${screenId}.`;
    case 'deleteComponent':
      if (!scopedComponent(index, command.componentId, screenId)) {
        return `Component ${command.componentId} is outside screen ${screenId}.`;
      }
      index.componentRoots.delete(command.componentId);
      return undefined;
    case 'createComponentSet':
      if (!scopedComponentSet(index, command.componentSet.componentIds, screenId)) {
        return `Component set ${command.componentSet.id} crosses the assigned screen boundary.`;
      }
      index.componentSetMembers.set(command.componentSet.id, [...command.componentSet.componentIds]);
      return undefined;
    case 'updateComponentSet': {
      const componentIds = command.patch.componentIds ?? index.componentSetMembers.get(command.componentSetId) ?? [];
      if (!scopedComponentSet(index, componentIds, screenId)) {
        return `Component set ${command.componentSetId} crosses the assigned screen boundary.`;
      }
      index.componentSetMembers.set(command.componentSetId, [...componentIds]);
      return undefined;
    }
    case 'deleteComponentSet': {
      const componentIds = index.componentSetMembers.get(command.componentSetId) ?? [];
      if (!scopedComponentSet(index, componentIds, screenId)) {
        return `Component set ${command.componentSetId} is outside screen ${screenId}.`;
      }
      index.componentSetMembers.delete(command.componentSetId);
      return undefined;
    }
    case 'connectInteraction':
      if (!scopedNode(index, command.interaction.sourceNodeId, screenId)) {
        return `Interaction ${command.interaction.id} has a source outside screen ${screenId}.`;
      }
      index.interactionSources.set(command.interaction.id, command.interaction.sourceNodeId);
      return undefined;
    case 'disconnectInteraction': {
      const sourceNodeId = index.interactionSources.get(command.interactionId);
      if (!sourceNodeId || !scopedNode(index, sourceNodeId, screenId)) {
        return `Interaction ${command.interactionId} has a source outside screen ${screenId}.`;
      }
      index.interactionSources.delete(command.interactionId);
      return undefined;
    }
    default:
      return `Command ${(command as { type: string }).type} is not allowed in a frame-scoped contribution.`;
  }
};

const validateContributionScope = (
  state: ViuProjectState,
  assignment: ViuFrameAssignment,
  contribution: ViuFrameContribution,
  now: number
): ViuFrameMergeIssue[] => {
  const issues: ViuFrameMergeIssue[] = [];
  const transaction = contribution.transaction;
  const add = (code: ViuFrameMergeIssue['code'], message: string): void => {
    issues.push({
      code,
      severity: 'error',
      message,
      assignmentId: assignment.assignmentId,
      transactionId: transaction.transactionId,
    });
  };
  if (contribution.leaseKey !== assignment.lease.leaseKey)
    add('lease-mismatch', 'Contribution uses a different lease.');
  if (assignment.lease.holderId !== assignment.agentId || transaction.actor.id !== assignment.agentId) {
    add('lease-mismatch', 'Contribution actor does not hold the assigned frame lease.');
  }
  if (transaction.actor.kind !== 'agent') add('lease-mismatch', 'Frame contributions must be authored by an agent.');
  if (now >= assignment.lease.expiresAt) add('lease-expired', 'The assigned frame lease has expired.');
  if (transaction.documentId !== state.projectId || transaction.baseRevision !== assignment.baseRevision) {
    add('invalid-plan', 'Contribution was not produced from the assigned project revision.');
  }
  const index = createScopeIndex(state);
  for (const command of transaction.commands) {
    const violation = commandScopeViolation(index, command, assignment.screenId);
    if (violation) add('scope-violation', violation);
  }
  return issues;
};

const invalidPlanResult = (state: ViuProjectState, message: string): ViuFrameMergeResult => {
  const issue: ViuFrameMergeIssue = { code: 'invalid-plan', severity: 'error', message };
  return {
    accepted: false,
    complete: false,
    state,
    revision: state.revision,
    reports: [],
    diagnostics: validateViuProject(state),
    issues: [issue],
  };
};

/**
 * Merges parallel frame contributions through the canonical VIU transaction engine.
 * Contributions share the plan base revision, are safely rebased only after scope checks,
 * and the whole batch rolls back when any contribution fails.
 */
export function mergeViuFrameContributions(
  state: ViuProjectState,
  plan: ViuFramePlan,
  contributions: ViuFrameContribution[],
  now = Date.now()
): ViuFrameMergeResult {
  if (plan.projectId !== state.projectId) return invalidPlanResult(state, 'Frame plan belongs to another project.');
  if (plan.baseRevision !== state.revision)
    return invalidPlanResult(state, 'Frame plan is stale and must be regenerated.');
  if (!Number.isFinite(now)) return invalidPlanResult(state, 'Merge time must be finite.');

  const assignments = new Map(plan.assignments.map((assignment) => [assignment.assignmentId, assignment]));
  const byAssignment = new Map<ViuId, ViuFrameContribution[]>();
  for (const contribution of contributions) {
    const bucket = byAssignment.get(contribution.assignmentId) ?? [];
    bucket.push(contribution);
    byAssignment.set(contribution.assignmentId, bucket);
  }

  let working = clone(state);
  const reports: ViuFrameContributionReport[] = [];
  const issues: ViuFrameMergeIssue[] = [];
  const transactionIds = new Set<ViuId>();

  for (const contribution of contributions) {
    if (assignments.has(contribution.assignmentId)) continue;
    const issue: ViuFrameMergeIssue = {
      code: 'invalid-plan',
      severity: 'error',
      message: `Contribution references unknown assignment ${contribution.assignmentId}.`,
      assignmentId: contribution.assignmentId,
      transactionId: contribution.transaction.transactionId,
    };
    issues.push(issue);
    reports.push({
      assignmentId: contribution.assignmentId,
      transactionId: contribution.transaction.transactionId,
      accepted: false,
      changedNodeIds: [],
      issues: [issue],
    });
  }

  for (const assignment of plan.assignments) {
    const bucket = byAssignment.get(assignment.assignmentId) ?? [];
    if (bucket.length === 0) {
      const issue: ViuFrameMergeIssue = {
        code: 'missing-contribution',
        severity: 'warning',
        message: `Assignment ${assignment.assignmentId} has not submitted a contribution.`,
        assignmentId: assignment.assignmentId,
      };
      issues.push(issue);
      reports.push({ assignmentId: assignment.assignmentId, accepted: false, changedNodeIds: [], issues: [issue] });
      continue;
    }
    if (bucket.length > 1) {
      const issue: ViuFrameMergeIssue = {
        code: 'duplicate-contribution',
        severity: 'error',
        message: `Assignment ${assignment.assignmentId} submitted more than one contribution.`,
        assignmentId: assignment.assignmentId,
      };
      issues.push(issue);
      reports.push({ assignmentId: assignment.assignmentId, accepted: false, changedNodeIds: [], issues: [issue] });
      continue;
    }

    const contribution = bucket[0]!;
    const transactionId = contribution.transaction.transactionId;
    const localIssues = validateContributionScope(state, assignment, contribution, now);
    if (transactionIds.has(transactionId)) {
      localIssues.push({
        code: 'duplicate-contribution',
        severity: 'error',
        message: `Transaction ${transactionId} appears more than once.`,
        assignmentId: assignment.assignmentId,
        transactionId,
      });
    }
    transactionIds.add(transactionId);
    if (localIssues.length > 0) {
      issues.push(...localIssues);
      reports.push({
        assignmentId: assignment.assignmentId,
        transactionId,
        accepted: false,
        changedNodeIds: [],
        issues: localIssues,
      });
      continue;
    }

    const result = applyViuTransaction(working, {
      ...clone(contribution.transaction),
      baseRevision: working.revision,
      mode: 'commit',
    });
    if (!result.accepted) {
      const issue: ViuFrameMergeIssue = {
        code: 'transaction-conflict',
        severity: 'error',
        message: result.conflict?.message ?? `Transaction ${transactionId} was rejected.`,
        assignmentId: assignment.assignmentId,
        transactionId,
        conflict: result.conflict,
      };
      issues.push(issue);
      reports.push({
        assignmentId: assignment.assignmentId,
        transactionId,
        accepted: false,
        changedNodeIds: [],
        issues: [issue],
      });
      continue;
    }
    working = result.state;
    reports.push({
      assignmentId: assignment.assignmentId,
      transactionId,
      accepted: true,
      changedNodeIds: result.changedNodeIds,
      issues: [],
    });
  }

  const diagnostics = validateViuProject(working);
  for (const diagnostic of diagnostics) {
    const issue: ViuFrameMergeIssue = {
      code: 'site-diagnostic',
      severity: diagnostic.severity,
      message: diagnostic.message,
      diagnostic,
    };
    issues.push(issue);
  }
  const accepted = !issues.some((issue) => issue.severity === 'error');
  const complete = plan.assignments.every(
    (assignment) => reports.find((report) => report.assignmentId === assignment.assignmentId)?.accepted === true
  );

  return {
    accepted,
    complete,
    state: accepted ? working : state,
    revision: accepted ? working.revision : state.revision,
    reports,
    diagnostics: accepted ? diagnostics : validateViuProject(state),
    issues,
  };
}
