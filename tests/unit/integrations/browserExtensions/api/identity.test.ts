import { describe, expect, it } from 'vitest';
import {
  extensionIdFromPageUrl,
  extensionIdFromScope,
  resolveCaller,
} from '@process/integrations/browserExtensions/api/identity';

const ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('extension identity from the sender origin', () => {
  it('reads the id of a service worker scope', () => {
    expect(extensionIdFromScope(`chrome-extension://${ID}/`)).toBe(ID);
    expect(resolveCaller({ kind: 'service-worker', scope: `chrome-extension://${ID}/` })).toEqual({
      extensionId: ID,
      kind: 'service-worker',
    });
  });

  it('reads the id of an extension page, whatever its path', () => {
    expect(extensionIdFromPageUrl(`chrome-extension://${ID}/popup.html`)).toBe(ID);
    expect(extensionIdFromPageUrl(`chrome-extension://${ID}/a/b.html?x=1#y`)).toBe(ID);
    expect(resolveCaller({ kind: 'frame', url: `chrome-extension://${ID}/options.html` })?.kind).toBe('frame');
  });

  it.each([
    ['a web page', 'https://example.com/'],
    ['a web page that spells the id in its path', `https://example.com/chrome-extension://${ID}/`],
    ['a file page', `file:///C:/${ID}/popup.html`],
    ['an uppercase id', `chrome-extension://${ID.toUpperCase()}/popup.html`],
    ['a short id', 'chrome-extension://abcdefghijklmnop/popup.html'],
    ['an id with letters outside a-p', `chrome-extension://${'z'.repeat(32)}/popup.html`],
    ['an id with user info', `chrome-extension://user:pw@${ID}/popup.html`],
    ['an id with a port', `chrome-extension://${ID}:8080/popup.html`],
    ['an id used as a subdomain', `chrome-extension://${ID}.evil.test/popup.html`],
    ['an empty string', ''],
    ['not a URL', 'not a url'],
  ])('refuses %s', (_name, url) => {
    expect(extensionIdFromPageUrl(url)).toBeUndefined();
    expect(resolveCaller({ kind: 'frame', url })).toBeUndefined();
  });

  it('accepts only the root as a service worker scope', () => {
    expect(extensionIdFromScope(`chrome-extension://${ID}/sub/`)).toBeUndefined();
    expect(extensionIdFromScope(`chrome-extension://${ID}/?a=1`)).toBeUndefined();
    expect(extensionIdFromScope(`https://example.com/`)).toBeUndefined();
  });

  it('refuses values that are not strings and very long URLs', () => {
    expect(extensionIdFromScope(undefined)).toBeUndefined();
    expect(extensionIdFromPageUrl(42)).toBeUndefined();
    expect(extensionIdFromPageUrl(`chrome-extension://${ID}/${'a'.repeat(5000)}`)).toBeUndefined();
  });
});
