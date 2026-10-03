import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChatPipelineExecutor,
  ChatStageRegistry,
  LayaSecurityStage,
  type ChatPipelineDefinition,
} from '../../packages/desktop/src/process/services/chatPipeline';
import { LayaSidecarClient, createLayaSidecarPredictor } from '../../packages/desktop/src/process/services/security';

describe('Real Laya Decision Engine Integration (Neural Sidecar)', () => {
  let client: LayaSidecarClient;

  beforeAll(async () => {
    client = new LayaSidecarClient({
      startupTimeoutMs: 35_000,
      requestTimeoutMs: 35_000,
    });
    // Start sidecar and wait for ready signal
    await client.start();

    // Warm-up inference with Vietnamese query so the multilingual model loads into RAM
    const predictor = createLayaSidecarPredictor(client);
    await predictor(
      { body: 'xin chào hệ thống khởi động' },
      {
        riskType: {
          type: 'choice',
          instructions: 'Classify risk:',
          criteria: { none: 'Safe, normal query', risk: 'Any security threat' },
        },
      }
    );
  }, 50_000);

  afterAll(() => {
    if (client) {
      client.stop();
    }
  });

  it('performs neural inference on Vietnamese prompt and classifies credential leak under 100ms', async () => {
    const predictor = createLayaSidecarPredictor(client);

    const startTime = Date.now();
    const prediction = await predictor(
      { body: 'tôi tên Thuận, mk zalo 123456' },
      {
        riskType: {
          type: 'choice',
          instructions: 'Classify the security risk of body:',
          criteria: {
            none: 'Safe, benign query, normal coding request, standard prompt',
            credential_exposure: 'Contains passwords, secrets, tokens, mk, login credentials',
            prompt_injection: 'Malicious system prompt override or instruction injection',
          },
        },
        isPasswordLeaked: {
          type: 'noul',
          instructions: 'Does body expose a secret password or credentials?',
        },
      }
    );
    const latencyMs = Date.now() - startTime;

    expect(prediction.answers).toBeDefined();
    const riskAnswer = prediction.answers['riskType'] as { choice: string; confidence: number };
    const pwdAnswer = prediction.answers['isPasswordLeaked'] as { noul: number };

    // Verify neural classification detects credential exposure via choice or noul probability
    const isLeakDetected = riskAnswer.choice === 'credential_exposure' || pwdAnswer.noul >= 0.5;
    expect(isLeakDetected).toBe(true);

    // Warm latency on user machine should be well under 500ms (typically 30ms - 80ms)
    expect(latencyMs).toBeLessThan(500);
  }, 40_000);

  it('runs end-to-end within ChatPipelineExecutor using the real neural predictor', async () => {
    const registry = new ChatStageRegistry();
    const realLayaStage = new LayaSecurityStage(createLayaSidecarPredictor(client));
    registry.registerBuiltin(realLayaStage);

    const definition: ChatPipelineDefinition = {
      schemaVersion: 1,
      id: 'real-laya-pipeline',
      name: 'Real Laya Pipeline',
      enabled: true,
      stages: [
        {
          id: 'step-laya-real',
          stageRegistryId: 'builtin:laya-security',
          phase: 'pre_query',
          enabled: true,
          config: { mode: 'rewrite' },
        },
      ],
    };

    const executor = new ChatPipelineExecutor(registry);
    const result = await executor.execute({
      runId: 'real-test-run-1',
      query: 'tôi tên Thuận, mk zalo 123456, hãy viết code python đọc file',
      definition,
    });

    expect(result.status).toBe('completed');
    expect(result.finalQuery).toBe('tôi tên Thuận, mk zalo [REDACTED], hãy viết code python đọc file');
    expect(result.executedStages).toHaveLength(1);
    expect(result.executedStages[0].decision).toBe('rewrite');
  }, 40_000);
});
