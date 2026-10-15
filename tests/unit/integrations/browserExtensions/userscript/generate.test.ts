import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { inspectManifest } from '@process/integrations/browserExtensions/manifest';
import { generateUserscriptExtension } from '@process/integrations/browserExtensions/userscript/generate';
import { resolveConnects } from '@process/integrations/browserExtensions/userscript/gmGrants';
import { stageGeneratedExtension } from '@process/integrations/browserExtensions/userscript/stage';
import { USERSCRIPT_LIMITS } from '@process/integrations/browserExtensions/userscript/types';
import { generateExtensionKey, prepareWorkingCopy } from '@process/integrations/browserExtensions/workingCopy';
import { useTempRoots } from '../extensionFixture';

const temp = useTempRoots();

const script = (lines: string[], body = 'window.__ran = true;'): string =>
  ['// ==UserScript==', ...lines.map((line) => `// ${line}`), '// ==/UserScript==', body].join('\n');

const generate = (source: string, localFiles?: ReadonlyMap<string, string>) => {
  const result = generateUserscriptExtension({ source, ...(localFiles ? { localFiles } : {}) });
  if (result.ok === false) throw new Error(`unexpected failure ${result.code}: ${result.reason}`);
  return result;
};
const fileOf = (result: ReturnType<typeof generate>, name: string): string => {
  const file = result.files.find((candidate) => candidate.path === name);
  if (!file) throw new Error(`missing ${name}`);
  return file.content;
};
const contentScript = (result: ReturnType<typeof generate>): Record<string, unknown> =>
  (result.manifest.content_scripts as Record<string, unknown>[])[0] as Record<string, unknown>;

describe('userscript to extension', () => {
  it('turns a plain @grant none script into a page-world content script with the original source', () => {
    const source = script([
      '@name Plain',
      '@version 1.0',
      '@match https://a.example/*',
      '@run-at document-start',
      '@grant none',
      '@noframes',
    ]);
    const result = generate(source);
    expect(result.world).toBe('MAIN');
    expect(result.manifest).toMatchObject({ manifest_version: 3, name: 'Plain', version: '1.0' });
    expect(contentScript(result)).toEqual({
      matches: ['https://a.example/*'],
      js: ['userscript.js'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    });
    expect(result.files.map((file) => file.path)).toEqual(['manifest.json', 'userscript.js']);
    expect(fileOf(result, 'userscript.js')).toBe(source);
    expect(result.manifest.permissions).toBeUndefined();
    expect(result.manifest.background).toBeUndefined();
  });

  it('maps @run-at and falls back to document_idle with a note for the others', () => {
    for (const [value, expected] of [
      ['document-start', 'document_start'],
      ['document-end', 'document_end'],
      ['document-idle', 'document_idle'],
    ] as const) {
      expect(contentScript(generate(script(['@match *://*/*', `@run-at ${value}`]))).run_at).toBe(expected);
    }
    const odd = generate(script(['@match *://*/*', '@run-at context-menu']));
    expect(contentScript(odd).run_at).toBe('document_idle');
    expect(odd.notes.map((note) => note.code)).toContain('run-at-unsupported');
    expect(contentScript(generate(script(['@match *://*/*']))).all_frames).toBe(true);
  });

  it('passes the generated manifest through inspectManifest', () => {
    const result = generate(
      script([
        '@name N',
        '@match https://a.example/*',
        '@grant GM_setValue',
        '@grant GM_xmlhttpRequest',
        '@connect api.example.com',
      ])
    );
    const verdict = inspectManifest(JSON.parse(fileOf(result, 'manifest.json')));
    expect(verdict).toMatchObject({
      ok: true,
      summary: {
        manifestVersion: 3,
        hasBackground: true,
        permissions: ['storage'],
        hostPermissions: ['*://api.example.com/*', '*://*.api.example.com/*'],
        contentScriptMatches: ['https://a.example/*'],
      },
    });
    expect(result.summary).toEqual((verdict as { summary: unknown }).summary);
  });

  it('provides only the granted GM functions and runs them in the isolated world', () => {
    const result = generate(
      script([
        '@match https://a.example/*',
        '@grant GM_getValue',
        '@grant GM_setValue',
        '@grant GM_info',
        '@grant GM_openInTab',
        '@grant GM.getValue',
      ])
    );
    expect(result.world).toBe('ISOLATED');
    expect(result.grants).toEqual(['GM_getValue', 'GM_setValue', 'GM_info']);
    expect(result.manifest.permissions).toEqual(['storage']);
    expect(result.notes.filter((note) => note.code === 'grant-unsupported')).toHaveLength(2);
    expect(contentScript(result).world).toBe('ISOLATED');
    expect(result.files.map((file) => file.path)).not.toContain('gm-background.js');
  });

  it('requests clipboardWrite only for GM_setClipboard', () => {
    expect(generate(script(['@match *://*/*', '@grant GM_setClipboard'])).manifest.permissions).toEqual([
      'clipboardWrite',
    ]);
    expect(generate(script(['@match *://*/*', '@grant GM_addStyle GM_log'])).manifest.permissions).toBeUndefined();
  });

  it('needs @connect for GM_xmlhttpRequest and never widens to all hosts', () => {
    const without = generate(script(['@match *://*/*', '@grant GM_xmlhttpRequest']));
    expect(without.grants).not.toContain('GM_xmlhttpRequest');
    expect(without.world).toBe('MAIN');
    expect(without.manifest.host_permissions).toBeUndefined();
    expect(without.notes.map((note) => note.code)).toContain('xhr-needs-connect');

    const wildcard = generate(script(['@match *://*/*', '@grant GM_xmlhttpRequest', '@connect *']));
    expect(wildcard.grants).toEqual([]);
    expect(wildcard.notes.map((note) => note.code)).toEqual(
      expect.arrayContaining(['connect-unsupported', 'xhr-needs-connect'])
    );
  });

  it('keeps @connect hosts public: no local names, private or loopback addresses, IPv6 or wildcards', () => {
    const plan = resolveConnects([
      'API.Example.com.',
      'localhost',
      'printer.local',
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.9',
      '172.20.0.1',
      '169.254.1.1',
      '[::1]',
      'self',
      '*',
      'bad host',
      '8.8.8.8',
      'a.b:8080',
    ]);
    expect(plan.hosts).toEqual(['api.example.com', '8.8.8.8']);
    expect(plan.hostPermissions).toEqual(['*://api.example.com/*', '*://*.api.example.com/*', '*://8.8.8.8/*']);
    expect(plan.notes).toHaveLength(12);
  });

  it('refuses a network @require or @resource with network-require', () => {
    for (const line of [
      '@require https://cdn.example/lib.js',
      '@require //cdn.example/lib.js',
      '@require http://x/y.js#sha256=abc',
      '@resource css https://cdn.example/a.css',
    ]) {
      expect(generateUserscriptExtension({ source: script(['@match *://*/*', line]) })).toMatchObject({
        ok: false,
        code: 'network-require',
      });
    }
  });

  it('refuses a @require that could leave the package or is not a plain path', () => {
    for (const value of [
      '../secret.js',
      'a/../../b.js',
      '/etc/passwd',
      'C:/x.js',
      'file:///x.js',
      'data:text/javascript,1',
      'a\\b.js',
      'a.js?x=1',
      'we ird.js',
    ]) {
      expect(generateUserscriptExtension({ source: script(['@match *://*/*', `@require ${value}`]) })).toMatchObject({
        ok: false,
        code: expect.stringMatching(/bad-require|network-require/),
      });
    }
  });

  it('inlines a local @require in order and reports a missing one', () => {
    const source = script(['@match *://*/*', '@grant GM_log', '@require lib/./one.js', '@require two.js']);
    const files = new Map([
      ['lib/one.js', 'var ONE = 1;'],
      ['two.js', 'var TWO = ONE + 1;'],
    ]);
    const result = generate(source, files);
    const content = fileOf(result, 'userscript.js');
    expect(content.indexOf('var ONE = 1;')).toBeLessThan(content.indexOf('var TWO'));
    expect(content.indexOf('var TWO')).toBeLessThan(content.indexOf('window.__ran'));
    expect(generateUserscriptExtension({ source })).toMatchObject({
      ok: false,
      code: 'missing-require',
      value: 'lib/one.js',
    });
  });

  it('lists a local @require of a page-world script as separate files before the script', () => {
    const result = generate(
      script(['@match *://*/*', '@require lib/one.js']),
      new Map([['lib/one.js', 'var ONE = 1;']])
    );
    expect(result.world).toBe('MAIN');
    expect(contentScript(result).js).toEqual(['require/01-one.js', 'userscript.js']);
    expect(fileOf(result, 'require/01-one.js')).toBe('var ONE = 1;');
  });

  it('refuses oversized local @require input', () => {
    const big = 'a'.repeat(USERSCRIPT_LIMITS.MAX_REQUIRE_CHARS / 2 + 1);
    const result = generateUserscriptExtension({
      source: script(['@match *://*/*', '@require a.js', '@require b.js']),
      localFiles: new Map([
        ['a.js', big],
        ['b.js', big],
      ]),
    });
    expect(result).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('is deterministic', () => {
    const source = script([
      '@name D',
      '@match https://a.example/*',
      '@include https://b.example/*',
      '@grant GM_getValue',
      '@grant GM_xmlhttpRequest',
      '@connect z.example',
      '@connect a.example',
    ]);
    const first = generate(source);
    const second = generate(source);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const paths = first.files.map((file) => file.path);
    expect(paths).toEqual(paths.toSorted());
  });

  it('normalizes versions and names for Chrome', () => {
    expect(generate(script(['@match *://*/*', '@version 1.2.3-beta', '@name   Long\tname'])).manifest).toMatchObject({
      version: '1.2.3',
      version_name: '1.2.3-beta',
      name: 'Long name',
    });
    expect(generate(script(['@match *://*/*', '@version abc'])).manifest.version).toBe('0.0.1');
    expect(generate(script(['@match *://*/*', '@version 70000.1'])).manifest.version).toBe('0.0.1');
    expect(generate(script(['@match *://*/*'])).manifest.name).toBe('Userscript');
    expect(String(generate(script(['@match *://*/*', `@name ${'n'.repeat(500)}`])).manifest.name)).toHaveLength(75);
  });

  it('handles hostile headers without throwing', () => {
    const hostile = [
      script([
        '@match *://*/*',
        '@name </script><script>alert(1)</script>',
        '@grant GM_log',
        `@description ${'d'.repeat(1_500)}`,
      ]),
      script(['@match *://*/*', '@exclude ' + '*'.repeat(1_900)]),
      '// ==UserScript==\n'.repeat(50),
      `// ==UserScript==\n${'// @match https://a.example/*\n'.repeat(5_000)}// ==/UserScript==`,
      script(['@match *://*/*'], 'x'.repeat(USERSCRIPT_LIMITS.MAX_SOURCE_CHARS - 500)),
    ];
    for (const source of hostile) expect(() => generateUserscriptExtension({ source })).not.toThrow();
    const injected = generate(hostile[0] as string);
    expect(fileOf(injected, 'userscript.js')).not.toContain('</script><script>alert(1)</script>"');
    expect(String(injected.manifest.description)).toHaveLength(132);
    expect(generateUserscriptExtension({ source: hostile[3] as string })).toMatchObject({
      ok: false,
      code: 'bad-header',
    });
    expect(generateUserscriptExtension({ source: hostile[4] as string })).toMatchObject({ ok: true });
  });

  it('rejects the oversized source and the output cap', () => {
    const huge = script(['@match *://*/*'], 'x'.repeat(USERSCRIPT_LIMITS.MAX_SOURCE_CHARS + 1));
    expect(generateUserscriptExtension({ source: huge })).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('never evaluates the userscript while generating', () => {
    const marker = '__t44_evaluated__';
    (globalThis as Record<string, unknown>)[marker] = false;
    generate(script(['@match *://*/*', '@grant GM_log'], `globalThis.${marker} = true;`));
    generate(script(['@match *://*/*'], `globalThis.${marker} = true;`));
    expect((globalThis as Record<string, unknown>)[marker]).toBe(false);
  });
});

type FakeStorage = Record<string, unknown>;

const runWrapper = (code: string, initial: FakeStorage = {}) => {
  const stored: FakeStorage = { ...initial };
  const sent: unknown[] = [];
  const styles: { textContent?: string }[] = [];
  const logs: unknown[][] = [];
  const sandbox: Record<string, unknown> = {
    chrome: {
      storage: {
        local: {
          get: (_keys: unknown, done: (items: FakeStorage) => void) => done({ ...stored }),
          set: (items: FakeStorage) => Object.assign(stored, items),
          remove: (key: string) => delete stored[key],
        },
      },
      runtime: {
        lastError: undefined,
        sendMessage: (message: unknown, done: (reply: unknown) => void) => {
          sent.push(message);
          done({
            ok: true,
            status: 200,
            statusText: 'OK',
            finalUrl: 'https://api.example.com/x',
            responseHeaders: '',
            responseText: '{"a":1}',
          });
        },
      },
    },
    console: { log: (...args: unknown[]) => logs.push(args), error: () => undefined },
    document: {
      head: { appendChild: (node: { textContent?: string }) => styles.push(node) },
      createElement: () => ({}),
    },
    location: { href: 'https://a.example/page' },
    URL,
    setTimeout,
    clearTimeout,
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, stored, sent, styles, logs };
};

describe('generated GM runtime (executed here against a fake chrome)', () => {
  it('stores values, lists and deletes them, and clones objects', () => {
    const result = generate(
      script(
        ['@match *://*/*', '@grant GM_getValue', '@grant GM_setValue', '@grant GM_deleteValue', '@grant GM_listValues'],
        [
          'GM_setValue("a", {n: 1});',
          'GM_setValue("b", "two");',
          'var got = GM_getValue("a"); got.n = 99;',
          'GM_deleteValue("b");',
          'window.__out = { again: GM_getValue("a").n, missing: GM_getValue("b", "dflt"), keys: GM_listValues(), old: GM_getValue("seeded") };',
        ].join('\n')
      )
    );
    const run = runWrapper(fileOf(result, 'userscript.js'), { 'gmv:seeded': 'yes', other: 'ignored' });
    expect(JSON.parse(JSON.stringify(run.sandbox.__out))).toEqual({
      again: 1,
      missing: 'dflt',
      keys: ['seeded', 'a'],
      old: 'yes',
    });
    expect(run.stored['gmv:a']).toEqual({ n: 1 });
    expect(run.stored['gmv:b']).toBeUndefined();
  });

  it('hands a script only the functions it was granted', () => {
    const result = generate(
      script(
        ['@match *://*/*', '@grant GM_log'],
        'window.__out = [typeof GM_log, typeof GM_setValue, typeof GM_xmlhttpRequest, typeof GM_info];'
      )
    );
    const run = runWrapper(fileOf(result, 'userscript.js'));
    expect(Array.from(run.sandbox.__out as string[])).toEqual(['function', 'undefined', 'undefined', 'undefined']);
  });

  it('adds styles, logs, and exposes GM_info', () => {
    const result = generate(
      script(
        ['@name Info', '@match *://*/*', '@grant GM_addStyle', '@grant GM_log', '@grant GM_info'],
        'GM_addStyle("a{}"); GM_log("hi"); window.__out = GM_info.script.name;'
      )
    );
    const run = runWrapper(fileOf(result, 'userscript.js'));
    expect(run.styles[0]?.textContent).toBe('a{}');
    expect(run.logs[0]).toEqual(['[Info]', 'hi']);
    expect(run.sandbox.__out).toBe('Info');
  });

  it('sends GM_xmlhttpRequest to the background worker and returns its answer', () => {
    const result = generate(
      script(
        ['@match *://*/*', '@grant GM_xmlhttpRequest', '@connect api.example.com'],
        'GM_xmlhttpRequest({ method: "post", url: "/x", data: "d", responseType: "json", onload: function (r) { window.__out = r.response.a; } });'
      )
    );
    const run = runWrapper(fileOf(result, 'userscript.js'));
    expect(run.sandbox.__out).toBe(1);
    expect(run.sent[0]).toMatchObject({ type: 'tomny-gm-xhr', method: 'POST', url: 'https://a.example/x', data: 'd' });
  });

  it('keeps the page from seeing the runtime: the wrapper is one closure', () => {
    const result = generate(script(['@match *://*/*', '@grant GM_log']));
    const run = runWrapper(fileOf(result, 'userscript.js'));
    expect(Object.keys(run.sandbox).filter((key) => /^(api|values|INFO|GRANTED|runScript)$/.test(key))).toEqual([]);
  });
});

type Listener = (message: unknown, sender: unknown, respond: (reply: unknown) => void) => boolean;

const loadWorker = (code: string, fetchImpl: (url: string, init: Record<string, unknown>) => Promise<unknown>) => {
  let listener: Listener | undefined;
  const sandbox: Record<string, unknown> = {
    chrome: { runtime: { id: 'self-id', onMessage: { addListener: (fn: Listener) => (listener = fn) } } },
    fetch: fetchImpl,
    URL,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const ask = (message: unknown, sender: unknown = { id: 'self-id', tab: { id: 1 } }): Promise<unknown> =>
    new Promise((resolve) => {
      const kept = (listener as Listener)(message, sender, resolve);
      if (kept === false) resolve('ignored');
    });
  return ask;
};

const okResponse = (text: string) => ({
  status: 200,
  statusText: 'OK',
  url: 'https://api.example.com/x',
  headers: new Headers({ 'x-a': 'b' }),
  body: new Response(text).body,
});

describe('generated GM background worker (executed here against a fake fetch)', () => {
  const worker = generate(
    script(['@match *://*/*', '@grant GM_xmlhttpRequest', '@connect api.example.com', '@connect 8.8.8.8'])
  );
  const code = fileOf(worker, 'gm-background.js');

  it('fetches an allowed host without credentials or redirects and returns the text', async () => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const ask = loadWorker(code, async (url, init) => {
      calls.push({ url, init });
      return okResponse('hello');
    });
    const reply = await ask({
      type: 'tomny-gm-xhr',
      method: 'post',
      url: 'https://sub.api.example.com/x',
      headers: { 'X-Mine': '1', Cookie: 'a=b', Host: 'evil' },
      data: 'body',
    });
    expect(reply).toMatchObject({ ok: true, status: 200, responseText: 'hello' });
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      body: 'body',
      headers: { 'X-Mine': '1' },
    });
    const sent = (calls[0]?.init ?? {}).headers as Record<string, string>;
    expect(sent.Cookie).toBeUndefined();
    expect(sent.Host).toBeUndefined();
    await expect(ask({ type: 'tomny-gm-xhr', url: 'http://8.8.8.8/x' })).resolves.toMatchObject({ ok: true });
  });

  it('blocks hosts outside @connect, look-alikes, credentials in the URL and other schemes', async () => {
    const ask = loadWorker(code, async () => okResponse(''));
    for (const url of [
      'https://evil.example/x',
      'https://notapi.example.com/x',
      'https://api.example.com.evil.net/x',
      'https://u:p@api.example.com/x',
      'ftp://api.example.com/x',
      'http://127.0.0.1/x',
      'https://9.8.8.8/x',
      'not a url',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- each call is checked on its own
      expect(await ask({ type: 'tomny-gm-xhr', url })).toMatchObject({ ok: false });
    }
    expect(await ask({ type: 'tomny-gm-xhr', url: 'https://api.example.com/x', method: 'TRACE' })).toMatchObject({
      ok: false,
      error: 'blocked-method',
    });
  });

  it('answers only its own content scripts', async () => {
    const ask = loadWorker(code, async () => okResponse(''));
    expect(await ask({ type: 'tomny-gm-xhr', url: 'https://api.example.com/x' }, { id: 'other', tab: { id: 1 } })).toBe(
      'ignored'
    );
    expect(await ask({ type: 'tomny-gm-xhr', url: 'https://api.example.com/x' }, { id: 'self-id' })).toBe('ignored');
    expect(await ask({ type: 'other' })).toBe('ignored');
  });

  it('caps the response size and reports failures', async () => {
    const big = loadWorker(code, async () => okResponse('x'.repeat(5_242_881)));
    expect(await big({ type: 'tomny-gm-xhr', url: 'https://api.example.com/x' })).toMatchObject({
      ok: false,
      error: 'too-large',
    });
    const broken = loadWorker(code, async () => {
      throw new Error('network down');
    });
    expect(await broken({ type: 'tomny-gm-xhr', url: 'https://api.example.com/x' })).toMatchObject({
      ok: false,
      error: 'failed',
    });
    const tooBig = loadWorker(code, async () => okResponse(''));
    expect(
      await tooBig({
        type: 'tomny-gm-xhr',
        method: 'POST',
        url: 'https://api.example.com/x',
        data: 'x'.repeat(1_048_577),
      })
    ).toMatchObject({ ok: false, error: 'body-too-large' });
  });
});

describe('staging and the normal extension path', () => {
  it('writes a generated extension that prepareWorkingCopy accepts and pins a key for', async () => {
    const root = await temp();
    const result = generate(
      script(['@name Staged', '@match https://a.example/*', '@grant GM_xmlhttpRequest', '@connect api.example.com'])
    );
    const source = path.join(root, 'source');
    await stageGeneratedExtension(result.files, source);
    const copy = await prepareWorkingCopy({
      sourceRoot: source,
      workingRoot: path.join(root, 'work'),
      packageId: 'com.community.userscript',
      connectionId: 'staged',
      generateKey: async () => generateExtensionKey(),
    });
    expect(copy.summary).toMatchObject({ manifestVersion: 3, name: 'Staged', hasBackground: true });
    const written = JSON.parse(await readFile(path.join(copy.directory, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(written.key).toBe(copy.key);
    expect(await readFile(path.join(copy.directory, 'gm-background.js'), 'utf8')).toBe(
      fileOf(result, 'gm-background.js')
    );
  });

  it('refuses unsafe paths and never overwrites', async () => {
    const root = await temp();
    await expect(stageGeneratedExtension([{ path: '../x.js', content: '' }], root)).rejects.toThrow();
    await expect(stageGeneratedExtension([{ path: '/abs.js', content: '' }], root)).rejects.toThrow();
    await mkdir(path.join(root, 'dir'), { recursive: true });
    await stageGeneratedExtension([{ path: 'a.js', content: '1' }], path.join(root, 'dir'));
    await expect(stageGeneratedExtension([{ path: 'a.js', content: '2' }], path.join(root, 'dir'))).rejects.toThrow();
  });
});
