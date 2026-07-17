import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  statusCode: number;
  method: string;
  httpStatusCode: number;
  requestId?: string;
}

@Injectable()
export class TraceExporterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TraceExporterService.name);
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly flushIntervalMs: number;
  private readonly queue: TraceSpan[] = [];
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private exported = 0;
  private dropped = 0;
  private errors = 0;

  constructor(config: ConfigService) {
    this.endpoint = config.get<string>('tracing.endpoint') ?? '';
    this.serviceName = config.get<string>('tracing.serviceName') ?? 'finance-agent-api';
    this.batchSize = config.get<number>('tracing.batchSize') ?? 100;
    this.maxQueue = config.get<number>('tracing.maxQueue') ?? 1_000;
    this.flushIntervalMs = config.get<number>('tracing.flushIntervalMs') ?? 2_000;
  }

  onModuleInit() {
    if (!this.endpoint) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  enqueue(span: TraceSpan) {
    if (!this.endpoint) return;
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
      this.dropped += 1;
    }
    this.queue.push(span);
    if (this.queue.length >= this.batchSize) void this.flush();
  }

  snapshot() {
    return { queued: this.queue.length, exported: this.exported, dropped: this.dropped, errors: this.errors };
  }

  async flush() {
    if (!this.endpoint || this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.batchSize);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.payload(batch)),
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`OTLP endpoint returned ${response.status}`);
      this.exported += batch.length;
    } catch (error) {
      this.errors += 1;
      this.dropped += batch.length;
      this.logger.warn(`Trace export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.flushing = false;
    }
  }

  private payload(spans: TraceSpan[]) {
    return {
      resourceSpans: [{
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }]
        },
        scopeSpans: [{
          scope: { name: 'finance-agent-http', version: '1.0.0' },
          spans: spans.map((span) => ({
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: 2,
            startTimeUnixNano: span.startTimeUnixNano,
            endTimeUnixNano: span.endTimeUnixNano,
            attributes: [
              { key: 'http.request.method', value: { stringValue: span.method } },
              { key: 'http.response.status_code', value: { intValue: String(span.httpStatusCode) } },
              ...(span.requestId
                ? [{ key: 'finance_agent.request_id', value: { stringValue: span.requestId } }]
                : [])
            ],
            status: { code: span.statusCode }
          }))
        }]
      }]
    };
  }
}
