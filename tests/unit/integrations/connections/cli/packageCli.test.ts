/* oxlint-disable no-await-in-loop -- the steps of one scenario must run in order */
import { describe, expect, it, vi } from 'vitest';

import {
  cliCommandLine,
  findCliArgumentProblem,
  isTypeableCommandLine,
  PACKAGE_CLI_MAX_ARGUMENTS,
  PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL,
  terminalCliEntriesOf,
} from '@/common/integrations/cli/packageCli';
import {
  createPackageCliClient,
  TERMINAL_CREATE_CHANNEL,
  TERMINAL_WRITE_CHANNEL,
  type PackageCliClientPorts,
} from '@/common/integrations/cli/packageCliClient';
import { TERMINAL_CHANNELS } from '@process/ideTerminal/terminalBridge';

describe('findCliArgumentProblem', () => {
  it('accepts plain tokens, flags, relative paths and --flag=value', () => {
    expect(
      findCliArgumentProblem(['docs', '-v', '--help', 'src/index.ts', './a.txt', '--out=build/x', 'a@1.2.3', 'x,y'])
    ).toBeUndefined();
    expect(findCliArgumentProblem([])).toBeUndefined();
  });

  it.each([
    ['a semicolon', 'a;rm'],
    ['a pipe', 'a|b'],
    ['an ampersand', 'a&b'],
    ['a dollar', '$HOME'],
    ['a backtick', '`id`'],
    ['a space', 'a b'],
    ['a double quote', '"a"'],
    ['a single quote', "'a'"],
    ['a redirect', '>out'],
    ['a percent', '%PATH%'],
    ['a caret', 'a^b'],
    ['a backslash', 'a\\b'],
    ['a line break', 'a\nb'],
    ['a NUL', 'a\u0000b'],
    ['an empty text', ''],
  ])('refuses %s', (_name, argument) => {
    expect(findCliArgumentProblem([argument])).toMatchObject({ index: 0 });
  });

  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a UNC path', '//host/share'],
    ['a drive path', 'C:/Windows/system.ini'],
    ['the home folder', '~/secrets'],
    ['a parent folder', '../outside'],
    ['a nested parent folder', 'a/../../b'],
    ['a flag value that is absolute', '--out=/etc/x'],
    ['a flag value that climbs out', '--config=../../x'],
    ['a short flag value that is a drive', '-o=D:/x'],
  ])('keeps a path inside the workspace: refuses %s', (_name, argument) => {
    expect(findCliArgumentProblem([argument])).toMatchObject({ reason: 'a path must stay inside the workspace' });
  });

  it('refuses too many and too long arguments, and anything that is not a text', () => {
    expect(findCliArgumentProblem(Array.from({ length: PACKAGE_CLI_MAX_ARGUMENTS + 1 }, () => 'a'))).toMatchObject({
      index: PACKAGE_CLI_MAX_ARGUMENTS,
    });
    expect(findCliArgumentProblem(Array.from({ length: PACKAGE_CLI_MAX_ARGUMENTS }, () => 'a'))).toBeUndefined();
    expect(findCliArgumentProblem(['a'.repeat(201)])).toMatchObject({ index: 0 });
    expect(findCliArgumentProblem(['a'.repeat(200)])).toBeUndefined();
    expect(findCliArgumentProblem([1])).toMatchObject({ index: 0 });
    expect(findCliArgumentProblem([null])).toMatchObject({ index: 0 });
    expect(findCliArgumentProblem([['a']])).toMatchObject({ index: 0 });
  });

  it('reports the position of the first bad argument', () => {
    expect(findCliArgumentProblem(['ok', 'also-ok', 'bad one'])).toMatchObject({ index: 2 });
  });
});

describe('command lines', () => {
  it('joins the program and its tokens on one line', () => {
    expect(cliCommandLine('ctx7', ['docs', '--lang=en'])).toBe('ctx7 docs --lang=en');
    expect(cliCommandLine('ctx7', [])).toBe('ctx7');
  });

  it('is only typeable when it is one printable line', () => {
    expect(isTypeableCommandLine('ctx7 docs')).toBe(true);
    for (const line of ['', 'a\nb', 'a\rb', 'a\u0003b', 'a\u001bb', 'a\u007fb', 'a'.repeat(1001)]) {
      expect(isTypeableCommandLine(line)).toBe(false);
    }
  });
});

const view = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind: key.split(':')[0] ?? '',
  title: 'T',
  enabled: true,
  status: 'on' as const,
  ...extra,
});

describe('terminalCliEntriesOf', () => {
  it('lists only cli connections that are on and healthy, by ids', () => {
    const entries = terminalCliEntriesOf('com.x.y', [
      view('cli:ctx7', { title: 'Context7' }),
      view('cli:off', { enabled: false, status: 'off' }),
      view('cli:broken', { status: 'error' }),
      view('tool:fmt'),
      view('web-embed:app'),
      view('cli:Bad_Id'),
      view('cli:'),
    ]);
    expect(entries).toEqual([
      { id: 'com.x.y\u0000ctx7', packageId: 'com.x.y', connectionId: 'ctx7', title: 'Context7' },
    ]);
  });
});

describe('Terminal channel names', () => {
  it('mirror the Main terminal bridge so the renderer needs no Node-only import', () => {
    expect(TERMINAL_CREATE_CHANNEL).toBe(TERMINAL_CHANNELS.create);
    expect(TERMINAL_WRITE_CHANNEL).toBe(TERMINAL_CHANNELS.write);
    expect(PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL).toBe('package-cli.terminal-launch');
  });
});

describe('openInTerminal', () => {
  const makePorts = (overrides: Partial<Record<keyof PackageCliClientPorts, unknown>> = {}) => {
    const launch = vi.fn(async () => ({ ok: true as const, title: 'Context7', commandLine: 'ctx7 docs' }));
    const create = vi.fn(async () => ({ ok: true as const, data: { id: 'term-1' } }));
    const write = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const ports = {
      launch: { invoke: overrides['launch'] ?? launch },
      create: { invoke: overrides['create'] ?? create },
      write: { invoke: overrides['write'] ?? write },
    } as unknown as PackageCliClientPorts;
    return { ports, launch, create, write };
  };

  it('sends ids only, opens a session and types the line without a line break', async () => {
    const fake = makePorts();
    const result = await createPackageCliClient(fake.ports).openInTerminal(
      { packageId: 'com.x.y', connectionId: 'ctx7' },
      { cwd: 'C:\\work' }
    );
    expect(result).toEqual({ ok: true, sessionId: 'term-1' });
    expect(fake.launch).toHaveBeenCalledWith({ packageId: 'com.x.y', connectionId: 'ctx7' });
    expect(fake.create).toHaveBeenCalledWith({ options: { title: 'Context7', cwd: 'C:\\work' } });
    expect(fake.write).toHaveBeenCalledTimes(1);
    const typed = String((fake.write.mock.calls as unknown as Array<[{ data: string }]>)[0]?.[0].data);
    expect(typed).toBe('ctx7 docs');
    // Never run: no Enter, no control character.
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what must be absent.
    expect(typed).not.toMatch(/[\r\n\u0000-\u001f]/u);
  });

  it('drops anything but the two ids from the request it sends', async () => {
    const fake = makePorts();
    await createPackageCliClient(fake.ports).openInTerminal({
      packageId: 'com.x.y',
      connectionId: 'ctx7',
      command: 'calc',
    } as never);
    expect(fake.launch).toHaveBeenCalledWith({ packageId: 'com.x.y', connectionId: 'ctx7' });
  });

  it('passes the stable codes of Main through and opens nothing', async () => {
    for (const error of ['INVALID_REQUEST', 'NOT_ENABLED', 'UNAVAILABLE'] as const) {
      const fake = makePorts({ launch: vi.fn(async () => ({ ok: false as const, error })) });
      expect(await createPackageCliClient(fake.ports).openInTerminal({ packageId: 'a', connectionId: 'b' })).toEqual({
        ok: false,
        error,
      });
      expect(fake.create).not.toHaveBeenCalled();
      expect(fake.write).not.toHaveBeenCalled();
    }
  });

  it('refuses a line that would press Enter even if Main sent one', async () => {
    const fake = makePorts({
      launch: vi.fn(async () => ({ ok: true as const, title: 'x', commandLine: 'ctx7 docs\r\ncalc' })),
    });
    expect(await createPackageCliClient(fake.ports).openInTerminal({ packageId: 'a', connectionId: 'b' })).toEqual({
      ok: false,
      error: 'UNAVAILABLE',
    });
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });

  it('reports a terminal that could not be opened or typed into, and never rejects', async () => {
    const noSession = makePorts({ create: vi.fn(async () => ({ ok: false as const, error: 'boom' })) });
    expect(await createPackageCliClient(noSession.ports).openInTerminal({ packageId: 'a', connectionId: 'b' })).toEqual(
      { ok: false, error: 'TERMINAL_FAILED' }
    );
    const noTyping = makePorts({ write: vi.fn(async () => ({ ok: false as const, error: 'boom' })) });
    expect(await createPackageCliClient(noTyping.ports).openInTerminal({ packageId: 'a', connectionId: 'b' })).toEqual({
      ok: false,
      error: 'TERMINAL_FAILED',
    });
    const throwing = makePorts({
      launch: vi.fn(async () => {
        throw new Error('channel closed');
      }),
    });
    expect(await createPackageCliClient(throwing.ports).openInTerminal({ packageId: 'a', connectionId: 'b' })).toEqual({
      ok: false,
      error: 'UNAVAILABLE',
    });
  });

  it('gives up on a provider that never answers', async () => {
    vi.useFakeTimers();
    try {
      const fake = makePorts({ launch: vi.fn(() => new Promise(() => undefined)) });
      const pending = createPackageCliClient(fake.ports).openInTerminal(
        { packageId: 'a', connectionId: 'b' },
        { timeoutMs: 50 }
      );
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toEqual({ ok: false, error: 'UNAVAILABLE' });
    } finally {
      vi.useRealTimers();
    }
  });
});
