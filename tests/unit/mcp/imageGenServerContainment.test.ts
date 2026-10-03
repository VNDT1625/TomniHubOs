import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const IMAGE_MCP_SOURCE = path.join(
  process.cwd(),
  'packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts'
);

const readImageMcpSource = (): string => readFileSync(IMAGE_MCP_SOURCE, 'utf8');

describe('built-in Image MCP egress containment', () => {
  it('fails closed before it can inspect provider configuration, image input, or transport', () => {
    const source = readImageMcpSource();

    expect(source).toContain('IMAGE_EGRESS_DISABLED_MESSAGE');
    expect(source).toContain('async () => {');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('getProviderFromEnv');
    expect(source).not.toContain('executeImageGeneration');
    expect(source).not.toContain('TOMNY_IMG_API_KEY');
    expect(source).not.toContain('TOMNY_IMG_PROXY');
  });

  it('retains only the safe MCP metadata and an unavailable response', () => {
    const source = readImageMcpSource();

    expect(source).toContain("'tomny_image_generation'");
    expect(source).toContain(
      'No image file, URL, prompt, provider configuration, credential, or network destination is processed'
    );
    expect(source).toContain('isError: true');
  });
});
