import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (): string =>
  readFileSync(path.join(process.cwd(), 'packages/package-apps/browser/src/process/browserControlWiring.ts'), 'utf8');

describe('Browser-Control filesystem mutation containment', () => {
  it('does not compose screenshot persistence and rejects editor writes before NativeFileGateway mutation', () => {
    const content = source();

    expect(content).toContain('BROWSER_CONTROL_EDITOR_WRITE_GOVERNANCE_REQUIRED');
    expect(content).toContain('Promise.reject(new Error(BROWSER_CONTROL_EDITOR_WRITE_GOVERNANCE_REQUIRED))');
    expect(content).not.toContain('persistScreenshot: async');
    expect(content).not.toContain('await new NativeFileGateway().writeText(filePath, content);');
    expect(content).not.toContain("join(app.getPath('userData'), 'browser-captures')");
  });
});
