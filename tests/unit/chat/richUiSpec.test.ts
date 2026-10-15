import { describe, expect, it } from 'vitest';
import { parseRichUiSpec } from '@/renderer/components/Markdown/richUi/richUiSpec';

const valid = {
  version: 1,
  title: 'MCP pipeline',
  fallbackText: 'ChatGPT > gateway > tools',
  blocks: [
    { type: 'metrics', items: [{ label: 'Latency', value: '2.5s' }] },
    {
      type: 'flow',
      steps: [{ title: 'ChatGPT' }, { title: 'Gateway', parallel: ['Read', 'Search'] }, { title: 'Results' }],
    },
    { type: 'cards', items: [{ title: 'Read', description: 'File operations' }] },
    { type: 'table', columns: ['Tool', 'Time'], rows: [['Read', '1.6s']] },
  ],
};

describe('schema-validated rich message blocks', () => {
  it('accepts all supported display-only blocks and preserves fallback text', () => {
    const parsed = parseRichUiSpec(JSON.stringify(valid));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.spec.blocks).toHaveLength(4);
      expect(parsed.spec.fallbackText).toBe('ChatGPT > gateway > tools');
    }
  });

  it('rejects unknown blocks but keeps an accessible text fallback', () => {
    const parsed = parseRichUiSpec(JSON.stringify({ ...valid, blocks: [{ type: 'execute', command: 'rm -rf' }] }));
    expect(parsed).toEqual({ ok: false, fallbackText: valid.fallbackText });
  });

  it('rejects malformed, oversized, unsupported and empty components', () => {
    expect(parseRichUiSpec('{broken').ok).toBe(false);
    expect(parseRichUiSpec('x'.repeat(24_001)).ok).toBe(false);
    expect(parseRichUiSpec(JSON.stringify({ ...valid, version: 2 })).ok).toBe(false);
    expect(parseRichUiSpec(JSON.stringify({ ...valid, blocks: [] })).ok).toBe(false);
    expect(
      parseRichUiSpec(JSON.stringify({ ...valid, blocks: [{ type: 'flow', steps: [{ title: 'Only one' }] }] })).ok
    ).toBe(false);
  });

  it('limits block data and projects away unknown markup and event properties', () => {
    const withExtras = {
      ...valid,
      onclick: 'alert(1)',
      blocks: [
        {
          type: 'cards',
          items: [{ title: '<script>alert(1)</script>', description: 'safe', html: '<img onerror=alert(1)>' }],
        },
      ],
    };
    const parsed = parseRichUiSpec(JSON.stringify(withExtras));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.spec).not.toHaveProperty('onclick');
      expect(parsed.spec.blocks[0]).not.toHaveProperty('html');
      expect(parsed.spec.blocks[0]).toEqual({
        type: 'cards',
        items: [{ title: '<script>alert(1)</script>', description: 'safe' }],
      });
    }
  });

  it('validates interactive lessons without accepting executable code', () => {
    const parsed = parseRichUiSpec(
      JSON.stringify({
        ...valid,
        blocks: [
          {
            type: 'lesson',
            slides: [
              { title: 'One', body: 'Question', reveal: 'Answer', onclick: 'run()' },
              { title: 'Two', body: 'Question' },
            ],
          },
        ],
      })
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.spec.blocks[0].type === 'lesson') {
      expect(parsed.spec.blocks[0].slides[0]).toEqual({ title: 'One', body: 'Question', reveal: 'Answer' });
    }
    expect(
      parseRichUiSpec(
        JSON.stringify({ ...valid, blocks: [{ type: 'lesson', slides: [{ title: 'Too few', body: 'No' }] }] })
      ).ok
    ).toBe(false);
  });

  it('validates quiz data and never accepts JavaScript callbacks or invalid answer indices', () => {
    const validSlide = {
      title: 'Quiz',
      body: 'Question',
      question: 'Which is correct?',
      options: ['First', 'Second', 'Third', 'Fourth'],
      correctIndex: 2,
      onClick: 'alert(1)',
    };
    const slides = [validSlide, { title: 'Finish', body: 'Done' }];
    const parsed = parseRichUiSpec(JSON.stringify({ ...valid, blocks: [{ type: 'lesson', slides }] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.spec.blocks[0].type === 'lesson') {
      expect(parsed.spec.blocks[0].slides[0]).not.toHaveProperty('onClick');
      expect(parsed.spec.blocks[0].slides[0].correctIndex).toBe(2);
    }
    const fails = [
      { ...validSlide, correctIndex: 4 },
      { ...validSlide, correctIndex: -1 },
      { ...validSlide, correctIndex: 1.5 },
      { ...validSlide, allowTextAnswer: true },
      { ...validSlide, options: ['Only one'] },
    ];
    for (const slide of fails) {
      expect(
        parseRichUiSpec(JSON.stringify({ ...valid, blocks: [{ type: 'lesson', slides: [slide, slides[1]] }] })).ok
      ).toBe(false);
    }
    expect(
      parseRichUiSpec(
        JSON.stringify({
          ...valid,
          blocks: [
            {
              type: 'lesson',
              slides: [
                { title: 'Free', body: 'x', question: 'Answer?', allowTextAnswer: true },
                { title: 'Done', body: 'y' },
              ],
            },
          ],
        })
      ).ok
    ).toBe(true);
  });

  it('accepts only semantic accent tones and drops arbitrary styling', () => {
    const parsed = parseRichUiSpec(
      JSON.stringify({
        ...valid,
        blocks: [
          {
            type: 'cards',
            items: [
              { title: 'Good', description: 'Safe', tone: 'success' },
              { title: 'Unsafe', description: 'Safe', tone: 'rgb(0,0,0)', style: 'position: fixed' },
            ],
          },
        ],
      })
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.spec.blocks[0].type === 'cards') {
      expect(parsed.spec.blocks[0].items[0].tone).toBe('success');
      expect(parsed.spec.blocks[0].items[1].tone).toBeUndefined();
      expect(parsed.spec.blocks[0].items[1]).not.toHaveProperty('style');
    }
  });

  it('requires meaningful fallback text and rejects mismatched table widths', () => {
    expect(parseRichUiSpec(JSON.stringify({ ...valid, fallbackText: '' })).ok).toBe(false);
    expect(
      parseRichUiSpec(JSON.stringify({ ...valid, blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['x']] }] })).ok
    ).toBe(false);
  });
});
