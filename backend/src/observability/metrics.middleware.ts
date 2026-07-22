import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';

import { RequestWithId } from '../common/middleware/request-id.middleware';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: RequestWithId, response: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.metrics.recordHttp(request.method, response.statusCode, durationMs);
    };
    response.once('finish', record);
    response.once('close', record);
    next();
  }
}
