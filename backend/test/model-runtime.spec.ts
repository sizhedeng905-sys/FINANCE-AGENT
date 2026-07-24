import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

import { ModelExecutionGateService } from '../src/model-runtime/model-execution-gate.service';
import { resolveModelDeployment } from '../src/model-runtime/model-deployment-config';
import { probeModelDeployment } from '../src/model-runtime/model-health-probe';
import { ModelRuntimeService } from '../src/model-runtime/model-runtime.service';
import { ResilientHttpClientService } from '../src/model-runtime/resilient-http-client.service';
import { StructuredOutputValidatorService } from '../src/model-runtime/structured-output-validator.service';
import { HttpAiProviderService } from '../src/ai/http-ai-provider.service';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('model runtime safeguards', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts only strict JSON and rejects fenced, duplicate, unsafe, or oversized structures', () => {
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
    expect(validator.parseAndValidate(schema, '{"amount":1280.5,"currency":"CNY"}')).toEqual({
      amount: 1280.5,
      currency: 'CNY'
    });
    expect(() => validator.parseAndValidate(schema, '```json\n{"amount":1280.5,"currency":"CNY"}\n```'))
      .toThrow('INVALID_JSON');
    expect(() => validator.parseAndValidate(schema, '{"amount":1,"amount":2,"currency":"CNY"}'))
      .toThrow('DUPLICATE_KEY');
    expect(() => validator.parseAndValidate(schema, '{"amount":1e3,"currency":"CNY"}'))
      .toThrow('EXPONENT_NUMBER');
    expect(() => validator.parseAndValidate(schema, '{"amount":1,"currency":"CNY","__proto__":{}}'))
      .toThrow('FORBIDDEN_KEY');
    expect(() => validator.parseAndValidate(schema, '{"amount":1,"currency":"safe\\u202Eunsafe"}'))
      .toThrow('FORBIDDEN_CHARACTER');
    expect(() => validator.parseAndValidate(schema, '{"amount":1,"currency":"CNY"}', { maxBytes: 8 }))
      .toThrow('SIZE_LIMIT');
    expect(() => validator.validate(schema, { amount: '1280.5', currency: 'CNY' })).toThrow('结构化输出不合法');
    expect(() => validator.parseAndValidate(schema, 'not-json')).toThrow('INVALID_JSON');
  });

  it('queues model work at the configured concurrency and rejects an overflowing queue', async () => {
    const gate = new ModelExecutionGateService(config({ 'modelRuntime.maxQueue': 1 }), {} as any);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = gate.run('gpu', 1, async () => blocker);
    await Promise.resolve();
    const second = gate.run('gpu', 1, async () => 'second');
    await Promise.resolve();
    await expect(gate.run('gpu', 1, async () => 'third')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Object.values(await gate.snapshot())).toContainEqual(expect.objectContaining({ active: 1, queued: 1 }));
    release();
    await first;
    await expect(second).resolves.toBe('second');
  });

  it.each([1, 3, 5])('honors a max concurrency of %i without losing queued work', async (maxConcurrency) => {
    const gate = new ModelExecutionGateService(config({ 'modelRuntime.maxQueue': 10 }), {} as any);
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
    expect(Object.values(await gate.snapshot())).toContainEqual(expect.objectContaining({ active: 0, queued: 0 }));
  });

  it('keeps the single-concurrency OCR queue independent from text AI work', async () => {
    const gate = new ModelExecutionGateService(config({ 'modelRuntime.maxQueue': 10 }), {} as any);
    let releaseOcr!: () => void;
    const ocrBlocker = new Promise<void>((resolve) => { releaseOcr = resolve; });
    const firstOcr = gate.run('ocr', 1, async () => ocrBlocker);
    await Promise.resolve();
    const secondOcr = gate.run('ocr', 1, async () => 'ocr-second');
    await Promise.resolve();

    await expect(gate.run('ai', 1, async () => 'ai-ready')).resolves.toBe('ai-ready');
    expect(Object.values(await gate.snapshot())).toEqual(expect.arrayContaining([
      expect.objectContaining({ active: 1, queued: 1 }),
      expect.objectContaining({ active: 0, queued: 0 })
    ]));
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

  it('enforces provider HTTP timeout after execution begins', async () => {
    const client = new ResilientHttpClientService(config({
      'modelRuntime.httpMaxRetries': 0,
      'modelRuntime.circuitFailureThreshold': 3,
      'modelRuntime.circuitResetMs': 30000
    }));
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')), { once: true });
    }));
    const startedAt = Date.now();
    await expect(client.request('http://127.0.0.1:65534/slow', { method: 'GET' }, {
      circuitKey: 'timeout-test',
      timeoutMs: 25,
      maxRetries: 0
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });

  it('aborts provider HTTP without retrying or poisoning the circuit when the shared lease is lost', async () => {
    const client = new ResilientHttpClientService(config({
      'modelRuntime.httpMaxRetries': 3,
      'modelRuntime.circuitFailureThreshold': 2,
      'modelRuntime.circuitResetMs': 30000
    }));
    const started = deferredForTest();
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('lease lost', 'AbortError')),
          { once: true }
        );
      });
    });
    const controller = new AbortController();
    const request = client.request('http://127.0.0.1:65534/inference', { method: 'POST' }, {
      circuitKey: 'shared-lease-abort',
      timeoutMs: 5_000,
      maxRetries: 3,
      signal: controller.signal
    });
    await started.promise;
    controller.abort(new Error('shared lease lost'));

    await expect(request).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.snapshot()).toMatchObject({ 'shared-lease-abort': { failures: 0, open: false } });
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
      request: jest.fn(async (url: string) => {
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'Qwen/test' }] }), { status: 200 });
        }
        if (url.endsWith('/version')) {
          return new Response(JSON.stringify({ version: 'test' }), { status: 200 });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
      }),
      snapshot: jest.fn(() => ({}))
    };
    const gate: any = {
      run: jest.fn(async (_key: string, _limit: number, operation: (signal: AbortSignal) => Promise<unknown>) => (
        operation(new AbortController().signal)
      )),
      snapshot: jest.fn(() => ({}))
    };
    const runtime = new ModelRuntimeService(prisma, http, gate);

    await expect(runtime.health()).resolves.toMatchObject({ status: 'ok' });
    expect(gate.run).toHaveBeenCalledWith(
      `ai:${resolveModelDeployment(deployment).configHash}`,
      1,
      expect.any(Function)
    );
    expect(http.request).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1/models',
      { method: 'GET', headers: { Authorization: 'Bearer local-test-secret' } },
      expect.objectContaining({ maxRetries: 0 })
    );
    expect(runtime.resolveSecret('not-an-env-name')).toBeUndefined();
    delete process.env.MODEL_TEST_API_KEY;
  });

  it('rejects unauthenticated or mismatched Paddle readiness responses', async () => {
    const deployment = resolveModelDeployment({
      id: 'paddle-1',
      deploymentKey: 'paddle-local',
      provider: 'local_paddle',
      modelName: 'PaddlePaddle/PaddleOCR-VL',
      modelVersion: 'v1',
      endpoint: 'http://127.0.0.1:8868/',
      secretRef: 'OCR_API_KEY',
      taskTypes: ['ocr_document'],
      maxConcurrency: 1,
      timeoutMs: 3000,
      isLocal: true,
      isEnabled: true
    });
    const unauthorized = jest.fn(async () => new Response(
      JSON.stringify({ detail: 'invalid bearer token' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ));
    await expect(probeModelDeployment(deployment, 'wrong-key', unauthorized)).rejects.toThrow('HTTP 401');
    expect(unauthorized).toHaveBeenCalledWith(
      'http://127.0.0.1:8868/ready',
      { method: 'GET', headers: { Authorization: 'Bearer wrong-key' } },
      3000,
      'ready'
    );

    const mismatch = jest.fn(async () => new Response(JSON.stringify({
      status: 'ready',
      model: { name: 'PaddlePaddle/PaddleOCR-VL', version: 'v2' },
      capabilities: ['ocr_document']
    }), { status: 200 }));
    await expect(probeModelDeployment(deployment, 'correct-key', mismatch)).rejects.toThrow('version does not match');
  });

  it('passes the resolved endpoint, timeout, concurrency, and config hash to an AI request', async () => {
    const http = {
      request: jest.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"claims":[]}' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    } as any;
    const gate = {
      run: jest.fn(async (_key: string, _limit: number, operation: () => Promise<unknown>) => operation())
    } as any;
    const provider = new HttpAiProviderService(config({
      'ai.maxOutputTokens': 120,
      'ai.maxResponseBytes': 1024
    }), http, gate);
    const beforeProviderRequest = jest.fn(async () => undefined);

    await expect(provider.generate({
      provider: 'openai_compatible',
      providerClass: 'local',
      model: 'Qwen/test',
      modelVersion: '0.23.0',
      deploymentId: 'deployment-1',
      deploymentKey: 'qwen-test',
      baseUrl: 'http://127.0.0.1:18000/v1',
      apiKey: 'route-secret',
      secretRef: 'MODEL_TEST_API_KEY',
      timeoutMs: 4321,
      maxConcurrency: 3,
      configHash: 'config-hash-1',
      instructions: 'Return JSON.',
      question: 'health',
      history: [],
      contexts: [],
      beforeProviderRequest
    })).resolves.toMatchObject({ text: '{"claims":[]}' });

    expect(beforeProviderRequest).toHaveBeenCalledTimes(1);
    expect(gate.run).toHaveBeenCalledWith('ai:config-hash-1', 3, expect.any(Function));
    expect(http.request).toHaveBeenCalledWith(
      'http://127.0.0.1:18000/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer route-secret' })
      }),
      expect.objectContaining({ timeoutMs: 4321 })
    );
  });

  it('sends the rendered versioned user prompt instead of bypassing it with a generic wrapper', async () => {
    const http = {
      request: jest.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"decision":"NEEDS_FINANCE_REVIEW"}' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    } as any;
    const gate = {
      run: jest.fn(async (_key: string, _limit: number, operation: () => Promise<unknown>) => operation())
    } as any;
    const provider = new HttpAiProviderService(config({ 'ai.maxResponseBytes': 1024 }), http, gate);
    const renderedUserPrompt = '<excel_mapping_input_json>{"sourceId":"source-1"}</excel_mapping_input_json>';

    await provider.generate({
      provider: 'openai_compatible',
      providerClass: 'local',
      model: 'Qwen/test',
      baseUrl: 'http://127.0.0.1:18000/v1',
      apiKey: 'route-secret',
      instructions: 'Return strict JSON.',
      question: '',
      history: [],
      contexts: [],
      structuredInput: { sourceId: 'source-1' },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evidenceRefs: {
            type: 'array',
            uniqueItems: true,
            items: { type: 'string' }
          }
        }
      },
      renderedUserPrompt
    } as any);

    const body = JSON.parse(http.request.mock.calls[0][1].body);
    const userMessage = body.messages.at(-1).content as string;
    expect(userMessage).toContain(renderedUserPrompt);
    expect(userMessage).toContain('"uniqueItems":true');
    expect(userMessage).not.toContain('<untrusted_structured_input_json>');
    expect(body.response_format.json_schema.schema.properties.evidenceRefs).not.toHaveProperty('uniqueItems');

    await expect(provider.generate({
      provider: 'openai_compatible',
      model: 'Qwen/test',
      baseUrl: 'http://127.0.0.1:18000/v1',
      apiKey: 'route-secret',
      instructions: 'x'.repeat(120),
      question: '',
      history: [],
      contexts: [],
      outputSchema: { type: 'object' },
      renderedUserPrompt: '<input>{}</input>',
      maxInputCharacters: 200
    } as any)).rejects.toThrow('完整请求超过安全上限');
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('keeps the complete response schema for non-local compatible providers', async () => {
    const http = {
      request: jest.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"values":[]}' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    } as any;
    const gate = {
      run: jest.fn(async (_key: string, _limit: number, operation: () => Promise<unknown>) => operation())
    } as any;
    const provider = new HttpAiProviderService(config({ 'ai.maxResponseBytes': 1024 }), http, gate);
    const outputSchema = {
      type: 'object',
      properties: {
        values: { type: 'array', uniqueItems: true, items: { type: 'string' } }
      }
    };

    await provider.generate({
      provider: 'openai_compatible',
      providerClass: 'external',
      model: 'compatible/test',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'route-secret',
      instructions: 'Return strict JSON.',
      question: '',
      history: [],
      contexts: [],
      outputSchema
    } as any);

    const body = JSON.parse(http.request.mock.calls[0][1].body);
    expect(body.response_format.json_schema.schema).toEqual(outputSchema);
  });
});

function deferredForTest() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
