import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SLASH_ITEMS,
  filterPaletteItems,
  getActivePaletteQuery,
  paletteSlashCommands,
} from '@/renderer/utils/chat/commandPalette';

describe('the shared command catalog', () => {
  it('offers the chat page every command the home page offers, with the same insert text', () => {
    const commands = paletteSlashCommands();
    expect(commands.map((command) => command.name)).toEqual(BUILTIN_SLASH_ITEMS.map((item) => item.key));
    for (const command of commands) {
      const item = BUILTIN_SLASH_ITEMS.find((candidate) => candidate.key === command.name);
      expect(command.insertText).toBe(item?.insertText ?? `${item?.label} `);
      expect(command.selectionBehavior).toBe('insert');
    }
  });

  it('has unique command names', () => {
    const names = BUILTIN_SLASH_ITEMS.map((item) => item.key);
    expect(new Set(names).size).toBe(names.length);
  });

  it('finds a token anywhere in the message and filters by what follows the prefix', () => {
    const value = 'summarise *sli';
    const query = getActivePaletteQuery(value, value.length);
    expect(query).toMatchObject({ prefix: '*', query: 'sli' });
    expect(filterPaletteItems('*', 'sli').map((item) => item.key)).toEqual(['slide-deck']);
    expect(getActivePaletteQuery('2 * 3', 4)).toBeNull();
  });
});
