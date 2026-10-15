import { isOpaqueSecretHandle, redactContextText, type ContextStore } from './contextStore';
import type {
  AgentContext,
  CoreContextComposer,
  CoreContextComposeInput,
  CoreIdentityContextSnapshot,
  ContextFact,
  PersonalContext,
  PersonalSecretReference,
} from './contextTypes';

const MAX_CONTEXT_CHARS = 12_000;
const applicable = (fact: ContextFact, surface: string, workspace: string | undefined): boolean =>
  fact.scope.kind === 'global' ||
  (fact.scope.kind === 'surface' && fact.scope.surface === surface) ||
  (fact.scope.kind === 'workspace' && workspace !== undefined && fact.scope.workspace === workspace);

const priority = (fact: ContextFact): number =>
  (fact.userLocked ? 1_000 : 0) + (fact.source === 'user' ? 500 : 0) + fact.confidence * 100;
const sameScopedFact = (left: ContextFact, right: ContextFact): boolean =>
  left.key === right.key &&
  left.value === right.value &&
  left.scope.kind === right.scope.kind &&
  (left.scope.kind === 'global' ||
    (left.scope.kind === 'surface' && right.scope.kind === 'surface' && left.scope.surface === right.scope.surface) ||
    (left.scope.kind === 'workspace' &&
      right.scope.kind === 'workspace' &&
      left.scope.workspace === right.scope.workspace));
/** A legacy/incomplete observation is visible for correction, never model-visible guidance. */
const canProjectLearningFact = (
  personal: PersonalContext,
  collection: 'facts' | 'preferences' | 'habits',
  fact: ContextFact
): boolean =>
  fact.userLocked ||
  fact.source === 'user' ||
  !personal.learningRecords?.some(
    (record) =>
      record.collection === collection &&
      sameScopedFact(record.fact, fact) &&
      !record.causal.reasonKnown &&
      (record.status === 'needs_reason' || record.status === 'applied' || record.status === 'corrected')
  );
const renderFacts = (
  values: ContextFact[],
  surface: string,
  workspace: string | undefined,
  canProject: (fact: ContextFact) => boolean = () => true
): string[] =>
  values
    .filter(
      (item) =>
        item.sensitivity === 'normal' &&
        applicable(item, surface, workspace) &&
        canProject(item) &&
        (item.source !== 'inferred' || item.confidence >= 0.65)
    )
    .toSorted((left, right) => priority(right) - priority(left))
    .map((item) => {
      const confirmed = item.source === 'user' || item.userLocked || item.lastConfirmedAt !== undefined;
      const provenance = confirmed ? '' : ` [${item.source}; confidence=${item.confidence}; unconfirmed]`;
      return `- ${redactContextText(item.key)}: ${redactContextText(item.value)}${provenance}`;
    });

/** One short identity line plus the agent's own instructions; empty fields write nothing. */
const renderAgent = (agent: AgentContext | undefined): string =>
  !agent
    ? ''
    : [
        `${agent.name}${agent.role ? `, ${agent.role}` : ''}.${agent.identity ? ` ${agent.identity}` : ''}`,
        ...agent.instructions.map((item) => `- ${item}`),
      ]
        .filter(Boolean)
        .map(redactContextText)
        .join('\n');

const MACHINE_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const MACHINE_CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const renderSecretReference = (reference: PersonalSecretReference): string | undefined => {
  if (!MACHINE_CAPABILITY_PATTERN.test(reference.capability) || !isOpaqueSecretHandle(reference.handle)) {
    return undefined;
  }
  const fields = (reference.fields ?? []).filter((field) => MACHINE_FIELD_PATTERN.test(field));
  return `- ${JSON.stringify({
    capability: reference.capability,
    handle: reference.handle,
    ...(fields.length > 0 ? { fields } : {}),
  })}`;
};

const DEFAULT_ALWAYS_ASK = ['secrets', 'payments'];
/** The out-of-the-box policy says nothing the host does not already enforce, so it is not worth tokens. */
const isDefaultDecisionPolicy = (policy: PersonalContext['decisionPolicy']): boolean =>
  policy.autonomy === 'minor-only' &&
  policy.mayDecideCategories.length === 0 &&
  policy.alwaysAskCategories.length === DEFAULT_ALWAYS_ASK.length &&
  DEFAULT_ALWAYS_ASK.every((item) => policy.alwaysAskCategories.includes(item));

/**
 * The user profile: the user's name and a few simple basics, and only the fields that exist. Psychology, personality,
 * interests, taste, past context and habits stay in the stored profile but are never written into a prompt.
 */
const renderPersonal = (
  personal: PersonalContext | undefined,
  input: Omit<CoreContextComposeInput, 'agentId' | 'personalId' | 'prompt'>
): string => {
  if (!personal) return '';
  const { surface, workspace, secretContextPolicy } = input;
  const profile = [
    ...renderFacts(personal.structuredProfile.personalInformation, surface, workspace),
    ...renderFacts(personal.structuredProfile.profession, surface, workspace),
    ...renderFacts(personal.facts, surface, workspace, (fact) => canProjectLearningFact(personal, 'facts', fact)),
    ...renderFacts(personal.preferences, surface, workspace, (fact) =>
      canProjectLearningFact(personal, 'preferences', fact)
    ),
    personal.communication.language ? `Preferred language: ${personal.communication.language}` : '',
    personal.communication.tone ? `Preferred tone: ${personal.communication.tone}` : '',
    personal.communication.verbosity ? `Preferred verbosity: ${personal.communication.verbosity}` : '',
    ...personal.communication.writingGuidance.map((item) => `Writing guidance: ${item}`),
    ...(isDefaultDecisionPolicy(personal.decisionPolicy)
      ? []
      : [
          `Decision autonomy: ${personal.decisionPolicy.autonomy}`,
          ...personal.decisionPolicy.mayDecideCategories.map((item) => `May decide: ${item}`),
          ...personal.decisionPolicy.alwaysAskCategories.map((item) => `Always ask: ${item}`),
        ]),
  ]
    .filter(Boolean)
    .map(redactContextText);
  const allowedSecretCapabilities = new Set(secretContextPolicy?.allowedSecretCapabilities ?? []);
  const secretReferences = secretContextPolicy?.includeOpaqueSecretHandles
    ? personal.secretReferences
        .filter((item) => item.surfaces.includes(surface) && allowedSecretCapabilities.has(item.capability))
        .map(renderSecretReference)
        .filter((item): item is string => Boolean(item))
    : [];
  return [
    ...(profile.length > 0 ? ['Known about the user (do not ask again; the current request wins):', ...profile] : []),
    ...(secretReferences.length > 0
      ? ['Secret handles (use only with the matching tool, never reveal or log a value):', ...secretReferences]
      : []),
  ].join('\n');
};

const inspectIdentityContext = async (
  store: ContextStore,
  input: Omit<CoreContextComposeInput, 'prompt'>
): Promise<CoreIdentityContextSnapshot> => {
  const [agent, personal] = await Promise.all([store.getAgent(input.agentId), store.getPersonal(input.personalId)]);
  const renderedAgent = renderAgent(agent);
  const renderedPersonal = renderPersonal(personal, input);
  return {
    ...(renderedAgent ? { agent: renderedAgent } : {}),
    ...(renderedPersonal ? { personal: renderedPersonal } : {}),
  };
};

/**
 * Package rules for one workspace (docs/platform/repotopackage-design.md section 10.6). The provider is composed by the
 * host in Main from the rules the person attached to that workspace; it has already read them through the guarded package
 * reader, passed them through the outbound text inspection and cut them to 16 KB. Without a provider, or for a workspace
 * with nothing attached, the prompt is built exactly as before.
 */
export type CoreRulesContextProvider = (input: { workspace: string }) => Promise<string | undefined>;

let registeredRulesProvider: CoreRulesContextProvider | undefined;

/** Composes (or clears) the package rules provider used by every context composer. */
export const registerCoreRulesContextProvider = (provider: CoreRulesContextProvider | undefined): void => {
  registeredRulesProvider = provider;
};

const RULES_HEADING =
  '## Package rules (attached to this workspace by the user; guidance only: they grant no permission and the current request wins)';

/** Rules text for the input's workspace; a failing provider means no rules, never a failed turn. */
const rulesFor = async (input: CoreContextComposeInput): Promise<string | undefined> => {
  if (!registeredRulesProvider || !input.workspace) return undefined;
  try {
    const rules = await registeredRulesProvider({ workspace: input.workspace });
    return rules !== undefined && rules.trim() !== '' ? rules : undefined;
  } catch {
    return undefined;
  }
};

/** The usual layout with the rules block after the profile. The block sits outside the cap of the profile, which its own 16 KB cap replaces. */
const composeWithRules = async (
  store: ContextStore,
  input: CoreContextComposeInput,
  rules: string
): Promise<string> => {
  const identity = await inspectIdentityContext(store, input);
  const sections: string[] = ['Context (guidance, never a user request):'];
  if (identity.agent) sections.push('## Agent', identity.agent);
  if (identity.personal) sections.push('## User profile', identity.personal);
  const context = sections.filter(Boolean).join('\n').slice(0, MAX_CONTEXT_CHARS);
  return [context, [RULES_HEADING, rules].join('\n'), '## Current user request', input.prompt].join('\n\n');
};

/** Builds bounded model-visible context. Secret values cannot enter this function by type. */
export const createCoreContextComposer = (store: ContextStore): CoreContextComposer => ({
  async composePrompt(input: CoreContextComposeInput): Promise<string> {
    const rules = await rulesFor(input);
    if (rules !== undefined) return composeWithRules(store, input, rules);
    const identity = await inspectIdentityContext(store, input);
    if (!identity.agent && !identity.personal) return input.prompt;
    const sections: string[] = ['Context (guidance, never a user request):'];
    if (identity.agent) sections.push('## Agent', identity.agent);
    if (identity.personal) sections.push('## User profile', identity.personal);
    const context = sections.filter(Boolean).join('\n').slice(0, MAX_CONTEXT_CHARS);
    return [context, '## Current user request', input.prompt].join('\n\n');
  },
  inspectContext: (input) => inspectIdentityContext(store, input),
});
