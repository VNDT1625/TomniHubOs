import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExtensionUserState } from '@process/integrations/browserExtensions/state/userState';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BROAD = ['<all_urls>'];

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-prefs-'));
  file = path.join(directory, 'prefs.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('extension user state', () => {
  it('defaults broad access to on click and keeps nothing until the person chooses', async () => {
    const state = createExtensionUserState(file);
    await state.initialize();
    expect(state.configOf(ID_A, BROAD)).toEqual({ mode: 'on-click', sites: [], sessionSites: [] });
    expect(state.configOf(ID_A, ['https://github.com/*'])).toEqual({ mode: 'all-sites', sites: [], sessionSites: [] });
    expect(state.isPinned(ID_A)).toBe(false);
  });

  it('saves the pin, the mode and the allowed sites, and reads them back after a restart', async () => {
    const first = createExtensionUserState(file);
    await first.initialize();
    await first.setPinned(ID_A, true);
    await first.setMode(ID_A, 'on-site');
    expect(await first.allowOrigin(ID_A, 'https://news.test', BROAD)).toBe('saved');

    const second = createExtensionUserState(file);
    await second.initialize();
    expect(second.isPinned(ID_A)).toBe(true);
    expect(second.configOf(ID_A, BROAD)).toEqual({ mode: 'on-site', sites: ['https://news.test'], sessionSites: [] });
  });

  it('keeps an on click grant for this run only, and clears it when the mode changes', async () => {
    const state = createExtensionUserState(file);
    await state.initialize();
    expect(await state.allowOrigin(ID_A, 'https://news.test', BROAD)).toBe('run');
    expect(state.configOf(ID_A, BROAD).sessionSites).toEqual(['https://news.test']);
    await state.setMode(ID_A, 'on-click');
    expect(state.configOf(ID_A, BROAD).sessionSites).toEqual([]);

    const restarted = createExtensionUserState(file);
    await restarted.initialize();
    expect(restarted.configOf(ID_A, BROAD).sessionSites).toEqual([]);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { extensions: Array<Record<string, unknown>> };
    expect(saved.extensions[0]).not.toHaveProperty('sites');
  });

  it('refuses to save anything that is not a plain web origin', async () => {
    const state = createExtensionUserState(file);
    await state.initialize();
    await expect(state.allowOrigin(ID_A, 'https://*', BROAD)).rejects.toThrow();
    await expect(state.allowOrigin(ID_A, 'https://news.test/path', BROAD)).rejects.toThrow();
  });

  it('starts empty when the file is corrupt, and drops malformed entries', async () => {
    await writeFile(file, '{not json', 'utf8');
    const corrupt = createExtensionUserState(file);
    await corrupt.initialize();
    expect(corrupt.isPinned(ID_A)).toBe(false);

    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          { id: 'not-an-id', pinned: true },
          { id: ID_A, pinned: true, mode: 'everything', sites: ['https://*', 'https://ok.test'] },
        ],
      }),
      'utf8'
    );
    const loaded = createExtensionUserState(file);
    await loaded.initialize();
    expect(loaded.isPinned(ID_A)).toBe(true);
    expect(loaded.configOf(ID_A, BROAD)).toEqual({ mode: 'on-click', sites: ['https://ok.test'], sessionSites: [] });
  });

  it('forgets everything kept for an extension', async () => {
    const state = createExtensionUserState(file);
    await state.initialize();
    await state.setPinned(ID_A, true);
    await state.allowOrigin(ID_A, 'https://news.test', BROAD);
    await state.forget(ID_A);
    expect(state.isPinned(ID_A)).toBe(false);
    expect(state.configOf(ID_A, BROAD).sessionSites).toEqual([]);
  });
});
