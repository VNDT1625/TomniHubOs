import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { FoundationTrustRuntime } from '@process/foundation/runKernel';
import { createProviderDestinationAuthority } from '@process/services/security/providerExecution/providerDestinationAuthority';
import { createProviderExecutionBroker } from '@process/services/security/providerExecution/providerExecutionBroker';
import { MemoryDurableEventStore } from '@process/services/agentChat/durability';
import {
  createBrokerBackedTomniModelService,
  createModelRequestHistory,
  startTomniGateway,
  createTomniGatewayModelConsumerRegistry,
  type ModelConsumerVault,
  type TomniGatewayModelConsumerRecord,
  type TomniGatewayServer,
} from '@process/tomnigateway';
import { applyConnectorPlan, type Router9ApplierDeps } from '@process/router9/router9Applier';
import type { Router9Endpoint } from '@/common/router9';

const API_KEY = 'provider-secret-must-not-leak';
const servers: Server[] = [];
const gateways: TomniGatewayServer[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const provider = (baseUrl: string): IProvider => ({
  id: 'provider-1',
  name: 'Stub provider',
  platform: 'openai',
  base_url: baseUrl,
  api_key: API_KEY,
  models: ['relay-model'],
  is_full_url: true,
});

const vault = (): ModelConsumerVault => {
  let records: TomniGatewayModelConsumerRecord[] = [];
  return {
    list: async () => records,
    save: async (record) => {
      records = [...records.filter((item) => item.consumerId !== record.consumerId), record];
    },
    revoke: async (consumerId) => {
      const before = records.length;
      records = records.map((record) =>
        record.consumerId === consumerId ? { ...record, revokedAt: new Date().toISOString() } : record
      );
      return records.length === before && records.some((record) => record.consumerId === consumerId);
    },
    rotate: async (input) => {
      const index = records.findIndex(
        (record) => record.consumerId === input.consumerId && record.actorId === input.actorId
      );
      if (index < 0) return false;
      records[index] = {
        ...records[index]!,
        credentialDigest: input.credentialDigest,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
      return true;
    },
  };
};

const createDeps = (files: Map<string, string>): Router9ApplierDeps => ({
  homeDir: () => '/home/test',
  readFile: vi.fn(async (path: string) => files.get(path)),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    files.set(path, content);
  }),
  backup: vi.fn(async () => undefined),
});

describe('Provider Relay MVP end-to-end', () => {
  it('relays provider API usage through a scoped gateway credential and connector config', async () => {
    const providerRequests: Array<{ authorization?: string; body: string }> = [];
    const providerServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        providerRequests.push({
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify(
            providerRequests.length === 1
              ? {
                  choices: [{ message: { content: 'relay answer' } }],
                  usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
                }
              : { choices: [{ message: { content: 'estimated answer' } }] }
          )
        );
      });
    });
    servers.push(providerServer);
    await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
    const port = (providerServer.address() as AddressInfo).port;
    const savedProvider = provider(`http://127.0.0.1:${port}/v1/chat/completions`);
    const runtime = new FoundationTrustRuntime({
      actorId: () => 'account-1',
      policy: {
        allowedCapabilities: ['provider.execute', 'secret.use'],
        allowedNetworkHosts: ['127.0.0.1'],
        trustedPackageIds: [],
        allowedOrigins: ['tomny://provider-execution'],
        requireApprovalForMutation: true,
        capabilityGrantTtlMs: 60_000,
        policyVersion: 'relay-test-v1',
      },
    });
    const authority = createProviderDestinationAuthority({
      actorId: () => 'account-1',
      providerStore: {
        getDestinationBinding: vi.fn(async () => ({
          providerId: savedProvider.id,
          endpoint: savedProvider.base_url,
          isFullUrl: true,
          version: 1,
        })),
      },
    });
    const broker = createProviderExecutionBroker({
      trustRuntime: runtime,
      providerStore: { list: async () => [savedProvider], get: async () => savedProvider },
      actorId: () => 'account-1',
      destinationAuthority: authority,
      semanticEgressAuditSink: { append: async () => undefined },
    });
    const registry = createTomniGatewayModelConsumerRegistry({
      vault: vault(),
      actorId: () => 'account-1',
      newId: () => 'consumer-1',
      newCredential: () => 'consumer-secret',
    });
    const history = createModelRequestHistory(new MemoryDurableEventStore());
    const model = createBrokerBackedTomniModelService({
      broker,
      resolveCredential: registry.resolveCredential,
      getConsumer: registry.getConsumer,
      history,
      actorId: () => 'account-1',
    });
    const gateway = await startTomniGateway({
      auth: { sessionTokens: ['gateway-session-0123456789'], allowedOrigins: ['https://client.test'] },
      services: {
        collections: {
          conversations: { list: async () => [], get: async () => undefined },
          teams: { list: async () => [], get: async () => undefined },
          companies: { list: async () => [], get: async () => undefined },
          cron: { list: async () => [], get: async () => undefined },
          mcp: { list: async () => [], get: async () => undefined },
        },
        conversationMessages: async () => [],
        model,
      },
    });
    gateways.push(gateway);
    const issued = await registry.issue({ label: 'third-party', allowedModels: ['relay-model'], ttlMs: 60_000 });
    const response = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        origin: 'https://client.test',
        authorization: `Bearer ${issued.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'relay-model', messages: [{ role: 'user', content: 'hello' }] }),
    });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.choices[0].message.content).toBe('relay answer');
    expect(result.usage).toEqual({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
    expect(providerRequests[0]).toEqual({
      authorization: `Bearer ${API_KEY}`,
      body: JSON.stringify({ model: 'relay-model', messages: [{ role: 'user', content: 'hello' }], stream: false }),
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    const estimatedResponse = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        origin: 'https://client.test',
        authorization: `Bearer ${issued.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'relay-model', messages: [{ role: 'user', content: 'estimate' }] }),
    });
    const estimatedResult = await estimatedResponse.json();
    expect(estimatedResponse.status).toBe(200);
    expect(estimatedResult.choices[0].message.content).toBe('estimated answer');
    expect(estimatedResult.usage).toBeUndefined();
    expect(JSON.stringify(estimatedResult)).not.toContain(API_KEY);
    await expect(history.list({ actorId: 'account-1' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          usage: { source: 'reported', promptCount: 4, completionCount: 3, totalCount: 7 },
          status: 'completed',
        }),
        expect.objectContaining({
          usage: expect.objectContaining({ source: 'estimated' }),
          status: 'completed',
        }),
      ])
    );
    const files = new Map<string, string>();
    const endpoint: Router9Endpoint = { baseUrl: `${gateway.url}/v1`, apiKey: issued.credential, model: 'relay-model' };
    await applyConnectorPlan('codex', endpoint, createDeps(files));
    expect([...files.values()][0]).toContain(issued.credential);
    expect([...files.values()][0]).not.toContain(API_KEY);
  });
});
