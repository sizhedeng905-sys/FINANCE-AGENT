import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { finalize, Observable } from 'rxjs';

import { AuthenticatedRequest } from '../common/types/current-user';
import { UploadAdmissionService } from './upload-admission.service';

@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  constructor(private readonly admission: UploadAdmissionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawLength = request.headers['content-length'];
    const contentLength = Array.isArray(rawLength) ? Number.NaN : Number(rawLength);
    const release = this.admission.reserve(request.user.id, contentLength);
    try {
      return next.handle().pipe(finalize(release));
    } catch (error) {
      release();
      throw error;
    }
  }
}
