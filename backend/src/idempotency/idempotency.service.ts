import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export interface IdempotencyScope {
  actorUserId: string;
  key: string;
  requestMethod: string;
  requestPath: string;
  requestHash: string;
}

@Injectable()
export class IdempotencyService {
  prepare(
    actorUserId: string,
    requestMethod: string,
    requestPath: string,
    key: string | undefined,
    request: unknown,
    required = true
  ): IdempotencyScope | undefined {
    if (!key) {
      if (required) throw new BadRequestException('Idempotency-Key 请求头不能为空');
      return undefined;
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new BadRequestException('Idempotency-Key 格式不合法');
    }
    return {
      actorUserId,
      key,
      requestMethod: requestMethod.toUpperCase(),
      requestPath,
      requestHash: createHash('sha256').update(this.canonicalStringify(request)).digest('hex')
    };
  }

  async execute<T>(
    tx: Prisma.TransactionClient,
    scope: IdempotencyScope | undefined,
    responseStatus: number,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!scope) return operation();

    const lockKey = `${scope.actorUserId}:${scope.requestMethod}:${scope.requestPath}:${scope.key}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 87))`;
    const existing = await tx.idempotencyKey.findUnique({
      where: {
        createdBy_requestMethod_requestPath_key: {
          createdBy: scope.actorUserId,
          requestMethod: scope.requestMethod,
          requestPath: scope.requestPath,
          key: scope.key
        }
      }
    });
    if (existing) {
      if (existing.requestHash !== scope.requestHash) {
        throw new ConflictException('Idempotency-Key 已绑定其他请求');
      }
      if (existing.status !== 'completed' || existing.responseBody === null) {
        throw new ConflictException('相同幂等请求正在处理中');
      }
      return this.cloneResponse<T>(existing.responseBody);
    }

    const request = await tx.idempotencyKey.create({
      data: {
        key: scope.key,
        requestMethod: scope.requestMethod,
        requestPath: scope.requestPath,
        requestHash: scope.requestHash,
        createdBy: scope.actorUserId
      }
    });
    const response = await operation();
    await tx.idempotencyKey.update({
      where: { id: request.id },
      data: {
        status: 'completed',
        responseStatus,
        responseBody: this.toJson(response)
      }
    });
    return response;
  }

  canonicalStringify(value: unknown): string {
    return JSON.stringify(this.normalize(value));
  }

  private normalize(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (Array.isArray(value)) return value.map((item) => this.normalize(item));
    if (typeof value === 'object') {
      const decimal = value as { constructor?: { name?: string }; toString?: () => string };
      if (decimal.constructor?.name === 'Decimal' && typeof decimal.toString === 'function') {
        return decimal.toString();
      }
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          const item = (value as Record<string, unknown>)[key];
          if (item !== undefined) result[key] = this.normalize(item);
          return result;
        }, {});
    }
    return String(value);
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private cloneResponse<T>(value: Prisma.JsonValue): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
