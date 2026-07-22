import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const PROJECT_WRITE_LOCK_NAMESPACE = 22;
const PROJECT_WRITE_LOCK_TIMEOUT = '2s';
const RETRYABLE_POSTGRES_CODES = new Set(['40001', '40P01', '55P03']);

export const PROJECT_WRITE_LOCK_RETRY_CODE = 'PROJECT_WRITE_LOCK_RETRY';

export async function acquireProjectWriteLock(tx: Prisma.TransactionClient, projectId: string) {
  try {
    const [settings] = await tx.$queryRaw<Array<{ value: string }>>`
      SELECT current_setting('lock_timeout') AS value
    `;
    const previousTimeout = settings?.value ?? '0';
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${PROJECT_WRITE_LOCK_TIMEOUT}, true)`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, ${PROJECT_WRITE_LOCK_NAMESPACE}))
    `;
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${previousTimeout}, true)`;
  } catch (error) {
    if (!isRetryableLockError(error)) throw error;

    throw new ConflictException({
      message: '项目正在被其他请求修改，请稍后重试',
      data: {
        reason: PROJECT_WRITE_LOCK_RETRY_CODE,
        retryable: true
      }
    });
  }
}

function isRetryableLockError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true;
    const postgresCode = error.meta?.code;
    return typeof postgresCode === 'string' && RETRYABLE_POSTGRES_CODES.has(postgresCode);
  }

  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE_POSTGRES_CODES.has(code);
}
