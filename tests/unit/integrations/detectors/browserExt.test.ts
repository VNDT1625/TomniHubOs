import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAdapterDocument, type AdapterConnection, type AdapterOpenItem } from '@/common/packages/adapter';
import { detectors, detectWith } from '@/common/integrations/detectors';
import { detectRepository } from '@/common/integrations/detectors/repoDetection';
import { browserExt } from '@/common/integrations/detectors/browser';
import {
  CHROME_API_SUPPORT,
  supportOfPermission,
  UNSUPPORTED_CHROME_PERMISSIONS,
  USERSCRIPT_GRANTS,
} from '@/common/integrations/detectors/browser/chromeApiSupport';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

type Extension = AdapterConnection & { kind: 'extension' };

const run = (texts: Readonly<Record<string, string>>, extraFiles: readonly string[] = []) =>
  browserExt.detect(inventoryOf(texts, extraFiles));

const extensions = (result: { connections: readonly AdapterConnection[] }): Extension[] => {
  const found: Extension[] = [];
  for (const connection of result.connections) if (connection.kind === 'extension') found.push(connection);
  return found;
};
const only = (result: { connections: readonly AdapterConnection[] }): Extension => {
  const all = extensions(result);
  expect(all).toHaveLength(1);
  return all[0] as Extension;
};
const items = (result: { openItems: readonly AdapterOpenItem[] }, kind: AdapterOpenItem['kind']) =>
  result.openItems.filter((item) => item.kind === kind);

const json = (value: unknown): string => JSON.stringify(value);
const mv3 = (extra: Record<string, unknown> = {}): string =>
  json({ manifest_version: 3, name: 'Demo', version: '1.0.0', background: { service_worker: 'sw.js' }, ...extra });

const asDocument = (merged: { connections: unknown; openItems: unknown; detectors: unknown }): unknown =>
  parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: merged.connections,
    openItems: merged.openItems,
    detectors: merged.detectors,
  });

const header = (lines: readonly string[]): string =>
  ['// ==UserScript==', ...lines.map((line) => `// ${line}`), '// ==/UserScript==', 'void 0;'].join('\n');

describe('browser-ext: contract and registration', () => {
  it('is a versioned detector and is registered', () => {
    expect(browserExt.id).toBe('browser-ext');
    expect(browserExt.version).toBe(1);
    expect(detectors).toContain(browserExt);
  });

  it('reaches the classifier bridge: a Manifest V3 repo yields an extension connection', () => {
    const report = detectRepository({
      files: ['manifest.json', 'sw.js'],
      snippets: { 'manifest.json': mv3({ permissions: ['storage'] }) },
      findings: { connections: [], openItems: [], skillRoots: [] },
    });
    expect(report.connections.map((connection) => connection.kind)).toEqual(['extension']);
    expect(report.detectors).toContain('browser-ext@1');
    expect(report.archetype).toBe('browser-extension');
  });

  it('returns nothing for a repository without extensions', () => {
    const result = run({ 'package.json': json({ name: 'app', dependencies: { react: '1' } }) });
    expect(result).toEqual({ connections: [], openItems: [], reasons: [], claimed: [] });
  });
});

describe('browser-ext: fixtures', () => {
  const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');
  const expectedOf = (name: string): unknown =>
    JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'expected.adapter.json'), 'utf8')) as unknown;

  it.each(['chrome-mv3', 'chrome-wxt-unbuilt', 'userscript'])(
    '%s matches expected.adapter.json, is a valid document and leaves no declaration file unclaimed',
    (name) => {
      const merged = detectWith(fixtureInventory(name), [browserExt]);
      expect(asDocument(merged)).toEqual(expectedOf(name));
      expect(parseAdapterDocument(expectedOf(name))).toBeTruthy();
      expect(items(merged, 'unrecognized')).toEqual([]);
    }
  );

  it('chrome-mv3 flags the unsupported history permission and the all-sites access', () => {
    const result = browserExt.detect(fixtureInventory('chrome-mv3'));
    expect(only(result)).toMatchObject({ format: 'chrome-mv3', unsupported: ['history'] });
    expect(items(result, 'needs-consent')).toHaveLength(1);
    expect(items(result, 'needs-runtime')).toHaveLength(1);
    expect(result.claimed).toEqual(['manifest.json']);
  });

  it('chrome-wxt-unbuilt records the build command but never needs it to have run', () => {
    const result = browserExt.detect(fixtureInventory('chrome-wxt-unbuilt'));
    expect(only(result)).toMatchObject({ needsBuild: true, root: 'source/.output/chrome-mv3', title: 'wxt-clipper' });
    const [build] = items(result, 'needs-build');
    expect(build?.note).toContain('`bun install`');
    expect(build?.note).toContain('`bun run build`');
    expect(result.claimed).toEqual(['package.json', 'wxt.config.ts']);
  });

  it('userscript refuses the network @require and keeps the one that is in the repo', () => {
    const result = browserExt.detect(fixtureInventory('userscript'));
    const script = only(result);
    expect(script.unsupported).toEqual(['GM_notification', '@require cdn.jsdelivr.net']);
    expect(script.format).toBe('userscript');
    expect(script.root).toBe('source/scripts/dark-lite.user.js');
  });
});

describe('browser-ext: Chrome manifests', () => {
  it('reads a minimal Manifest V3 extension', () => {
    const result = run({ 'ext/manifest.json': mv3({ action: {}, permissions: ['storage', 'alarms'] }) });
    expect(only(result)).toEqual({
      kind: 'extension',
      id: 'demo',
      title: 'Demo',
      format: 'chrome-mv3',
      root: 'source/ext',
      version: '1.0.0',
      permissions: ['storage', 'alarms'],
      hostPermissions: [],
      unsupported: [],
      origin: 'chrome-extension',
    });
    expect(result.openItems).toEqual([]);
  });

  it('accepts a manifest with comments, as Chrome does', () => {
    const text = `{\n // comment\n "manifest_version": 3, "name": "C", "action": {} /* x */\n}`;
    expect(only(run({ 'manifest.json': text })).title).toBe('C');
  });

  it('records Manifest V2 with a background page as unsupported: needs Manifest V3', () => {
    const result = run({
      'manifest.json': json({
        manifest_version: 2,
        name: 'Old',
        background: { scripts: ['bg.js'] },
        permissions: ['tabs'],
      }),
    });
    expect(only(result)).toMatchObject({
      format: 'chrome-mv2',
      unsupported: ['background (cần bản Manifest V3)'],
    });
    expect(items(result, 'needs-runtime')[0]?.note).toContain('Manifest V3');
  });

  it('does not flag Manifest V2 without a background', () => {
    const result = run({ 'manifest.json': json({ manifest_version: 2, name: 'Old', content_scripts: [] }) });
    expect(only(result)).toMatchObject({ format: 'chrome-mv2', unsupported: [] });
    expect(items(result, 'needs-runtime')).toEqual([]);
  });

  it('treats host patterns inside MV2 permissions as host permissions', () => {
    const result = run({
      'manifest.json': json({ manifest_version: 2, name: 'Old', permissions: ['storage', 'https://a.example/*'] }),
    });
    expect(only(result)).toMatchObject({ permissions: ['storage'], hostPermissions: ['https://a.example/*'] });
  });

  it('flags a Manifest V3 background that has no service worker', () => {
    const result = run({
      'manifest.json': json({ manifest_version: 3, name: 'F', background: { scripts: ['a.js'] } }),
    });
    expect(only(result).unsupported).toEqual(['background.scripts (cần service_worker)']);
  });

  it('reports other manifest_version values without making a connection', () => {
    const result = run({ 'manifest.json': json({ manifest_version: 4, name: 'Future', action: {} }) });
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')).toHaveLength(1);
  });

  it('reports a manifest that cannot be parsed', () => {
    const result = run({ 'manifest.json': '{ "manifest_version": 3, "name": ' });
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')[0]).toMatchObject({ path: 'source/manifest.json' });
  });

  it('skips MCPB bundles, web app manifests and manifests without extension keys', () => {
    const result = run({
      'a/manifest.json': json({ manifest_version: '0.2', name: 'mcpb', server: { type: 'node' } }),
      'b/manifest.json': json({ name: 'PWA', start_url: '/', display: 'standalone' }),
      'c/manifest.json': json({ manifest_version: 3, name: 'Empty' }),
    });
    expect(result).toEqual({ connections: [], openItems: [], reasons: [], claimed: [] });
  });

  it('keeps a valid public key and drops one that is not base64', () => {
    expect(only(run({ 'manifest.json': mv3({ key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOC' }) })).publicKey).toBe(
      'MIIBIjANBgkqhkiG9w0BAQEFAAOC'
    );
    expect(only(run({ 'manifest.json': mv3({ key: 'not base64 !' }) })).publicKey).toBeUndefined();
  });

  it('takes the id from the folder when the name is a localization placeholder', () => {
    const result = run({ 'tools/Fancy Ext/manifest.json': mv3({ name: '__MSG_appName__' }) });
    expect(only(result)).toMatchObject({ id: 'fancy-ext', title: 'fancy-ext' });
  });

  it('gives two extensions with the same name different ids (the folder name is the next candidate)', () => {
    const result = run({ 'a/manifest.json': mv3(), 'b/manifest.json': mv3() });
    expect(extensions(result).map((connection) => connection.id)).toEqual(['demo', 'b']);
  });

  it('asks for consent on all-sites content scripts', () => {
    const result = run({ 'manifest.json': mv3({ content_scripts: [{ matches: ['*://*/*'], js: ['c.js'] }] }) });
    expect(items(result, 'needs-consent')).toHaveLength(1);
    expect(only(result).matches).toEqual(['*://*/*']);
  });

  it('does not ask for consent for specific sites', () => {
    const result = run({ 'manifest.json': mv3({ host_permissions: ['https://*.example.com/*'] }) });
    expect(items(result, 'needs-consent')).toEqual([]);
  });

  it('never copies text it does not understand into a note without bounds', () => {
    const name = `Evil\n${'x'.repeat(500)}`;
    const result = run({ 'manifest.json': mv3({ name, permissions: ['history'] }) });
    for (const item of result.openItems) {
      expect(item.note.length).toBeLessThanOrEqual(300);
      expect(item.note).not.toContain('\n');
    }
  });
});

describe('browser-ext: Chrome API support table (design 12.3)', () => {
  it('lists the API names of the design for the shimmed permissions', () => {
    const apis = CHROME_API_SUPPORT.flatMap((row) => row.apis);
    for (const api of [
      'tabs.create',
      'windows.getCurrent',
      'contextMenus.create',
      'notifications.create',
      'cookies.getAll',
      'webNavigation.onCompleted',
      'downloads.download',
      'permissions.request',
      'storage.sync',
      'action.setIcon',
      'commands.getAll',
    ]) {
      expect(apis).toContain(api);
    }
  });

  it('serves the permissions of the table and rejects every "not in v1" permission', () => {
    for (const permission of [
      'storage',
      'alarms',
      'scripting',
      'declarativeNetRequest',
      'tabs',
      'cookies',
      'downloads',
    ]) {
      expect(supportOfPermission(permission)).not.toBe('unsupported');
    }
    for (const permission of Object.keys(UNSUPPORTED_CHROME_PERMISSIONS)) {
      expect(supportOfPermission(permission)).toBe('unsupported');
    }
    expect(supportOfPermission('somethingNew')).toBe('unsupported');
  });

  it('turns permissions without a shim into unsupported entries, in manifest order, optional ones included', () => {
    const result = run({
      'manifest.json': mv3({
        permissions: ['cookies', 'webRequest', 'bookmarks', 'storage', 'identity', 'nativeMessaging', 'offscreen'],
        optional_permissions: ['debugger', 'tabs', 'https://x.example/*'],
        side_panel: { default_path: 'p.html' },
      }),
    });
    expect(only(result).unsupported).toEqual([
      'webRequest',
      'bookmarks',
      'identity',
      'nativeMessaging',
      'offscreen',
      'debugger',
      'sidePanel',
    ]);
    expect(only(result).permissions).toEqual([
      'cookies',
      'webRequest',
      'bookmarks',
      'storage',
      'identity',
      'nativeMessaging',
      'offscreen',
    ]);
    expect(items(result, 'needs-runtime')[0]?.note).toContain('declarativeNetRequest');
  });
});

const lock = (name: string): Record<string, string> => ({ [name]: '' });

describe('browser-ext: projects that still need a build', () => {
  it('detects WXT by wxt.config in a subfolder and by the dependency', () => {
    const viaConfig = run({ 'ext/wxt.config.ts': 'export default {};', 'ext/package.json': json({ name: 'e' }) });
    expect(only(viaConfig)).toMatchObject({ needsBuild: true, root: 'source/ext/.output/chrome-mv3' });
    const viaDependency = run({ 'package.json': json({ name: 'e', devDependencies: { wxt: '^0.19' } }) });
    expect(only(viaDependency)).toMatchObject({ needsBuild: true, root: 'source/.output/chrome-mv3' });
  });

  it('uses the build script and the lock file to name the command, or the tool itself without a script', () => {
    const scripted = run({
      'package.json': json({ name: 'e', scripts: { build: 'rm -rf / && wxt build' }, devDependencies: { wxt: '1' } }),
      ...lock('pnpm-lock.yaml'),
    });
    const note = items(scripted, 'needs-build')[0]?.note ?? '';
    expect(note).toContain('`pnpm install`');
    expect(note).toContain('`pnpm run build`');
    expect(note).not.toContain('rm -rf');
    const bare = run({ 'package.json': json({ name: 'e', devDependencies: { wxt: '1' } }) });
    expect(items(bare, 'needs-build')[0]?.note).toContain('`npx wxt build`');
  });

  it('reads Plasmo permissions from package.json', () => {
    const result = run({
      'package.json': json({
        name: 'p',
        displayName: 'Plasmo Demo',
        version: '2.0.0',
        dependencies: { plasmo: '0.90.0' },
        manifest: { permissions: ['storage', 'history'], host_permissions: ['https://*/*'] },
      }),
    });
    expect(only(result)).toMatchObject({
      title: 'Plasmo Demo',
      version: '2.0.0',
      root: 'source/build/chrome-mv3-prod',
      needsBuild: true,
      permissions: ['storage', 'history'],
      unsupported: ['history'],
    });
    expect(items(result, 'needs-consent')).toHaveLength(1);
  });

  it('uses the source manifest of an @crxjs/vite-plugin project and does not treat it as built', () => {
    const result = run({
      'package.json': json({ name: 'c', devDependencies: { '@crxjs/vite-plugin': '2.0.0' } }),
      'manifest.json': json({
        manifest_version: 3,
        name: 'Crx',
        permissions: ['tabs'],
        background: { service_worker: 'src/sw.ts', type: 'module' },
      }),
    });
    expect(only(result)).toMatchObject({ title: 'Crx', needsBuild: true, root: 'source/dist', permissions: ['tabs'] });
    expect(result.claimed).toEqual(['manifest.json', 'package.json']);
  });

  it('does not ask for a build when the build output is in the repository', () => {
    const result = run({
      'package.json': json({ name: 'e', devDependencies: { wxt: '1' } }),
      '.output/chrome-mv3/manifest.json': mv3({ permissions: ['storage'] }),
    });
    expect(only(result)).toMatchObject({ root: 'source/.output/chrome-mv3' });
    expect(only(result).needsBuild).toBeUndefined();
    expect(items(result, 'needs-build')).toEqual([]);
  });

  it('does not treat a package.json without a build tool as an extension', () => {
    expect(run({ 'package.json': json({ name: 'x', dependencies: { vite: '1' } }) }).connections).toEqual([]);
  });
});

describe('browser-ext: userscripts', () => {
  const script = (lines: readonly string[]) => run({ 'tools/a.user.js': header(lines), 'tools/lib.js': '' });

  it('reads name, version, match, include, grant and connect', () => {
    const result = script([
      '@name Hello',
      '@version 1.0',
      '@match https://a.example/*',
      '@include https://b.example/*',
      '@include /^https:\\/\\/c\\.example\\//',
      '@grant GM_getValue',
      '@grant GM_addStyle',
      '@connect api.a.example',
      '@connect self',
      '@run-at document-idle',
    ]);
    expect(only(result)).toEqual({
      kind: 'extension',
      id: 'a',
      title: 'Hello',
      format: 'userscript',
      root: 'source/tools/a.user.js',
      version: '1.0',
      permissions: ['GM_getValue', 'GM_addStyle'],
      hostPermissions: ['*://api.a.example/*'],
      matches: ['https://a.example/*', 'https://b.example/*'],
      unsupported: ['@include (biểu thức chính quy)'],
      origin: 'userscript',
    });
    expect(result.claimed).toEqual(['tools/a.user.js']);
  });

  it('treats @grant none as no permission and supports exactly the GM_* list of the design', () => {
    const result = script(['@match https://a.example/*', '@grant none']);
    expect(only(result)).toMatchObject({ permissions: [], unsupported: [] });
    expect([...USERSCRIPT_GRANTS].toSorted()).toEqual([
      'GM_addStyle',
      'GM_deleteValue',
      'GM_getValue',
      'GM_listValues',
      'GM_setValue',
      'GM_xmlhttpRequest',
    ]);
  });

  it('marks grants outside the v1 list as unsupported', () => {
    const result = script([
      '@match *://a.example/*',
      '@grant GM.getValue',
      '@grant unsafeWindow',
      '@grant GM_xmlhttpRequest',
    ]);
    expect(only(result).unsupported).toEqual(['GM.getValue', 'unsafeWindow']);
    expect(items(result, 'needs-runtime')).toHaveLength(1);
  });

  it('refuses @require and @resource that point to the network, without fetching', () => {
    const result = script([
      '@match https://a.example/*',
      '@require https://cdn.example/lib.js#sha256=abc',
      '@require //cdn2.example/x.js',
      '@resource css https://static.example/s.css',
      '@require ./lib.js',
      '@require ./missing.js',
    ]);
    expect(only(result).unsupported).toEqual([
      '@require cdn.example',
      '@require cdn2.example',
      '@require (không có trong repo)',
      '@resource static.example',
    ]);
  });

  it('accepts @require of a file inside the repository', () => {
    const result = script(['@match https://a.example/*', '@require ./lib.js', '@require lib.js']);
    expect(only(result).unsupported).toEqual([]);
    expect(items(result, 'needs-runtime')).toEqual([]);
  });

  it('does not let @require climb out of the repository', () => {
    const result = script(['@match https://a.example/*', '@require ../../outside.js']);
    expect(only(result).unsupported).toEqual(['@require (không có trong repo)']);
  });

  it('asks for consent for all-sites matches and @connect *', () => {
    expect(items(script(['@match *://*/*']), 'needs-consent')).toHaveLength(1);
    const connect = script(['@match https://a.example/*', '@connect *']);
    expect(only(connect).hostPermissions).toEqual(['<all_urls>']);
    expect(items(connect, 'needs-consent')).toHaveLength(1);
  });

  it('marks @run-at context-menu as unsupported', () => {
    expect(only(script(['@match https://a.example/*', '@run-at context-menu'])).unsupported).toEqual([
      '@run-at context-menu',
    ]);
  });

  it('makes no connection for a script without @match and reports it', () => {
    const result = script(['@name Nowhere']);
    expect(result.connections).toEqual([]);
    expect(items(result, 'unrecognized')).toHaveLength(1);
    expect(result.claimed).toEqual(['tools/a.user.js']);
  });

  it('ignores a .user.js file without a header and reports a header that never closes', () => {
    expect(run({ 'a.user.js': 'console.log(1);' })).toEqual({
      connections: [],
      openItems: [],
      reasons: [],
      claimed: [],
    });
    const open = run({ 'a.user.js': '// ==UserScript==\n// @match https://a.example/*\n' });
    expect(open.connections).toEqual([]);
    expect(items(open, 'unrecognized')).toHaveLength(1);
  });

  it('ignores localized names and gives scripts with the same file name different ids', () => {
    const result = run({
      'x/a.user.js': header(['@name Plain', '@name:ja 名前', '@match https://a.example/*']),
      'y/a.user.js': header(['@match https://b.example/*']),
    });
    expect(extensions(result).map((connection) => [connection.id, connection.title])).toEqual([
      ['a', 'Plain'],
      ['y-a', 'a'],
    ]);
  });

  it('reads only the header: the inventory keeps 8 KB of a userscript', () => {
    const body = `${header(['@name Big', '@match https://a.example/*'])}\n${'x'.repeat(20_000)}`;
    expect(only(run({ 'big.user.js': body })).title).toBe('Big');
  });
});
