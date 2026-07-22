import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';

import { RequestWithId } from '../common/middleware/request-id.middleware';
import { TraceExporterService } from './trace-exporter.service';

@Injectable()
export class TracingMiddleware implements NestMiddleware {
  constructor(private readonly exporter: TraceExporterService) {}

  use(request: RequestWithId, response: Response, next: NextFunction) {
    const startedAt = BigInt(Date.now()) * 1_000_000n;
    let recorded = false;
    const record = () => {
      if (recorded || !request.traceId || !request.traceSpanId) return;
      recorded = true;
      const path = this.normalizedPath((request.originalUrl || request.url).split('?')[0]);
      this.exporter.enqueue({
        traceId: request.traceId,
        spanId: request.traceSpanId,
        parentSpanId: request.traceParentSpanId,
        name: `${request.method} ${path}`,
        startTimeUnixNano: startedAt.toString(),
        endTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
        statusCode: response.statusCode >= 500 ? 2 : 1,
        method: request.method,
        httpStatusCode: response.statusCode,
        requestId: request.requestId
      });
    };
    response.once('finish', record);
    response.once('close', record);
    next();
  }

  private normalizedPath(path: string) {
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
      .replace(/\/[0-9]{4,}(?=\/|$)/g, '/:id')
      .slice(0, 256);
  }
}
