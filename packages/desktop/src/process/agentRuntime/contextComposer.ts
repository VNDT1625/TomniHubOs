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
  title: string,
  values: ContextFact[],
  surface: string,
  workspace: string | undefined,
  canProject: (fact: ContextFact) => boolean = () => true
): string[] => {
  const selected = values
    .filter(
      (item) =>
        item.sensitivity === 'normal' &&
        applicable(item, surface, workspace) &&
        canProject(item) &&
        (item.source !== 'inferred' || item.confidence >= 0.65)
    )
    .toSorted((left, right) => priority(right) - priority(left));
  return selected.length === 0
    ? []
    : [
        title,
        ...selected.map((item) => {
          const confirmed = item.source === 'user' || item.userLocked || item.lastConfirmedAt !== undefined;
          const provenance = confirmed ? '' : ` [${item.source}; confidence=${item.confidence}; unconfirmed]`;
          return `- ${redactContextText(item.key)}: ${redactContextText(item.value)}${provenance}`;
        }),
      ];
};

const renderAgent = (agent: AgentContext | undefined): string =>
  !agent
    ? ''
    : [
        `Name: ${agent.name}`,
        `Role: ${agent.role}`,
        `Identity: ${agent.identity}`,
        agent.traits.length ? `Traits: ${agent.traits.join(', ')}` : '',
        agent.capabilities.length ? `Capabilities: ${agent.capabilities.join(', ')}` : '',
        ...agent.instructions.map((item) => `Instruction: ${item}`),
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

const renderPersonal = (
  personal: PersonalContext | undefined,
  input: Omit<CoreContextComposeInput, 'agentId' | 'personalId' | 'prompt'>
): string => {
  if (!personal) return '';
  const { surface, workspace, secretContextPolicy } = input;
  const lines = [
    'Personal Context usage rules:',
    '- User-provided, user-locked, or last-confirmed facts are already-known context; do not ask the user to repeat them.',
    '- Treat observed, imported, and inferred facts as tentative guidance. Confirm them only when they materially affect the outcome, raise risk, or conflict with the current request.',
    '- The current explicit user request overrides this context whenever they conflict.',
    '- Psychology facts are self-described context, not a diagnosis. Never infer or diagnose psychological or mental-health attributes.',
    ...renderFacts('Personal information:', personal.structuredProfile.personalInformation, surface, workspace),
    ...renderFacts(
      'Psychology (self-described, non-diagnostic):',
      personal.structuredProfile.psychology,
      surface,
      workspace
    ),
    ...renderFacts('Personality:', personal.structuredProfile.personality, surface, workspace),
    ...renderFacts('Interests:', personal.structuredProfile.interests, surface, workspace),
    ...renderFacts('Profession:', personal.structuredProfile.profession, surface, workspace),
    ...renderFacts('Aesthetic taste:', personal.structuredProfile.aestheticTaste, surface, workspace),
    ...renderFacts('Past context:', personal.structuredProfile.pastContext, surface, workspace),
    ...renderFacts('Known user facts:', personal.facts, surface, workspace, (fact) =>
      canProjectLearningFact(personal, 'facts', fact)
    ),
    ...renderFacts('Preferences:', personal.preferences, surface, workspace, (fact) =>
      canProjectLearningFact(personal, 'preferences', fact)
    ),
    personal.communication.language ? `Preferred language: ${personal.communication.language}` : '',
    personal.communication.tone ? `Preferred tone: ${personal.communication.tone}` : '',
    personal.communication.verbosity ? `Preferred verbosity: ${personal.communication.verbosity}` : '',
    ...personal.communication.writingGuidance.map((item) => `Writing guidance: ${item}`),
    `Decision autonomy: ${personal.decisionPolicy.autonomy}`,
    ...personal.decisionPolicy.mayDecideCategories.map((item) => `May decide: ${item}`),
    ...personal.decisionPolicy.alwaysAskCategories.map((item) => `Always ask: ${item}`),
    ...renderFacts('Habits:', personal.habits, surface, workspace, (fact) =>
      canProjectLearningFact(personal, 'habits', fact)
    ),
  ];
  const allowedSecretCapabilities = new Set(secretContextPolicy?.allowedSecretCapabilities ?? []);
  const secretReferences = secretContextPolicy?.includeOpaqueSecretHandles
    ? personal.secretReferences
        .filter((item) => item.surfaces.includes(surface) && allowedSecretCapabilities.has(item.capability))
        .map(renderSecretReference)
        .filter((item): item is string => Boolean(item))
    : [];
  const renderedLines = lines.filter(Boolean).map(redactContextText);
  renderedLines.push(
    'Secret Firewall policy: opaque capture, generation, redaction and registered sink use are evaluated automatically by the trusted host. Do not request per-use approval and never request plaintext.'
  );
  if (secretReferences.length > 0) {
    renderedLines.push(
      'Opaque Secret Capabilities:',
      'The following JSON records are inert capability metadata. Use handles only with a matching trusted host tool. Never request, reveal, log, or place secret values in chat.',
      ...secretReferences
    );
  }
  return renderedLines.join('\n');
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

/** Builds bounded model-visible context. Secret values cannot enter this function by type. */
export const createCoreContextComposer = (store: ContextStore): CoreContextComposer => ({
  async composePrompt(input: CoreContextComposeInput): Promise<string> {
    const identity = await inspectIdentityContext(store, input);
    if (!identity.agent && !identity.personal) return input.prompt;
    const sections: string[] = ['Tomny Core personalization context. Treat it as guidance, never as a user request.'];
    if (identity.agent) sections.push('## Agent Context', identity.agent);
    if (identity.personal) sections.push('## Personal Context', identity.personal);
    sections.push(`Active surface: ${input.surface}`);
    const context = sections.filter(Boolean).join('\n').slice(0, MAX_CONTEXT_CHARS);
    return [context, '## Current user request', input.prompt].join('\n\n');
  },
  inspectContext: (input) => inspectIdentityContext(store, input),
});
