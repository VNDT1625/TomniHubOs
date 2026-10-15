import { describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '../../../../packages/desktop/src/common/packages';

const EXTENSION = {
  kind: 'extension',
  id: 'dark-mode',
  title: 'Dark mode',
  format: 'chrome-mv3',
  root: 'source/extension/dist',
  permissions: ['storage'],
  hostPermissions: ['https://example.com/*'],
  unsupported: [],
};

const document = (extra: Record<string, unknown>): unknown => ({
  schemaVersion: 1,
  generatedBy: 'classifier',
  connections: [{ ...EXTENSION, ...extra }],
});

const surfacesOf = (parsed: ReturnType<typeof parseAdapterDocument>): unknown =>
  (parsed.connections[0] as { surfaces?: unknown }).surfaces;

describe('extension connection surfaces', () => {
  it('reads a document without surfaces, which means none downstream', () => {
    expect(surfacesOf(parseAdapterDocument(document({})))).toBeUndefined();
  });

  it('accepts lower-case surface names and keeps them', () => {
    expect(surfacesOf(parseAdapterDocument(document({ surfaces: ['browser'] })))).toEqual(['browser']);
  });

  it('refuses a malformed surface name when writing', () => {
    expect(() => parseAdapterDocument(document({ surfaces: ['Bad Name'] }))).toThrow();
    expect(() => parseAdapterDocument(document({ surfaces: ['../etc'] }))).toThrow();
  });

  it('refuses more than eight surfaces', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `s${index}`);
    expect(() => parseAdapterDocument(document({ surfaces: nine }))).toThrow();
  });
});
