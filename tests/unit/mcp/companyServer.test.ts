import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import {
  COMPANY_GENERATOR_TRANSPORT_DISABLED,
  createCompanyServer,
} from '@/process/resources/builtinMcp/companyServer';

const resultText = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const text = result.content.find((item) => item.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Expected an MCP text result.');
  return text.text;
};

const connectCompanyServer = async () => {
  const server = createCompanyServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'company-server-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
};

describe('built-in Company MCP provider containment', () => {
  it('fails closed before provider configuration or outbound execution for company_create', async () => {
    const { client, server } = await connectCompanyServer();
    const result = await client.callTool({
      name: 'company_create',
      arguments: { description: 'A company with an intentionally legacy provider configuration.' },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(`Error: ${COMPANY_GENERATOR_TRANSPORT_DISABLED}`);
    await Promise.all([client.close(), server.close()]);
  });

  it('does not retain a standalone-child provider credential or direct completion path', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'packages/desktop/src/process/resources/builtinMcp/companyServer.ts'),
      'utf8'
    );

    expect(source).not.toContain('TOMNY_COMPANY_API_KEY');
    expect(source).not.toContain('ClientFactory.createRotatingClient');
    expect(source).not.toContain('createChatCompletion');
  });
});
