import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { catchError, tap, throwError } from 'rxjs';

import { AuthenticatedRequest } from '../types/current-user';
import { RequestWithId } from '../middleware/request-id.middleware';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpRequest');

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & RequestWithId>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    const startedAt = Date.now();
    const base = {
      type: 'http_request',
      requestId: request.requestId,
      method: request.method,
      path: (request.originalUrl || request.url).split('?')[0],
      actorUserId: request.user?.id,
      actorRole: request.user?.role
    };

    return next.handle().pipe(
      tap(() => this.logger.log(JSON.stringify({
        ...base,
        statusCode: response.statusCode,
        latencyMs: Date.now() - startedAt
      }))),
      catchError((error: unknown) => {
        const statusCode = typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status: unknown }).status)
          : 500;
        const payload = JSON.stringify({
          ...base,
          statusCode: Number.isFinite(statusCode) ? statusCode : 500,
          latencyMs: Date.now() - startedAt,
          outcome: 'error'
        });
        if (statusCode >= 500) this.logger.error(payload);
        else this.logger.warn(payload);
        return throwError(() => error);
      })
    );
  }
}
