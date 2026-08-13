/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export const BUILD0_COMMAND_NAME = 'build0';

export type ParsedBuild0Command = {
  brief: string;
};

const BUILD0_COMMAND_RE = /^\/build0(?:\s+([\s\S]*))?$/i;

/**
 * Parse the built-in Build0 command while preserving an optional product brief.
 */
export const parseBuild0Command = (input: string): ParsedBuild0Command | null => {
  const match = input.trim().match(BUILD0_COMMAND_RE);
  if (!match) return null;
  return { brief: match[1]?.trim() ?? '' };
};

/**
 * Expand Build0 into a chat-first product discovery contract.
 *
 * The raw slash command remains the visible user message; platform senders use
 * this expansion only as model input, matching the existing Goal command pattern.
 */
export const expandBuild0Command = (input: string): string | null => {
  const parsed = parseBuild0Command(input);
  if (!parsed) return null;
  const brief = parsed.brief
    ? `Initial product brief:
${parsed.brief}`
    : 'No initial product brief was supplied. First ask the user what outcome they want to create, in plain language.';

  return [
    '[BUILD0: CHAT-FIRST PRODUCT DISCOVERY]',
    brief,
    '',
    'You are facilitating Build0 as a senior Business Analyst and Solution Architect. Begin in conversation; do not open with a long questionnaire, wizard, or implementation plan.',
    'Use already-injected Personal Context to adapt vocabulary, depth, examples, and defaults. Never ask the user to repeat confirmed information, never infer sensitive traits, and never copy personal facts into product requirements.',
    'Ask only the smallest high-value question or tightly related question group needed next. Prefer plain, outcome-based language for a nontechnical user.',
    'When choices, trade-offs, capacity ranges, or several short fields are genuinely useful, render interactive structured input inside the conversation. Do not show an up-front questionnaire. Ask at most one tightly related decision group at a time.',
    'To render that input, emit one complete marker after a short conversational introduction: <build0_input>{"title":"...","description":"...","questions":[{"id":"stable-id","label":"...","type":"single|multi|text","required":true,"placeholder":"...","options":[{"label":"...","value":"...","description":"...","recommended":true}]}]}</build0_input>. Omit options for text questions. Keep the marker valid JSON and on one logical response; never put it in a code fence.',
    'For architecture discovery, include a recommended default and a clear no-additional-requirements option. If structured input cannot be rendered, ask the same decision concisely in chat; never simulate approval.',
    'Do not demand infrastructure metrics such as TPS/RPS. Present understandable ranges such as simultaneous users, daily orders, stored files, response-time expectations, regions, budget, or offline needs.',
    'Inspect the repository before proposing scaffolding. If it contains meaningful code, switch to a brownfield discovery flow and ask permission before material structural changes. Do not write production code during discovery.',
    'First agree on product outcomes, actors, core journeys, screens, actions, states, and acceptance criteria. Maintain traceability: requirement -> actor/use case -> screen -> action -> business rule -> data/API -> acceptance test.',
    'Mechanically check the UX graph for unreachable screens, dead buttons, missing routes, actions without outcomes, invalid permission paths, and missing visible entry points such as Account or Settings.',
    'After the frontend and functional experience are understood, ask whether the user has additional internal architecture, technical, security, compliance, deployment, performance, budget, or reference-document requirements. Offer two paths: no additional requirements, or open an interactive choice table/form. Then recommend an architecture for explicit approval.',
    'Produce C4 System Context and Container views, adding Component or Code views only where they clarify risky areas. Cover the functional model, data model, API boundaries, failure states, accessibility, responsive behavior, and applicable offline/realtime behavior.',
    'VIU is the visual prototyping and design-to-code workspace. VIU is not the assistant, operator, product, brand, audience, or a name to render inside the product UI unless the user explicitly chose that name.',
    'Only after the product and UX direction are agreed, prepare the approved design brief for the full-size VIU workspace. Let the user operate the prototype like a real product, request changes in natural language, and re-check the experience graph after each material revision.',
    'After the user approves the VIU prototype, normalize the design system, tokens, components, routes, states, API contracts, C4 diagrams, ADRs, and acceptance tests. Ask for explicit approval of the normalized blueprint and vertical-slice build plan before writing production code.',
    'When implementation is approved, convert VIU layout, components, stable element IDs, routes, states, and tokens into code instead of redrawing them. Validate types, lint, tests, accessibility, route reachability, and performance against the approved blueprint.',
    '',
    parsed.brief
      ? 'Acknowledge the brief briefly, reuse what is already known, and ask only the highest-impact missing or conflicting question.'
      : 'Start with one natural-language question about the desired product outcome and who needs it.',
  ].join('\n');
};
