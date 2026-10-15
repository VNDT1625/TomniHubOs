import type { SessionContextBranch, SessionContextSnapshot } from '@/common';

/** Every block TomniHubOS can put in front of the next turn, in the order the model reads them. */
export type ContextSectionId =
  | 'system'
  | 'agent'
  | 'personal'
  | 'notes'
  | 'custom'
  | 'branches'
  | 'controlTools'
  | 'tools'
  | 'workingMemory'
  | 'capabilities';

export type ContextSection = {
  id: ContextSectionId;
  /** Estimated tokens of exactly the text below. */
  tokens: number;
  /** Item count for list-like blocks (branches, tools). */
  count?: number;
  /** Readable content; empty when the block is not sent. */
  text: string;
};

export type ContextOverview = {
  /** True when the runtime exposes its full prompt; false when only app-owned blocks are measurable. */
  native: boolean;
  sections: ContextSection[];
  totalTokens: number;
  /** Stored messages. They are an archive and are not sent verbatim. */
  archive: { messages: number; tokens: number };
  runtimeDisclosure?: string;
};

/** Same rough estimator the Main process uses for these blocks (4 characters per token). */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const section = (id: ContextSectionId, text: string, count?: number, tokenSource = text): ContextSection => ({
  id,
  text,
  tokens: estimateTokens(tokenSource),
  ...(count === undefined ? {} : { count }),
});

const renderBranches = (branches: readonly SessionContextBranch[]): string =>
  branches
    .map((branch) => `### ${branch.title.trim() || branch.id}\nSummary: ${branch.summary}\n${branch.content}`)
    .join('\n\n');

const jsonSection = (id: ContextSectionId, value: readonly unknown[] | Record<string, unknown>): ContextSection => {
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  if (empty) return section(id, '', Array.isArray(value) ? 0 : undefined);
  return section(
    id,
    JSON.stringify(value, null, 2),
    Array.isArray(value) ? value.length : undefined,
    JSON.stringify(value)
  );
};

/** Turns one session snapshot into the list the Session memory panel shows: block, size, readable text. */
export const buildContextOverview = (snapshot: SessionContextSnapshot): ContextOverview => {
  const archive = { messages: snapshot.archive.message_count, tokens: snapshot.archive.token_estimate };
  const branches = snapshot.app.context_branches;
  const finish = (isNative: boolean, sections: ContextSection[], runtimeDisclosure?: string): ContextOverview => ({
    native: isNative,
    sections,
    totalTokens: sections.reduce((sum, item) => sum + item.tokens, 0),
    archive,
    ...(runtimeDisclosure ? { runtimeDisclosure } : {}),
  });

  if (snapshot.inspection.kind === 'app-only') {
    return finish(
      false,
      [
        section('notes', snapshot.app.saved_memory_context),
        section('custom', snapshot.app.custom_context),
        section('branches', renderBranches(branches), branches.length),
      ],
      snapshot.inspection.disclosure
    );
  }

  const inspected = snapshot.inspection.snapshot;
  const capability = inspected.session_experience.capability_summary;
  return finish(true, [
    section('system', inspected.system),
    section('agent', inspected.core_context.agent),
    section('personal', inspected.core_context.personal),
    section('notes', inspected.core_context.saved_memory ?? snapshot.app.saved_memory_context),
    section('custom', inspected.custom_context),
    section('branches', renderBranches(inspected.context_branches), inspected.context_branches.length),
    jsonSection('controlTools', inspected.core_context.control_tools),
    jsonSection('tools', inspected.tools),
    jsonSection('workingMemory', inspected.working_memory),
    section('capabilities', typeof capability === 'string' ? capability : ''),
  ]);
};
