/**
 * A package agent is a read-only Assistant with Main-owned provenance.
 * Its suggested tools never grant capabilities, and model hints are optional, not execution policy.
 */
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { AssistantCatalogStore } from '@process/resources/assistantCatalogStore';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ConnectionOf,
  type HostContext,
  type HostCheck,
} from '../../core/types';

type AgentConnection = ConnectionOf<'agent'>;
type Catalog = Pick<
  AssistantCatalogStore,
  'list' | 'upsertPackageAssistant' | 'removePackageAssistant' | 'reconcilePackageAssistants'
>;
export type AgentHostDeps = Readonly<{ catalog: () => Promise<Catalog> }>;
const MAX_AGENT_BYTES = 128 * 1024;

/** Markdown frontmatter is metadata, not part of the Assistant's system instructions. */
const agentBody = (text: string): string => text.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/u, '').trim();

const assistantId = (packageId: string, connectionId: string): string => `package:${packageId}:${connectionId}`;

const load = async (context: HostContext, connection: AgentConnection): Promise<string> => {
  if (!connection.path.startsWith('source/') || !/\.md$/iu.test(connection.path))
    throw new Error('Agent definition must be a Markdown file under source/.');
  const bytes = await context.readPackageFile(connection.path);
  if (bytes.length === 0 || bytes.length > MAX_AGENT_BYTES) throw new Error('Agent definition is empty or too large.');
  const body = agentBody(bytes.toString('utf8'));
  if (!body) throw new Error('Agent definition has no instructions.');
  return body;
};

const inspect = async (context: HostContext, connection: AgentConnection, catalog: Catalog): Promise<HostCheck> => {
  try {
    await load(context, connection);
    const existing = (await catalog.list()).find(
      (assistant) => assistant.id === assistantId(context.packageId, connection.id)
    );
    if (
      existing &&
      (existing.source !== 'package' ||
        existing.packageId !== context.packageId ||
        existing.packageConnectionKey !== `agent:${connection.id}`)
    )
      return { ok: false, reason: 'Assistant ID is already used by another owner.', needsInput: true };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Agent definition cannot be read.' };
  }
};

const modelsFor = (hint: string | undefined): string[] => {
  const aliases: Record<string, string> = {
    sonnet: 'claude-sonnet-4-20250514',
    opus: 'claude-opus-4-20250514',
    haiku: 'claude-3-5-haiku-20241022',
  };
  const mapped = hint && aliases[hint.toLowerCase()];
  return mapped ? [mapped] : [];
};

export const createAgentHost = (deps: AgentHostDeps): AnyConnectionHost =>
  defineConnectionHost({
    kind: 'agent',
    check: async (context, connection: AgentConnection) => inspect(context, connection, await deps.catalog()),
    describe: async (context, connection: AgentConnection) => ({
      kind: 'agent',
      title: connection.title,
      lines: [
        { label: 'Type', value: 'Read-only Assistant with instructions from the package; nothing is executed.' },
        { label: 'Definition', value: connection.path },
        { label: 'Model hint', value: connection.model ?? 'inherit' },
        { label: 'Tool hints (not permissions)', value: (connection.tools ?? []).join(', ') || 'none' },
        { label: 'Owner', value: `package:${context.packageId}` },
      ],
      files: [connection.path],
    }),
    enable: async (context, connection: AgentConnection) => {
      const catalog = await deps.catalog();
      const checked = await inspect(context, connection, catalog);
      if (checked.ok === false) throw new Error(checked.reason);
      const row: Assistant = {
        id: assistantId(context.packageId, connection.id),
        source: 'package',
        packageId: context.packageId,
        packageConnectionKey: `agent:${connection.id}`,
        name: connection.title,
        name_i18n: {},
        description: connection.description,
        description_i18n: {},
        enabled: true,
        sort_order: 0,
        preset_agent_type: 'tomnyagentic',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        enabled_plugins: [],
        enabled_hooks: [],
        default_tools: [],
        context: await load(context, connection),
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: modelsFor(connection.model),
      };
      const saved = await catalog.upsertPackageAssistant(row);
      return { installed: [saved.id] };
    },
    disable: async (context, connection: AgentConnection) => {
      await (await deps.catalog()).removePackageAssistant(context.packageId, `agent:${connection.id}`);
    },
    reconcile: async ({ keep }) => {
      await (await deps.catalog()).reconcilePackageAssistants(keep);
    },
  });
