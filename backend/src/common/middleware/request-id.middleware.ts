import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction) {
    const header = request.headers['x-request-id'];
    const candidate = Array.isArray(header) ? undefined : header;
    request.requestId = candidate && /^[A-Za-z0-9._-]{8,128}$/.test(candidate) ? candidate : randomUUID();
    response.setHeader('x-request-id', request.requestId);
    next();
  }
}
