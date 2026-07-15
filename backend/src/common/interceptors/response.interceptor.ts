import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T | Record<string, never>;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | StreamableFile> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | StreamableFile> {
    return next.handle().pipe(
      map((data) => data instanceof StreamableFile
        ? data
        : {
            code: 0,
            message: 'success',
            data: data ?? {}
          })
    );
  }
}
