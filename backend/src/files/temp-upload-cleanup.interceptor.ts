import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { finalize, Observable } from 'rxjs';

@Injectable()
export class TempUploadCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ file?: Express.Multer.File }>();
    return next.handle().pipe(
      finalize(() => {
        const path = request.file?.path;
        if (path) void unlink(path).catch(() => undefined);
      })
    );
  }
}
