/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompanyStructure, RoleNode } from '@process/company/companyOrchestrator';

/**
 * A company group chat: one role node that manages other roles. The node is the
 * group's leader and its direct reports are the members. Leaf roles have no
 * group; they are reached through a private 1-1 chat instead.
 */
export type CompanyGroup = {
  /** Id of the leader node (also the group id). */
  id: string;
  /** Display name of the group (the leader's name). */
  name: string;
  leader: RoleNode;
  members: RoleNode[];
};

/** Flatten the role tree depth-first. */
export const flattenRoles = (root: RoleNode): RoleNode[] => {
  const result: RoleNode[] = [];
  const walk = (node: RoleNode): void => {
    result.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return result;
};

/** Find a role anywhere in the structure. */
export const findRole = (structure: CompanyStructure, roleId: string): RoleNode | undefined =>
  flattenRoles(structure.root).find((node) => node.id === roleId);

/** The group led by `node`, or null when the node has no direct reports. */
export const groupOf = (node: RoleNode): CompanyGroup | null =>
  node.children.length === 0 ? null : { id: node.id, name: node.name, leader: node, members: node.children };

/** Every group in the company, root first. */
export const listGroups = (structure: CompanyStructure): CompanyGroup[] =>
  flattenRoles(structure.root).flatMap((node) => {
    const group = groupOf(node);
    return group ? [group] : [];
  });

/** Case/space/punctuation-insensitive form of a name, used for `@mention` matching. */
const normalizeName = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Resolve `@name` tags in `text` to roles. The name may be written with or
 * without spaces (`@Frontend Lead`, `@frontendlead`); the longest matching name
 * wins so `@Frontend Lead` does not also tag a role called `Frontend`.
 * Unknown tags are ignored and every role is returned at most once.
 */
export const parseMentions = (text: string, candidates: readonly RoleNode[]): RoleNode[] => {
  const byLength = [...candidates].toSorted((a, b) => normalizeName(b.name).length - normalizeName(a.name).length);
  const found = new Map<string, RoleNode>();
  const tagPattern = /@([\p{L}\p{N}][\p{L}\p{N} _.-]*)/gu;
  for (const match of text.matchAll(tagPattern)) {
    const tagged = normalizeName(match[1]);
    const role = byLength.find((candidate) => {
      const name = normalizeName(candidate.name);
      return name.length > 0 && tagged.startsWith(name);
    });
    if (role) found.set(role.id, role);
  }
  return [...found.values()];
};

/** Who answers a message: the group's leader and members, plus anyone tagged. */
export type GroupAudience = {
  /** The group's leader and members; Laya decides which of them need to read the message. */
  primary: RoleNode[];
  /** Group members tagged by name; they always read the message. */
  mentioned: RoleNode[];
  /** Tagged outside the group; they join for this message only. */
  guests: RoleNode[];
};

/**
 * Work out the audience for a user message in `group`. Guests are tagged roles
 * that are not part of the group; they receive the recent transcript so they can
 * read the conversation, but they are not added to the group.
 */
export const resolveAudience = (group: CompanyGroup, structure: CompanyStructure, text: string): GroupAudience => {
  const primary = [group.leader, ...group.members];
  const primaryIds = new Set(primary.map((node) => node.id));
  const tagged = parseMentions(text, flattenRoles(structure.root));
  return {
    primary,
    mentioned: tagged.filter((node) => primaryIds.has(node.id)),
    guests: tagged.filter((node) => !primaryIds.has(node.id)),
  };
};

/** Relevance (0..1) at or above which a group member is called to read a message. */
export const RELEVANCE_THRESHOLD = 0.6;

export type ReaderSelection = {
  /** Members that read the message. */
  called: RoleNode[];
  /** Members left idle, with the relevance that kept them out. */
  skipped: { role: RoleNode; score: number }[];
};

/**
 * Pick which group members read a message: anyone tagged, plus whoever scores at
 * least `threshold`. If nobody qualifies the leader reads it so a message is never
 * left unanswered. Skipped members keep their backlog and catch up when they are
 * next called, so they cost no tokens in between.
 */
export const selectReaders = (
  audience: GroupAudience,
  scores: ReadonlyMap<string, number>,
  leaderId: string,
  threshold: number = RELEVANCE_THRESHOLD
): ReaderSelection => {
  const tagged = new Set(audience.mentioned.map((node) => node.id));
  const wanted = new Set(
    audience.primary.filter((node) => tagged.has(node.id) || (scores.get(node.id) ?? 0) >= threshold).map((n) => n.id)
  );
  if (wanted.size === 0) wanted.add(leaderId);
  return {
    called: audience.primary.filter((node) => wanted.has(node.id)),
    skipped: audience.primary
      .filter((node) => !wanted.has(node.id))
      .map((role) => ({ role, score: scores.get(role.id) ?? 0 })),
  };
};
