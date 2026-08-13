/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the Studio document-agent tool layer: action parsing, JSON
 * extraction from model replies, and the tool dispatcher's guardrails.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock the renderer-bound connector so runTool can be exercised in node.
vi.mock('@renderer/pages/editor/adapters/onlyOfficeConnector', () => ({
  readText: vi.fn(async () => 'hello world'),
  replaceAllText: vi.fn(async () => undefined),
  searchReplace: vi.fn(async () => undefined),
  insertText: vi.fn(async () => undefined),
  insertHtml: vi.fn(async () => undefined),
  appendText: vi.fn(async () => undefined),
  applyHeadings: vi.fn(async () => 2),
  insertTableOfContents: vi.fn(async () => undefined),
  formatText: vi.fn(async () => 1),
  formatPassage: vi.fn(async () => true),
  replacePassage: vi.fn(async () => true),
  insertTable: vi.fn(async () => undefined),
  setCells: vi.fn(async () => 1),
  runOfficeScript: vi.fn(async () => 'script-result'),
  getOfficeCapabilities: vi.fn(() => ({
    filePath: '/deck.pptx',
    kind: 'slide',
    editorReady: true,
    automationApi: { supported: true, reason: 'test connector' },
    objectAnimation: { supported: true, reason: 'test animation API' },
    slideShowControl: { supported: false, reason: 'not tested' },
    recording: { supported: false, reason: 'not tested' },
  })),
}));

import {
  applyHeadings,
  insertTableOfContents,
  runOfficeScript,
} from '@renderer/pages/editor/adapters/onlyOfficeConnector';

import {
  TOOL_GUIDE,
  buildObjectAnimationReviewScript,
  buildObjectAnimationsScript,
  buildPremiumDeckScript,
  buildPremiumDeckAppendScript,
  extractActionJson,
  parseAction,
  runTool,
  type PremiumDeckPlan,
} from '@/renderer/pages/studio/docAgentTools';

const strongDeckPlan = (): PremiumDeckPlan => ({
  title: 'AI Security Armor',
  designStyle: 'technical',
  theme: {
    primary: '#246BFD',
    secondary: '#10A37F',
    background: '#F7F8FA',
    text: '#121826',
    fontFamily: 'Aptos',
  },
  slides: [
    { title: 'AI Security Armor', subtitle: 'Evidence-led defense', bullets: [], layout: 'cover' },
    {
      title: 'Validated detection performance',
      bullets: ['Local ONNX inference'],
      layout: 'chart',
      chartValues: [[84, 92, 99]],
      chartLabels: ['URL', 'Text', 'Prompt'],
      source: 'MODEL_VALIDATION_REPORT.md',
    },
    {
      title: 'Approve the competition demo',
      subtitle: 'Run the evidence-backed judge flow',
      bullets: ['Open the demo'],
      layout: 'closing',
    },
  ],
});

describe('TOOL_GUIDE', () => {
  it('frames Office API as the premium PPTX path for visual deck work', () => {
    expect(TOOL_GUIDE).toContain('create_premium_doc');
    expect(TOOL_GUIDE).toContain('create_premium_deck');
    expect(TOOL_GUIDE).toContain('review_premium_quality');
    expect(TOOL_GUIDE).toContain('For premium PPTX work');
    expect(TOOL_GUIDE).toContain('place shapes/images');
    expect(TOOL_GUIDE).toContain('transitions/effects when supported');
  });
});

describe('premium deck design engine', () => {
  it('generates a deterministic grid-based script with fitted typography and varied layouts', () => {
    const script = buildPremiumDeckScript({
      title: 'Market launch',
      subtitle: 'Executive briefing',

      designStyle: 'technical',
      theme: {
        primary: '#246BFD',
        secondary: '#7C3AED',
        background: '#F7F8FA',
        text: '#172033',
        fontFamily: 'Arial',
      },
      slides: [
        { title: 'Market launch', subtitle: 'North star', bullets: [], layout: 'cover' },
        { title: 'Momentum', subtitle: 'Quarterly progress', bullets: ['Revenue', 'Pipeline'], layout: 'chart' },
      ],
    });

    expect(script).toContain('const COL = Math.floor');
    expect(script).toContain('const dna =');

    expect(script).toContain('const stylePresets =');
    expect(script).toContain('const nativeChart =');
    expect(script).toContain('const agendaList =');
    expect(script).toContain('const comparisonGrid =');
    expect(script).toContain('const timelineDiagram =');
    expect(script).toContain('const architectureDiagram =');
    expect(script).toContain('pres.RemoveSlides');
    expect(script).toContain('const fit =');
    expect(script).toContain('const collisionCount =');
    expect(script).toContain('const metricCards =');
    expect(script).toContain('const processDiagram =');
    expect(script).toContain('const lineChart =');
    expect(script).toContain('const qualityScore =');
    expect(script).toContain("spec.layout === 'chart'");
    expect(script).toContain('Created apex design-engine deck');
    expect(() => new Function('Api', script)).not.toThrow();
  });
});

describe('premium deck collision QA', () => {
  it('does not report intended text-inside-card containment as a collision', () => {
    const docContent = { RemoveAllElements: vi.fn(), Push: vi.fn() };
    const createShape = () => ({ SetPosition: vi.fn(), GetDocContent: () => docContent });
    const slide = {
      RemoveAllObjects: vi.fn(),
      SetBackground: vi.fn(),
      AddObject: vi.fn(),
    };
    const presentation = {
      SetSizes: vi.fn(),
      GetSlidesCount: () => 1,
      RemoveSlides: vi.fn(),
      GetSlideByIndex: () => slide,
      AddSlide: vi.fn(),
    };
    const api = {
      GetPresentation: () => presentation,
      RGB: (red: number, green: number, blue: number) => ({ red, green, blue }),
      CreateSolidFill: (color: unknown) => ({ color }),
      CreateNoFill: () => ({}),
      CreateStroke: (width: number, fill: unknown) => ({ width, fill }),
      CreateShape: createShape,
      CreateParagraph: () => ({
        SetJc: vi.fn(),
        SetFontSize: vi.fn(),
        SetColor: vi.fn(),
        SetBold: vi.fn(),
        SetFontFamily: vi.fn(),
        AddText: vi.fn(),
      }),
      CreateSlide: () => slide,
    };
    const script = buildPremiumDeckScript({
      title: 'Three evidence signals',
      designStyle: 'minimal',
      theme: {
        primary: '#246BFD',
        secondary: '#10A37F',
        background: '#F7F8FA',
        text: '#121826',
        fontFamily: 'Aptos',
      },
      slides: [
        {
          title: 'Three evidence signals',
          bullets: ['Static analysis', 'Runtime validation', 'Reproducible demo'],
          layout: 'content',
        },
      ],
    });

    const output = JSON.parse(String(new Function('Api', script)(api))) as {
      qa: Array<{ collisions: number; score: number }>;
    };
    expect(output.qa).toEqual([{ slide: 1, score: 100, collisions: 0 }]);
  });
});

describe('premium deck append mode', () => {
  it('adds new slides without replacing the existing deck', () => {
    const script = buildPremiumDeckAppendScript({
      title: 'Agenda',
      designStyle: 'editorial',
      theme: {
        primary: '#246BFD',
        secondary: '#7C3AED',
        background: '#F7F8FA',
        text: '#172033',
        fontFamily: 'Arial',
      },
      slides: [
        {
          title: 'Agenda',
          bullets: [],
          layout: 'agenda',
          items: [{ label: 'Problem' }, { label: 'Solution' }, { label: 'Demo' }],
        },
      ],
    });

    expect(script).toContain('"mode":"append"');
    expect(script).toContain("const appendMode = buildOptions.mode === 'append'");
    expect(() => new Function('Api', script)).not.toThrow();
  });
});

describe('purposeful object animation scripts', () => {
  const animation = {
    slideIndex: 1,
    drawingName: 'Conclusion',
    effect: 'entranceFade' as const,
    trigger: 'onclick' as const,
    durationMs: 500,
    delayMs: 0,
    repeatCount: 1,
    order: 0,
    purpose: 'progressive-disclosure' as const,
    rationale: 'Reveal the conclusion after the evidence is explained.',
  };

  it('embeds its plan and uses ONLYOFFICE timeline APIs without captured state', () => {
    const applyScript = buildObjectAnimationsScript([animation], true);
    const reviewScript = buildObjectAnimationReviewScript();
    expect(applyScript).toContain('GetTimeLine');
    expect(applyScript).toContain('AddEffect');
    expect(applyScript).toContain('RemoveAllEffects');
    expect(applyScript).toContain('SetDuration');
    expect(applyScript).toContain('progressive-disclosure');
    expect(reviewScript).toContain('GetInteractiveSequences');
    expect(reviewScript).toContain('GetInternalId');
    expect(() => new Function('Api', applyScript)).not.toThrow();
    expect(() => new Function('Api', reviewScript)).not.toThrow();
  });

  it('turns a live timeline into a timing and density QA report', async () => {
    vi.mocked(runOfficeScript).mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        drawings: [{ slideIndex: 1, drawingIndex: 0, drawingName: 'Conclusion', classType: 'shape' }],
        effects: [
          {
            slideIndex: 1,
            sequenceType: 'main',
            drawingName: 'Conclusion',
            drawingId: '',
            effect: 'entranceFade',
            trigger: 'onclick',
            durationMs: 3000,
            delayMs: 2500,
            repeatCount: 3,
          },
        ],
      })
    );
    const result = await runTool('/deck.pptx', 'slide', {
      tool: 'review_object_animations',
      expectedAnimations: [animation],
    });
    expect(result.observation).toContain('Purposeful animation QA');
    expect(result.observation).toContain('duration should usually');
    expect(result.observation).toContain('delay above 2000');
    expect(result.observation).toContain('repeat count above 2');
  });
});

describe('parseAction', () => {
  it('accepts each valid tool shape', () => {
    expect(parseAction({ tool: 'read_document' })).toEqual({ tool: 'read_document' });
    expect(parseAction({ tool: 'replace_all', text: 'x' })).toEqual({ tool: 'replace_all', text: 'x' });
    expect(parseAction({ tool: 'search_replace', search: 'a', replace: 'b' })).toEqual({
      tool: 'search_replace',
      search: 'a',
      replace: 'b',
    });
    expect(parseAction({ tool: 'insert_text', text: 't' })).toEqual({ tool: 'insert_text', text: 't' });
    expect(parseAction({ tool: 'append_text', text: 't' })).toEqual({ tool: 'append_text', text: 't' });
    expect(parseAction({ tool: 'finish', summary: 's' })).toEqual({ tool: 'finish', summary: 's' });
  });

  it('accepts report structure, slide notes, transitions and visual review actions', () => {
    expect(
      parseAction({
        tool: 'structure_report',
        headings: [{ text: 'Architecture', level: 2 }],
        insertToc: true,
      })
    ).toEqual({
      tool: 'structure_report',
      headings: [{ text: 'Architecture', level: 2 }],
      insertToc: true,
    });
    expect(parseAction({ tool: 'add_speaker_notes', slideIndex: 2, text: 'Explain the trust boundary.' })).toEqual({
      tool: 'add_speaker_notes',
      slideIndex: 2,
      text: 'Explain the trust boundary.',
    });
    expect(parseAction({ tool: 'apply_slide_transitions', effect: 'fade' })).toEqual({
      tool: 'apply_slide_transitions',
      effect: 'fade',
      speed: 'medium',
    });
    expect(
      parseAction({
        tool: 'apply_object_animations',
        animations: [
          {
            slideIndex: 1,
            drawingName: 'Conclusion',
            effect: 'entranceFade',
            trigger: 'onclick',
            purpose: 'progressive-disclosure',
            rationale: 'Reveal the conclusion after the evidence is explained.',
          },
        ],
      })
    ).toMatchObject({
      tool: 'apply_object_animations',
      replaceExistingMainSequence: false,
      animations: [
        {
          durationMs: 500,
          delayMs: 0,
          repeatCount: 1,
          order: 0,
          purpose: 'progressive-disclosure',
        },
      ],
    });
    expect(parseAction({ tool: 'review_object_animations' })).toEqual({ tool: 'review_object_animations' });
    expect(parseAction({ tool: 'review_premium_quality' })).toEqual({ tool: 'review_premium_quality' });
    expect(parseAction({ tool: 'open_visual_review' })).toEqual({ tool: 'open_visual_review' });
  });

  it('rejects malformed or unknown actions', () => {
    expect(parseAction(null)).toBeNull();
    expect(parseAction({})).toBeNull();
    expect(parseAction({ tool: 'replace_all' })).toBeNull(); // missing text
    expect(parseAction({ tool: 'search_replace', search: 'a' })).toBeNull(); // missing replace
    expect(
      parseAction({
        tool: 'apply_object_animations',
        animations: [{ slideIndex: 0, drawingIndex: 0, effect: 'wrong', rationale: 'too short' }],
      })
    ).toBeNull();
    expect(parseAction({ tool: 'nope' })).toBeNull();
  });

  it('normalizes a premium doc plan for rich DOCX generation', () => {
    const action = parseAction({
      tool: 'create_premium_doc',
      plan: {
        title: ' Executive brief ',

        includeToc: true,
        theme: { primary: '0f62fe', background: 'bad-color' },
        sections: [
          {
            heading: 'Opportunity',
            body: ['Market is ready'],
            bullets: ['Fast adoption', 'Clear buyer'],
            callout: 'Prioritize enterprise segment',
            table: { headers: ['Metric', 'Value'], rows: [['Pipeline', '$2M']] },
          },
        ],
      },
    });

    expect(action).toMatchObject({
      tool: 'create_premium_doc',
      plan: {
        title: 'Executive brief',

        includeToc: true,
        theme: { primary: '#0F62FE', background: '#F7F8FA' },
        sections: [
          {
            heading: 'Opportunity',
            body: ['Market is ready'],
            bullets: ['Fast adoption', 'Clear buyer'],
            callout: 'Prioritize enterprise segment',
            table: { headers: ['Metric', 'Value'], rows: [['Pipeline', '$2M']] },
          },
        ],
      },
    });
  });

  it('rejects malformed premium doc plans', () => {
    expect(parseAction({ tool: 'create_premium_doc', plan: { title: '', sections: [] } })).toBeNull();
    expect(
      parseAction({ tool: 'create_premium_doc', plan: { title: 'x', sections: [{ body: ['missing heading'] }] } })
    ).toBeNull();
  });

  it('normalizes a premium deck plan for slide generation', () => {
    const action = parseAction({
      tool: 'create_premium_deck',
      plan: {
        title: ' Market launch ',

        designStyle: 'technical',
        theme: { primary: 'ff5500', background: 'bad-color' },
        slides: [
          { title: 'Cover', subtitle: 'North star', layout: 'cover', imageUrl: 'https://example.com/hero.png' },
          {
            title: 'Momentum',
            bullets: ['Revenue up', 'Pipeline deep'],
            layout: 'chart',
            chartValues: [[25, 55, 90]],
            chartLabels: ['Q1', 'Q2', 'Q3'],
            source: 'MODEL_VALIDATION_REPORT.md',
            speakerNotes: 'Explain the validation split.',
            transition: 'fade',
          },
        ],
      },
    });

    expect(action).toMatchObject({
      tool: 'create_premium_deck',
      plan: {
        title: 'Market launch',

        designStyle: 'technical',
        theme: { primary: '#FF5500', background: '#F7F8FA' },
        slides: [
          { title: 'Cover', layout: 'cover', imageUrl: 'https://example.com/hero.png' },
          {
            title: 'Momentum',
            layout: 'chart',
            bullets: ['Revenue up', 'Pipeline deep'],
            chartValues: [[25, 55, 90]],
            chartLabels: ['Q1', 'Q2', 'Q3'],
            source: 'MODEL_VALIDATION_REPORT.md',
            speakerNotes: 'Explain the validation split.',
            transition: 'fade',
          },
        ],
      },
    });
  });

  it('rejects malformed premium deck plans', () => {
    expect(parseAction({ tool: 'create_premium_deck', plan: { title: '', slides: [] } })).toBeNull();
    expect(
      parseAction({ tool: 'create_premium_deck', plan: { title: 'x', slides: [{ subtitle: 'missing title' }] } })
    ).toBeNull();
  });

  it('accepts bounded Office API scripts and trims whitespace', () => {
    expect(
      parseAction({ tool: 'run_office_api', code: "  const doc = Api.GetDocument(); return doc ? 'ok' : 'missing';  " })
    ).toEqual({
      tool: 'run_office_api',
      code: "const doc = Api.GetDocument(); return doc ? 'ok' : 'missing';",
    });
    expect(
      parseAction({
        tool: 'run_office_api',
        code: 'const document = Api.GetDocument(); return document ? "ok" : "missing";',
      })
    ).toEqual({
      tool: 'run_office_api',
      code: 'const document = Api.GetDocument(); return document ? "ok" : "missing";',
    });
  });

  it('rejects Office API scripts that leave the document-builder boundary', () => {
    expect(parseAction({ tool: 'run_office_api', code: 'return fetch(https://example.com)' })).toBeNull();
    expect(parseAction({ tool: 'run_office_api', code: 'return window.localStorage.getItem(x)' })).toBeNull();
    expect(parseAction({ tool: 'run_office_api', code: 'return require(node:fs)' })).toBeNull();
    expect(parseAction({ tool: 'run_office_api', code: 'return ' + 'x'.repeat(8100) })).toBeNull();
  });
  it('defaults finish summary to empty string when absent', () => {
    expect(parseAction({ tool: 'finish' })).toEqual({ tool: 'finish', summary: '' });
  });
});

describe('extractActionJson', () => {
  it('extracts a bare JSON object', () => {
    expect(extractActionJson('{"tool":"read_document"}')).toEqual({ tool: 'read_document' });
  });

  it('extracts from a fenced ```json block', () => {
    const reply = 'Sure!\n```json\n{"tool":"insert_text","text":"hi"}\n```\n';
    expect(extractActionJson(reply)).toEqual({ tool: 'insert_text', text: 'hi' });
  });

  it('tolerates trailing prose after the object', () => {
    expect(extractActionJson('{"tool":"finish","summary":"ok"} done')).toEqual({ tool: 'finish', summary: 'ok' });
  });

  it('returns null when no JSON is present', () => {
    expect(extractActionJson('no json here')).toBeNull();
  });
});

describe('runTool', () => {
  it('finishes the loop on finish', async () => {
    const r = await runTool('/f.docx', 'word', { tool: 'finish', summary: 'all done' });
    expect(r.done).toBe(true);
    expect(r.observation).toBe('all done');
  });

  it('reads document text', async () => {
    const r = await runTool('/f.docx', 'word', { tool: 'read_document' });
    expect(r.done).toBe(false);
    expect(r.observation).toContain('hello world');
  });

  it('blocks tools not allowed for the document kind', async () => {
    // replace_all is Word-only; reject for a spreadsheet.
    const r = await runTool('/f.xlsx', 'cell', { tool: 'replace_all', text: 'x' });
    expect(r.done).toBe(false);
    expect(r.observation).toMatch(/not available/i);
  });

  it('runs an allowed write tool', async () => {
    const r = await runTool('/f.docx', 'word', { tool: 'append_text', text: 'p' });
    expect(r.done).toBe(false);
    expect(r.observation).toMatch(/appended/i);
  });

  it('blocks a weak full-deck plan before mutating the live editor', async () => {
    vi.mocked(runOfficeScript).mockClear();
    const weakPlan: PremiumDeckPlan = {
      ...strongDeckPlan(),
      slides: [{ title: 'Only slide', bullets: [], layout: 'content' }],
    };

    const result = await runTool('/deck.pptx', 'slide', { tool: 'create_premium_deck', plan: weakPlan });

    expect(result.observation).toContain('Deck preflight blocked');
    expect(runOfficeScript).not.toHaveBeenCalled();
  });

  it('builds an evidence-led full deck after preflight passes', async () => {
    vi.mocked(runOfficeScript).mockResolvedValueOnce('deck-created');
    const result = await runTool('/deck.pptx', 'slide', {
      tool: 'create_premium_deck',
      plan: strongDeckPlan(),
    });

    expect(result.observation).toContain('deck-created');
    expect(runOfficeScript).toHaveBeenCalledWith('/deck.pptx', expect.stringContaining('pres.RemoveSlides'));
  });

  it('appends a structured agenda slide without replacing existing slides', async () => {
    vi.mocked(runOfficeScript).mockResolvedValueOnce('slide-appended');
    const plan: PremiumDeckPlan = {
      ...strongDeckPlan(),
      slides: [
        {
          title: 'Agenda',
          bullets: [],
          layout: 'agenda',
          items: [{ label: 'Problem' }, { label: 'Solution' }, { label: 'Demo' }],
        },
      ],
    };
    const result = await runTool('/deck.pptx', 'slide', { tool: 'add_premium_slide', plan });

    expect(result.observation).toContain('slide-appended');
    const appendedScript = vi.mocked(runOfficeScript).mock.calls.at(-1)?.[1] ?? '';
    expect(appendedScript).toContain(JSON.stringify({ mode: 'append' }));
  });

  it('structures a report and inserts an automatic TOC in one action', async () => {
    vi.mocked(applyHeadings).mockClear();
    vi.mocked(insertTableOfContents).mockClear();
    const result = await runTool('/report.docx', 'word', {
      tool: 'structure_report',
      headings: [{ text: 'Architecture', level: 2 }],
      insertToc: true,
    });

    expect(result.observation).toContain('automatic TOC');
    expect(applyHeadings).toHaveBeenCalledWith('/report.docx', [{ text: 'Architecture', level: 2 }]);
    expect(insertTableOfContents).toHaveBeenCalledWith('/report.docx', true);
  });

  it('audits premium slide quality with live visual metadata', async () => {
    vi.mocked(runOfficeScript).mockResolvedValueOnce(
      JSON.stringify({ slideCount: 4, drawingCount: 16, textBoxCount: 9, imageLikeCount: 2, avgDrawingsPerSlide: 4 })
    );
    const r = await runTool('/deck.pptx', 'slide', { tool: 'review_premium_quality' });

    expect(r.done).toBe(false);
    expect(r.observation).toContain('Premium quality audit (slide)');
    expect(r.observation).toContain('Visual object summary');
    expect(r.observation).toContain('16 drawing object(s)');
    expect(runOfficeScript).toHaveBeenCalledWith('/deck.pptx', expect.stringContaining('GetAllDrawings'));
  });

  it('runs a bounded Office API script', async () => {
    vi.mocked(runOfficeScript).mockClear();
    const r = await runTool('/f.docx', 'word', { tool: 'run_office_api', code: ' return Api.GetDocument(); ' });
    expect(r.done).toBe(false);
    expect(r.observation).toContain('script-result');
    expect(runOfficeScript).toHaveBeenCalledWith('/f.docx', 'return Api.GetDocument();');
  });

  it('returns an error observation when an Office API script stalls', async () => {
    vi.useFakeTimers();
    vi.mocked(runOfficeScript).mockImplementationOnce(() => new Promise<string>(() => {}));

    try {
      const pending = runTool('/f.docx', 'word', { tool: 'run_office_api', code: 'return Api.GetDocument();' });
      await vi.advanceTimersByTimeAsync(12000);
      const r = await pending;

      expect(r.done).toBe(false);
      expect(r.observation).toMatch(/timed out after 12s/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects unsafe Office API scripts before they reach the connector', async () => {
    vi.mocked(runOfficeScript).mockClear();
    const r = await runTool('/f.docx', 'word', {
      tool: 'run_office_api',
      code: 'return fetch(https://example.com)',
    });
    expect(r.done).toBe(false);
    expect(r.observation).toMatch(/rejected/i);
    expect(runOfficeScript).not.toHaveBeenCalled();
  });
});
