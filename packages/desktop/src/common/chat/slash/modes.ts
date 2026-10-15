/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Slash modes (`/boost`, `/deep`, `/mermaid`, `/chart`, ...): a short word at the start of a message that
 * tells the assistant how to answer. The chat bubble keeps showing what the user typed; the model receives
 * the instruction in front of the user's request. Several modes can be combined: `/boost /chart compare ...`.
 *
 * Only the words in {@link SLASH_MODES} are modes. Everything else that starts with a slash, including
 * `/goal`, `/export` and `/repotopackage`, is left exactly as it was written.
 */

export type SlashMode = Readonly<{
  /** The word after the slash, lower case. */
  name: string;
  /** One line for the command menu. */
  summary: string;
  /** What the assistant is told to do. */
  instruction: string;
}>;

const RENDER_NOTE =
  'The chat renders fenced blocks, so use them exactly as described and do not describe the picture in words instead.';

export const SLASH_MODES: readonly SlashMode[] = [
  {
    name: 'boost',
    summary: 'Think deeply: several viewpoints, challenge the plan, then answer',
    instruction:
      'Mode /boost: before answering, reason through the problem from at least three viewpoints, challenge your first plan, look for what could go wrong, and only then give the answer. State assumptions and the trade-offs you chose.',
  },
  {
    name: 'deep',
    summary: 'Extended reasoning for hard, multi-step problems',
    instruction:
      'Mode /deep: take as much reasoning as the problem needs. Break it into steps, verify each step, and show the key reasoning in the answer rather than only the conclusion.',
  },
  {
    name: 'fast',
    summary: 'Short, direct answer',
    instruction:
      'Mode /fast: answer in the fewest words that are still correct. No preamble, no recap. Give the answer first, then at most three lines of explanation if they are needed.',
  },
  {
    name: 'grill-me',
    summary: 'Interview me until the requirements are clear',
    instruction:
      'Mode /grill-me: do not start the task yet. Act as a demanding reviewer and ask the questions that remove ambiguity: goals, constraints, edge cases, risks and what "done" means. Ask at most five questions at a time, most important first, and wait for the answers.',
  },
  {
    name: 'architect',
    summary: 'Answer as a software architect',
    instruction:
      'Mode /architect: answer from the architecture point of view: boundaries, data flow, failure modes, coupling and how the design will change over time. Compare at least two options and recommend one with reasons.',
  },
  {
    name: 'review',
    summary: 'Strict code review',
    instruction:
      'Mode /review: review the code strictly for correctness bugs, security problems (injection, secrets, unsafe input), race conditions, resource leaks, missing tests and conventions. Report findings most severe first, each with the location and a concrete fix. If you find nothing, say what you checked.',
  },
  {
    name: 'fix',
    summary: 'Fix a bug and explain the root cause',
    instruction:
      'Mode /fix: find the root cause before changing anything: name the exact file, symbol and condition, and what was expected against what happened. Make the smallest change that fixes it, then say how to verify it.',
  },
  {
    name: 'refactor',
    summary: 'Refactor without changing behaviour',
    instruction:
      'Mode /refactor: improve structure, naming and duplication without changing behaviour. Keep public interfaces stable, change as little as possible, and explain how you know behaviour is unchanged.',
  },
  {
    name: 'test',
    summary: 'Write thorough tests',
    instruction:
      'Mode /test: write tests that fail without the change and pass with it. Cover the normal case, edge cases, error handling and one regression case. Name each test after the behaviour it protects.',
  },
  {
    name: 'teamwork',
    summary: 'Split the task into parallel workstreams, then integrate',
    instruction:
      'Mode /teamwork: split the task into at most three workstreams that can be done independently, each with its own goal, inputs, output and done-check. If your tools let you start sub-agents, give each workstream to one and run them in parallel; otherwise work through them one by one. Finish as the integrator: merge the results, resolve conflicts between them and verify the whole against the original request.',
  },
  {
    name: 'terminal',
    summary: 'Solve it with shell commands, shown before they run',
    instruction:
      'Mode /terminal: solve the request with shell commands. Before running anything, show each exact command and one line on what it changes. Run commands only through your own command tool so the normal approval applies; never chain a destructive command (delete, overwrite, force push, install system-wide) without stating it plainly first. After each command, report its real output in short; if one fails, stop and explain instead of guessing.',
  },
  {
    name: 'explain',
    summary: 'Explain step by step',
    instruction:
      'Mode /explain: explain step by step for someone new to the topic. Start from the big picture, define terms when they first appear, use one small concrete example, and end with the most common mistake.',
  },
  {
    name: 'vietnamese',
    summary: 'Answer entirely in Vietnamese',
    instruction:
      'Mode /vietnamese: write the whole answer in clear, natural Vietnamese. Keep code, commands and identifiers unchanged; translate comments and explanations.',
  },
    {
    name: 'visual',
    summary: 'Use rich interactive-looking cards, metrics, diagrams and tables where they improve clarity',
    instruction:
      'Mode /visual: answer in concise Markdown by default. When a visual grouping materially helps, include one fenced block whose language is tomni-ui with a JSON object: {"version":1,"title":"...","fallbackText":"Meaningful plain-text equivalent","blocks":[{"type":"metrics","items":[{"label":"...","value":"...","detail":"..."}]},{"type":"flow","steps":[{"title":"Start"},{"title":"Parallel work","parallel":["Read","Search","Map"]},{"title":"Result"}]}]}. Available block types: metrics (items label/value/detail), flow (2-8 steps with title, optional description and optional parallel string array), cards (items title/description/optional tag), table (columns and rows arrays), gallery (targetCount 1–16 requested images, images containing up to 32 sourced candidates with src/alt/optional caption/source/sourceLabel). Only successfully loaded candidates appear; if fewer than targetCount work, the UI reports the shortfall. Use ONLY verified/user-supplied public HTTPS image URLs and sources, no invented URLs. Use only supported fields, always supply fallbackText, and never include HTML, JS, privileged actions or invented data. Use chart or mermaid blocks for quantitative plots or complex graphs. If the renderer cannot show tomni-ui, the fallback text must still answer the user. Do not create decorative UI for simple answers.',
  },
    {
    name: 'lesson',
    summary: 'Create an interactive step-by-step lesson with optional answers',
    instruction:
      'Mode /lesson: output one fenced tomni-ui JSON object {"version":1,"title":"...","fallbackText":"...","blocks":[{"type":"lesson","slides":[{"title":"Bước 1","body":"Bài học **định dạng Markdown**","question":"Câu hỏi?","options":["A","B","C","D"],"correctIndex":1,"reveal":"Giải thích vì sao B đúng"},{"title":"Bước 2","body":"Giải thích","question":"Tự luận?","allowTextAnswer":true,"reveal":"Câu trả lời gợi ý"}]}]}. Use 2-10 slides. Each slide may instead be purely explanatory (only title/body and optional reveal). For multiple choice supply question, 2–4 strings in options and zero-based correctIndex. For a written answer use question and allowTextAnswer:true, never grade free text automatically. Markdown is rendered safely in the body and explanations. Keep the fallbackText complete and never emit executable HTML or privilege instructions.',
  },
  {
    name: 'mermaid',
    summary: 'Answer with a Mermaid diagram',
    instruction: `Mode /mermaid: include a Mermaid diagram that shows the structure or flow (flowchart, sequence, ER or state diagram, whichever fits). Put it in a fenced block whose language is mermaid, keep node labels short, and follow it with a few lines that explain how to read it. ${RENDER_NOTE}`,
  },
  {
    name: 'chart',
    summary: 'Answer with a chart',
    instruction: `Mode /chart: present the numbers as a chart in a fenced block whose language is chart, containing JSON like {"type":"bar","title":"...","unit":"","labels":["A","B"],"series":[{"name":"S","data":[1,2]}]}. type is bar, line, area or pie; for a pie you may write "data":[{"label":"A","value":1}] instead. Every series needs one number per label. Use only numbers you were given or can compute, and say where they come from. ${RENDER_NOTE}`,
  },
  {
    name: 'table',
    summary: 'Answer with a table',
    instruction:
      'Mode /table: present the answer as a Markdown table with a header row and one row per item, columns in the order the reader will compare them. Keep cells short and put any longer explanation after the table.',
  },
  {
    name: 'artifact',
    summary: 'Produce a standalone deliverable',
    instruction:
      'Mode /artifact: produce one self-contained deliverable (a document, a single-file HTML page, an SVG or a React component, whichever fits) in a single fenced block, complete enough to be saved and used as it is. Put a one-paragraph description before it and nothing essential after it.',
  },
  {
    name: 'guide-me',
    summary: 'Show me where it is in the app',
    instruction:
      'Mode /guide-me: the user wants to find a control in this app. Answer in one or two sentences, then add a fenced block whose language is spotlight and whose content is the id of the control, for example settings, notifications, search, chat-input, attach-file, super, pipeline, nav-home, nav-store, nav-history or nav-manager. The user presses the button it makes to see the control highlighted; never claim you changed anything.',
  },
];

const MODE_BY_NAME: ReadonlyMap<string, SlashMode> = new Map(SLASH_MODES.map((mode) => [mode.name, mode]));

/** `/word` on its own, as a whole leading token. */
const LEADING_TOKEN = /^\s*\/([a-z][a-z0-9-]*)(?=\s|$)/iu;

export type ExpandedSlashModes = Readonly<{
  /**
   * The text for the model: the instructions, then the message exactly as typed (mode words included, so a
   * later redaction of the typed text still finds it). Equal to the input when no mode applies.
   */
  text: string;
  /** The modes that were applied, in the order they were written. */
  applied: readonly string[];
  /** What the user asked once the mode words are removed. */
  request: string;
}>;

/**
 * Reads the modes at the start of a message and puts their instructions in front of the rest of the request.
 * A message that is only mode words has nothing to apply them to, so it is returned unchanged.
 */
export const expandSlashModes = (input: string): ExpandedSlashModes => {
  const applied: SlashMode[] = [];
  let rest = input;
  for (;;) {
    const match = LEADING_TOKEN.exec(rest);
    const mode = match ? MODE_BY_NAME.get(match[1].toLowerCase()) : undefined;
    if (!match || !mode) break;
    if (!applied.includes(mode)) applied.push(mode);
    rest = rest.slice(match[0].length);
  }
  const request = rest.trim();
  if (applied.length === 0 || request === '') return { text: input, applied: [], request: input.trim() };
  return {
    text: `${applied.map((mode) => mode.instruction).join('\n')}\n\n${input.trim()}`,
    applied: applied.map((mode) => mode.name),
    request,
  };
};

export const isSlashMode = (name: string): boolean => MODE_BY_NAME.has(name.toLowerCase());

/**
 * The hidden model text for a message that starts with modes. `modelInput` is what the app already prepared for
 * the model (it contains the typed text, possibly with extra directives around it); the mode words in it are
 * replaced by their instructions. Returns undefined when the message uses no mode, so callers keep what they had.
 */
export const applyModesToModelInput = (input: string, modelInput: string | undefined): string | undefined => {
  const expanded = expandSlashModes(input);
  if (expanded.applied.length === 0) return undefined;
  if (modelInput === undefined) return expanded.text;
  // A replacer function, so `$` sequences in the text are not read as replacement patterns.
  return modelInput.includes(input)
    ? modelInput.replace(input, () => expanded.text)
    : `${expanded.text}\n\n${modelInput}`;
};
