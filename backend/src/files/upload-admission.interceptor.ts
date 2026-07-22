import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

import { AuthenticatedRequest } from '../common/types/current-user';
import { UploadAdmissionService, UploadReservation } from './upload-admission.service';

@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UploadAdmissionInterceptor.name);

  constructor(private readonly admission: UploadAdmissionService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawLength = request.headers['content-length'];
    const contentLength = Array.isArray(rawLength) ? Number.NaN : Number(rawLength);
    const reservation = await this.admission.reserve(request.user.id, contentLength);
    try {
      return this.withReservation(next.handle(), reservation);
    } catch (error) {
      await this.admission.release(reservation);
      throw error;
    }
  }

  private withReservation(source: Observable<unknown>, reservation: UploadReservation) {
    return new Observable<unknown>((subscriber) => {
      let renewing = false;
      let releasePromise: Promise<void> | undefined;
      const renewalIntervalMs = this.admission.renewalIntervalMs(reservation);
      const timer = renewalIntervalMs === undefined
        ? undefined
        : setInterval(() => {
            if (renewing || reservation.finished || subscriber.closed) return;
            renewing = true;
            void this.admission.renew(reservation)
              .catch((error) => subscriber.error(error))
              .finally(() => {
                renewing = false;
              });
          }, renewalIntervalMs);
      timer?.unref();

      const stopRenewal = () => {
        if (timer) clearInterval(timer);
      };
      const release = () => {
        releasePromise ??= this.admission.release(reservation).catch((error) => {
          const message = error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(`Upload admission release deferred to lease expiry: ${message}`);
        });
        return releasePromise;
      };

      const downstream = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => {
          stopRenewal();
          void release().finally(() => subscriber.error(error));
        },
        complete: () => {
          stopRenewal();
          void release().finally(() => subscriber.complete());
        }
      });

      return () => {
        stopRenewal();
        downstream.unsubscribe();
        void release();
      };
    });
  }
}
