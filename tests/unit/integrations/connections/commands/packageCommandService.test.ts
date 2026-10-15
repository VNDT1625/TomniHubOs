import { describe, expect, it } from 'vitest';
import {
  RESERVED_SLASH_NAMES,
  applyPackageCommandToModelInput,
  createPackageCommandService,
} from '@process/integrations/connections/commands/packageCommandService';
import { BUILTIN_SLASH_ITEMS } from '@/renderer/utils/chat/commandPalette';

describe('applyPackageCommandToModelInput', () => {
  it('sends only the filled template when the renderer built no model_input (the bubble keeps the typed line)', () => {
    expect(applyPackageCommandToModelInput('/fix 1', undefined, 'Fix issue 1')).toBe('Fix issue 1');
  });

  it('replaces the typed line inside a model_input built around it, keeping attachments', () => {
    const modelInput = '/fix 1\n\n[attached: notes.md]\nbody of notes';
    expect(applyPackageCommandToModelInput('/fix 1', modelInput, 'Fix issue 1')).toBe(
      'Fix issue 1\n\n[attached: notes.md]\nbody of notes'
    );
  });

  it('puts the template in front when the typed line is not found in model_input', () => {
    expect(applyPackageCommandToModelInput('/fix 1', 'other text', 'Fix issue 1')).toBe('Fix issue 1\n\nother text');
  });

  it('reads $ sequences in the template as text', () => {
    expect(applyPackageCommandToModelInput('/x', '/x', "cost $& $' $1")).toBe("cost $& $' $1");
  });
});

describe('RESERVED_SLASH_NAMES', () => {
  it('covers every slash word the home palette already offers, so none can be shadowed by a package', () => {
    for (const item of BUILTIN_SLASH_ITEMS) expect(RESERVED_SLASH_NAMES.has(item.key)).toBe(true);
  });
});

describe('createPackageCommandService on a lazy registry', () => {
  it('does not touch the registry for a built-in word or plain text', async () => {
    let reads = 0;
    const service = createPackageCommandService(async () => {
      reads += 1;
      return { enabledOfKind: async () => [] };
    });
    expect(await service.expand('/boost think about it')).toBeUndefined();
    expect(await service.expand('/repotopackage .')).toBeUndefined();
    expect(await service.expand('no slash')).toBeUndefined();
    expect(reads).toBe(0);
    expect(await service.expand('/custom')).toBeUndefined();
    expect(reads).toBe(1);
  });
});
