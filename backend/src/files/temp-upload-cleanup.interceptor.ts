import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unlink } from 'node:fs/promises';
import { finalize, Observable } from 'rxjs';
import { resolveQuarantinedUploadPath, resolveUploadQuarantineRoot } from './secure-upload-options';

@Injectable()
export class TempUploadCleanupInterceptor implements NestInterceptor {
  private readonly quarantineRoot: string;

  constructor(config: ConfigService) {
    this.quarantineRoot = resolveUploadQuarantineRoot(config);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ file?: Express.Multer.File }>();
    return next.handle().pipe(
      finalize(() => {
        const file = request.file;
        if (!file?.path) return;
        try {
          const path = resolveQuarantinedUploadPath(file, this.quarantineRoot);
          void unlink(path).catch(() => undefined);
        } catch {
          // Never unlink a path that was not created by the quarantine storage.
        }
      })
    );
  }
}
