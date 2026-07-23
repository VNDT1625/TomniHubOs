export type ContextScope = { kind: 'global' } | { kind: 'surface'; surface: string };

export type ContextFact = {
  key: string;
  value: string;
  confidence: number;
  source: 'user' | 'observed' | 'imported' | 'inferred';
  learnedAt: number;
  lastConfirmedAt?: number;
  scope: ContextScope;
  sensitivity: 'normal' | 'private';
  userLocked: boolean;
};

export type DecisionPolicy = {
  autonomy: 'ask' | 'minor-only' | 'autonomous';
  mayDecideCategories: string[];
  alwaysAskCategories: string[];
  riskTolerance?: 'low' | 'medium' | 'high';
};

export type CommunicationStyle = {
  language?: string;
  tone?: string;
  verbosity?: 'concise' | 'balanced' | 'detailed';
  vocabulary: string[];
  writingGuidance: string[];
};

export type AgentContext = {
  id: string;
  name: string;
  role: string;
  identity: string;
  traits: string[];
  capabilities: string[];
  instructions: string[];
  updatedAt: number;
};

export type PersonalSecretReference = {
  key: string;
  handle: string;
  capability: string;
  surfaces: string[];
  purposes: string[];
  /** Model-visible variable names only. Secret values never enter Personal Context. */
  fields?: string[];
  description?: string;
};

export type StructuredPersonalProfile = {
  personalInformation: ContextFact[];
  psychology: ContextFact[];
  personality: ContextFact[];
  interests: ContextFact[];
  profession: ContextFact[];
  aestheticTaste: ContextFact[];
  pastContext: ContextFact[];
};

export type PersonalContext = {
  id: string;
  facts: ContextFact[];
  preferences: ContextFact[];
  structuredProfile: StructuredPersonalProfile;
  communication: CommunicationStyle;
  decisionPolicy: DecisionPolicy;
  habits: ContextFact[];
  secretReferences: PersonalSecretReference[];
  updatedAt: number;
};

export type ContextDocument = { version: 1; agents: AgentContext[]; people: PersonalContext[] };
export type SecretKind = 'credential' | 'password' | 'token' | 'cookie' | 'private-key' | 'other';
export type SecretBinding = { surfaces: string[]; purposes: string[]; targets?: string[] };
export type SecretDescriptor = {
  handle: string;
  /** User-facing name of the secret set. */
  label: string;
  /** Optional usage note; metadata only and safe for the local renderer. */
  note?: string;
  kind: SecretKind;
  /** Variable names only; values remain encrypted in the vault payload. */
  fields: string[];
  binding: SecretBinding;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  revokedAt?: number;
};
export type SecretResolveRequest = {
  handle: string;
  surface: string;
  purpose: string;
  target?: string;
  fields: string[];
};
export type CoreContextComposeInput = {
  agentId: string;
  personalId: string;
  surface: string;
  /** Host-resolved surface policy. Opaque handles fail closed when this is absent. */
  secretContextPolicy?: {
    includeOpaqueSecretHandles: boolean;
    allowedSecretCapabilities?: string[];
  };
  prompt: string;
};
export type CoreIdentityContextSnapshot = {
  agent?: string;
  personal?: string;
};
export type CoreContextComposer = {
  composePrompt(input: CoreContextComposeInput): Promise<string>;
  inspectContext?(input: Omit<CoreContextComposeInput, 'prompt'>): Promise<CoreIdentityContextSnapshot>;
};
