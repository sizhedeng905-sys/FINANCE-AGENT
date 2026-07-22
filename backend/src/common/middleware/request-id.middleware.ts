import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
  traceId?: string;
  traceSpanId?: string;
  traceParentSpanId?: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction) {
    const header = request.headers['x-request-id'];
    const candidate = Array.isArray(header) ? undefined : header;
    request.requestId = candidate && /^[A-Za-z0-9._-]{8,128}$/.test(candidate) ? candidate : randomUUID();
    const traceParentHeader = request.headers.traceparent;
    const traceParent = Array.isArray(traceParentHeader) ? undefined : this.parseTraceParent(traceParentHeader);
    request.traceId = traceParent?.traceId ?? randomBytes(16).toString('hex');
    request.traceParentSpanId = traceParent?.parentSpanId;
    request.traceSpanId = randomBytes(8).toString('hex');
    response.setHeader('x-request-id', request.requestId);
    response.setHeader('traceparent', `00-${request.traceId}-${request.traceSpanId}-${traceParent?.flags ?? '01'}`);
    next();
  }

  private parseTraceParent(value: string | undefined) {
    const match = value?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/i);
    if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return undefined;
    return {
      traceId: match[1].toLowerCase(),
      parentSpanId: match[2].toLowerCase(),
      flags: match[3]
    };
  }
}
