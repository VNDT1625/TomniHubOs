import { describe, expect, it, vi } from 'vitest';
import { createTerminalSecretPort } from '@process/resources/sessionSecrets/terminalSecretPort';

const setup = (initial = ['term-1']) => {
  let open = [...initial];
  const write = vi.fn();
  const ask = vi.fn(async (_terminalId: string) => true);
  const port = createTerminalSecretPort({
    list: () => open.map((id) => ({ id })),
    write,
    ask,
  });
  return {
    port,
    write,
    ask,
    close: (id: string) => (open = open.filter((item) => item !== id)),
    open: (id: string) => open.push(id),
  };
};

describe('terminal secret port', () => {
  it('knows only the terminals that are open', () => {
    const { port, close } = setup();
    expect(port.exists('term-1')).toBe(true);
    expect(port.exists('term-2')).toBe(false);
    close('term-1');
    expect(port.exists('term-1')).toBe(false);
  });

  it('asks the person once per terminal and remembers an approval', async () => {
    const { port, ask } = setup();
    expect(await port.confirm('term-1')).toBe(true);
    expect(await port.confirm('term-1')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('does not remember a refusal', async () => {
    const { port, ask } = setup();
    ask.mockResolvedValueOnce(false);
    expect(await port.confirm('term-1')).toBe(false);
    expect(await port.confirm('term-1')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('never approves a terminal that is not open, and does not ask', async () => {
    const { port, ask } = setup();
    expect(await port.confirm('missing')).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('forgets an approval when the terminal closes, so a new terminal with that id asks again', async () => {
    const { port, ask, close, open } = setup();
    await port.confirm('term-1');
    close('term-1');
    expect(port.exists('term-1')).toBe(false);
    open('term-1');
    await port.confirm('term-1');
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('writes straight to the terminal', () => {
    const { port, write } = setup();
    port.write('term-1', 'typed');
    expect(write).toHaveBeenCalledWith('term-1', 'typed');
  });
});
