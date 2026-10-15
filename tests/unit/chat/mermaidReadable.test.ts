import { describe, expect, it } from 'vitest';
import { withResponsiveSvg } from '@/renderer/components/Markdown/MermaidBlock';

describe('Mermaid readable sizing', () => {
  it('preserves readable intrinsic width for complex diagrams instead of shrinking text', () => {
    const svg = '<svg viewBox="0 0 1800 800" style="color:red"><text>Gateway</text></svg>';
    const result = withResponsiveSvg(svg);
    expect(result).toContain('width:1800px;max-width:none');
    expect(result).toContain('color:red');
  });
  it('fits compact diagrams within chat', () => {
    expect(withResponsiveSvg('<svg viewBox="0 0 420 280"></svg>')).toContain('max-width:100%');
  });
});
