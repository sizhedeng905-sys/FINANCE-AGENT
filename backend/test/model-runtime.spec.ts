import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

import { ModelExecutionGateService } from '../src/model-runtime/model-execution-gate.service';
import { ModelRuntimeService } from '../src/model-runtime/model-runtime.service';
import { ResilientHttpClientService } from '../src/model-runtime/resilient-http-client.service';
import { StructuredOutputValidatorService } from '../src/model-runtime/structured-output-validator.service';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('model runtime safeguards', () => {
  afterEach(() => jest.restoreAllMocks());

  it('parses fenced JSON and rejects output that violates its schema', () => {
    const validator = new StructuredOutputValidatorService();
    const schema = {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        currency: { type: 'string' }
      },
      required: ['amount', 'currency'],
      additionalProperties: false
    } as any;
    expect(validator.parseAndValidate(schema, '```json\n{"amount":1280.5,"currency":"CNY"}\n```')).toEqual({
      amount: 1280.5,
      currency: 'CNY'
    });
    expect(() => validator.validate(schema, { amount: '1280.5', currency: 'CNY' })).toThrow('结构化输出不合法');
    expect(() => validator.parseAndValidate(schema, 'not-json')).toThrow('合法 JSON');
  });

  it('queues model work at the configured concurrency and rejects an overflowing queue', async () => {
    const gate = new ModelExecutionGateService(config({ 'modelRuntime.maxQueue': 1 }));
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = gate.run('gpu', 1, async () => blocker);
    await Promise.resolve();
    const second = gate.run('gpu', 1, async () => 'second');
    await Promise.resolve();
    await expect(gate.run('gpu', 1, async () => 'third')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(gate.snapshot()).toMatchObject({ gpu: { active: 1, queued: 1 } });
    release();
    await first;
    await expect(second).resolves.toBe('second');
  });

  it.each([1, 3, 5])('honors a max concurrency of %i without losing queued work', async (maxConcurrency) => {
    const gate = new ModelExecutionGateService(config({ 'modelRuntime.maxQueue': 10 }));
    let active = 0;
    let peak = 0;
    const completed = await Promise.all(Array.from({ length: 5 }, (_, index) => gate.run(
      `batch-${maxConcurrency}`,
      maxConcurrency,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return index;
      }
    )));

    expect(completed).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(maxConcurrency);
    expect(gate.snapshot()).toMatchObject({
      [`batch-${maxConcurrency}`]: { active: 0, queued: 0 }
    });
  });

  it('keeps the single-concurrency OCR queue independent from text AI work', async () => {
    const gate = new ModelExecutionGateService(config({ 'modelRuntime.maxQueue': 10 }));
    let releaseOcr!: () => void;
    const ocrBlocker = new Promise<void>((resolve) => { releaseOcr = resolve; });
    const firstOcr = gate.run('ocr', 1, async () => ocrBlocker);
    await Promise.resolve();
    const secondOcr = gate.run('ocr', 1, async () => 'ocr-second');
    await Promise.resolve();

    await expect(gate.run('ai', 1, async () => 'ai-ready')).resolves.toBe('ai-ready');
    expect(gate.snapshot()).toMatchObject({
      ocr: { active: 1, queued: 1 },
      ai: { active: 0, queued: 0 }
    });
    releaseOcr();
    await firstOcr;
    await expect(secondOcr).resolves.toBe('ocr-second');
  });

  it('opens a circuit after consecutive model network failures', async () => {
    const client = new ResilientHttpClientService(config({
      'modelRuntime.httpMaxRetries': 0,
      'modelRuntime.circuitFailureThreshold': 2,
      'modelRuntime.circuitResetMs': 30000
    }));
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const options = { circuitKey: 'local-model', timeoutMs: 1000, maxRetries: 0 };
    await expect(client.request('http://127.0.0.1:65534/health', { method: 'GET' }, options)).rejects.toThrow('网络请求失败');
    await expect(client.request('http://127.0.0.1:65534/health', { method: 'GET' }, options)).rejects.toThrow('网络请求失败');
    await expect(client.request('http://127.0.0.1:65534/health', { method: 'GET' }, options)).rejects.toThrow('熔断中');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.snapshot()).toMatchObject({ 'local-model': { failures: 2, open: true } });
  });

  it('uses only allowlisted environment secret names for authenticated health checks', async () => {
    process.env.MODEL_TEST_API_KEY = 'local-test-secret';
    const deployment = {
      id: 'deployment-1',
      deploymentKey: 'qwen-test',
      provider: 'openai_compatible',
      modelName: 'Qwen/test',
      modelVersion: 'test',
      endpoint: 'http://127.0.0.1:8000/v1',
      secretRef: 'MODEL_TEST_API_KEY',
      taskTypes: ['boss_chat'],
      maxConcurrency: 1,
      timeoutMs: 1000,
      isLocal: true,
      isEnabled: true,
      status: 'unknown',
      lastHealthAt: null,
      lastHealthLatencyMs: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const prisma: any = {
      modelDeployment: {
        findMany: jest.fn(async () => [deployment]),
        update: jest.fn(async () => deployment)
      }
    };
    const http: any = {
      request: jest.fn(async () => new Response('{}', { status: 200 })),
      snapshot: jest.fn(() => ({}))
    };
    const gate: any = { snapshot: jest.fn(() => ({})) };
    const runtime = new ModelRuntimeService(prisma, http, gate);

    await expect(runtime.health()).resolves.toMatchObject({ status: 'ok' });
    expect(http.request).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1/models',
      { method: 'GET', headers: { Authorization: 'Bearer local-test-secret' } },
      expect.objectContaining({ maxRetries: 0 })
    );
    expect(runtime.resolveSecret('not-an-env-name')).toBeUndefined();
    delete process.env.MODEL_TEST_API_KEY;
  });
});
