import { describe, expect, it } from 'vitest';
import {
  createChatTemporarySecretStore,
  createKeyedSecretIndex,
  type ChatSecretCodec,
} from '../../../packages/desktop/src/process/services/security';
import {
  ChatPipelineExecutor,
  ChatStageRegistry,
  LayaSecurityStage,
  type ChatPipelineDefinition,
} from '../../../packages/desktop/src/process/services/chatPipeline';

describe('LayaSecurityStage with Temporary Secret Vault & Keyed Index', () => {
  const codec: ChatSecretCodec = {
    available: () => true,
    encrypt: (v: string) => Buffer.from(v, 'utf8').toString('base64'),
    decrypt: (v: string) => Buffer.from(v, 'base64').toString('utf8'),
  };

  it('automatically stores detected password in Temporary Secret Store and Keyed Index', async () => {
    const secretStore = createChatTemporarySecretStore(codec);
    const keyedSecretIndex = createKeyedSecretIndex('test-vault');

    const layaStage = new LayaSecurityStage({
      secretStore,
      keyedSecretIndex,
    });

    const registry = new ChatStageRegistry();
    registry.registerBuiltin(layaStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'pipeline-sec-vault',
      name: 'Vault Pipeline',
      enabled: true,
      stages: [
        {
          id: 'step-laya',
          stageRegistryId: 'builtin:laya-security',
          phase: 'pre_query',
          enabled: true,
        },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const sessionId = 'session-test-vault-123';
    const rawSecret = 'SecretSuperPass123!@#';
    const query = `Xin chào, mật khẩu tài khoản của tôi là ${rawSecret}, hãy kiểm tra giúp tôi.`;

    const result = await executor.execute({
      runId: sessionId,
      query,
      definition,
    });

    expect(result.status).toBe('completed');
    // 1. Raw password must NOT be in finalQuery!
    expect(result.finalQuery).not.toContain(rawSecret);
    // 2. Query must have rewritten placeholder
    expect(result.finalQuery).toContain('[PASSWORD_TEMP_01]');

    // 3. Secret must be stored in secretStore under sessionId
    const storedList = secretStore.list(sessionId);
    expect(storedList.length).toBe(1);
    expect(storedList[0].label).toBe('password');
    expect(storedList[0].category).toBe('credential');
    expect(storedList[0].handle).toMatch(/^temp:\/\/chat\//);

    // 4. Secret can be accepted/decrypted from vault
    const accepted = secretStore.accept(sessionId, storedList[0].handle);
    expect(accepted.value).toBe(rawSecret);

    // 5. Secret fingerprint must be registered in keyedSecretIndex
    expect(keyedSecretIndex.has(rawSecret)).toBe(true);
    expect(keyedSecretIndex.hasInText(query)).toBe(true);
  });

  it('falls back gracefully to standard redaction if secretStore is not provided', async () => {
    const layaStage = new LayaSecurityStage();
    const registry = new ChatStageRegistry();
    registry.registerBuiltin(layaStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'pipeline-sec-fallback',
      name: 'Fallback Pipeline',
      enabled: true,
      stages: [
        {
          id: 'step-laya',
          stageRegistryId: 'builtin:laya-security',
          phase: 'pre_query',
          enabled: true,
        },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      runId: 'session-no-vault',
      query: 'Mật khẩu là Abcd123456@',
      definition,
    });

    expect(result.status).toBe('completed');
    expect(result.finalQuery).not.toContain('Abcd123456@');
    expect(result.finalQuery).toContain('[REDACTED]');
  });
});
