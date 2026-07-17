import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';

import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { redisReconnectStrategy } from '../src/infrastructure/redis/redis.service';
import { MetricsService } from '../src/observability/metrics.service';
import { TraceExporterService } from '../src/observability/trace-exporter.service';
import { TracingMiddleware } from '../src/observability/tracing.middleware';

describe('observability', () => {
  it('bounds initial Redis retries and keeps reconnecting after a healthy connection', () => {
    expect(redisReconnectStrategy(0, false)).toBe(100);
    expect(redisReconnectStrategy(1, false)).toBe(200);
    expect(redisReconnectStrategy(2, false)).toBeInstanceOf(Error);
    expect(redisReconnectStrategy(20, true)).toBe(5_000);
  });

  it('continues a valid W3C trace and rejects malformed trace context', () => {
    const middleware = new RequestIdMiddleware();
    const response = { setHeader: jest.fn() } as any;
    const next = jest.fn();
    const request = {
      headers: {
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        'x-request-id': 'request-12345678'
      }
    } as any;

    middleware.use(request, response, next);

    expect(request.traceId).toBe('0123456789abcdef0123456789abcdef');
    expect(request.traceParentSpanId).toBe('0123456789abcdef');
    expect(request.traceSpanId).toMatch(/^[0-9a-f]{16}$/);
    expect(response.setHeader).toHaveBeenCalledWith(
      'traceparent',
      expect.stringMatching(/^00-0123456789abcdef0123456789abcdef-[0-9a-f]{16}-01$/)
    );
    expect(next).toHaveBeenCalled();
  });

  it('exports bounded OTLP spans without placing request payloads in traces', async () => {
    const config = {
      get: (key: string) => ({
        'tracing.endpoint': 'http://tempo:4318/v1/traces',
        'tracing.serviceName': 'finance-agent-test',
        'tracing.batchSize': 10,
        'tracing.maxQueue': 10,
        'tracing.flushIntervalMs': 30_000
      } as Record<string, unknown>)[key]
    } as ConfigService;
    const exporter = new TraceExporterService(config);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    exporter.enqueue({
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      name: 'GET /api/health',
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      statusCode: 1,
      method: 'GET',
      httpStatusCode: 200,
      requestId: 'request-observe'
    });

    await exporter.flush();

    const payload = String(fetchMock.mock.calls[0][1]?.body);
    expect(payload).toContain('finance-agent-test');
    expect(payload).toContain('request-observe');
    expect(payload).not.toContain('authorization');
    expect(exporter.snapshot()).toEqual({ queued: 0, exported: 1, dropped: 0, errors: 0 });
    fetchMock.mockRestore();
  });

  it('waits for an active trace batch and drains the remaining queue during shutdown', async () => {
    const config = {
      get: (key: string) => ({
        'tracing.endpoint': 'http://tempo:4318/v1/traces',
        'tracing.batchSize': 2,
        'tracing.maxQueue': 10,
        'tracing.flushIntervalMs': 30_000
      } as Record<string, unknown>)[key]
    } as ConfigService;
    const exporter = new TraceExporterService(config);
    let releaseFirstBatch: (() => void) | undefined;
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockImplementationOnce(async () => {
        await firstBatch;
        return { ok: true } as Response;
      })
      .mockResolvedValue({ ok: true } as Response);
    const span = {
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      name: 'GET /api/health',
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      statusCode: 1,
      method: 'GET',
      httpStatusCode: 200
    };
    exporter.enqueue(span);
    exporter.enqueue(span);
    exporter.enqueue(span);

    const shutdown = exporter.onModuleDestroy();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseFirstBatch?.();
    await shutdown;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(exporter.snapshot()).toEqual({ queued: 0, exported: 3, dropped: 0, errors: 0 });
    exporter.enqueue(span);
    expect(exporter.snapshot()).toEqual({ queued: 0, exported: 3, dropped: 1, errors: 0 });
    fetchMock.mockRestore();
  });

  it('records a normalized server span and Prometheus counters', () => {
    const exporter = { enqueue: jest.fn() } as any;
    const middleware = new TracingMiddleware(exporter);
    const response = new EventEmitter() as any;
    response.statusCode = 200;
    const request = {
      method: 'GET',
      originalUrl: '/api/files/123e4567-e89b-12d3-a456-426614174000?token=secret',
      traceId: '1'.repeat(32),
      traceSpanId: '2'.repeat(16),
      traceParentSpanId: '3'.repeat(16),
      requestId: 'request-observe'
    } as any;
    middleware.use(request, response, jest.fn());
    response.emit('finish');
    expect(exporter.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      name: 'GET /api/files/:id',
      parentSpanId: '3'.repeat(16),
      requestId: 'request-observe'
    }));

    const metrics = new MetricsService();
    metrics.recordHttp('GET', 200, 12);
    expect(metrics.render({
      queueDepths: { ocr: 0 },
      storedFileBytes: 10n,
      workerHeartbeatHealthy: true,
      modelRuntimeHealthy: true,
      trace: { queued: 0, exported: 1, dropped: 0, errors: 0 }
    })).toContain('finance_agent_http_requests_total{method="GET",status="200"} 1');
  });
});
