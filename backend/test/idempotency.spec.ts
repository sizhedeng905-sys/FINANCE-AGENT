import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  IDEMPOTENCY_PERSISTENCE_KEY_VERSION,
  IDEMPOTENCY_RETENTION_POLICY,
  IdempotencyService
} from '../src/idempotency/idempotency.service';

describe('database idempotency contract', () => {
  const service = new IdempotencyService();

  it('canonicalizes equivalent request objects and derives actor/operation-scoped persistence keys', () => {
    const first = service.prepare('user-a', 'post', '/api/records', 'same-key-123', {
      projectId: 'project-a',
      nested: { b: 2, a: 1 }
    });
    const reordered = service.prepare('user-a', 'POST', '/api/records', 'same-key-123', {
      nested: { a: 1, b: 2 },
      projectId: 'project-a'
    });
    const otherActor = service.prepare('user-b', 'POST', '/api/records', 'same-key-123', {
      projectId: 'project-a',
      nested: { a: 1, b: 2 }
    });
    const otherOperation = service.prepare('user-a', 'POST', '/api/import-tasks', 'same-key-123', {
      projectId: 'project-a',
      nested: { a: 1, b: 2 }
    });

    expect(first?.requestHash).toBe(reordered?.requestHash);
    expect(service.persistenceKey(first)).toBe(service.persistenceKey(reordered));
    expect(service.persistenceKey(first)).toMatch(new RegExp(`^${IDEMPOTENCY_PERSISTENCE_KEY_VERSION}:[a-f0-9]{64}$`));
    expect(service.persistenceKey(first)).not.toContain('same-key-123');
    expect(service.persistenceKey(first)).not.toBe(service.persistenceKey(otherActor));
    expect(service.persistenceKey(first)).not.toBe(service.persistenceKey(otherOperation));
    expect(service.persistenceKey(undefined)).toBeUndefined();
    expect(IDEMPOTENCY_RETENTION_POLICY).toBe('RETAIN_UNTIL_H14_APPROVED');
  });

  it.each([
    [undefined, true, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['short', true, 'IDEMPOTENCY_KEY_FORMAT_INVALID'],
    ['contains space', true, 'IDEMPOTENCY_KEY_FORMAT_INVALID'],
    ['x'.repeat(129), true, 'IDEMPOTENCY_KEY_FORMAT_INVALID']
  ] as const)('returns a stable reason for invalid key %p', (key, required, reason) => {
    try {
      service.prepare('user-a', 'POST', '/api/records', key, {}, required);
      throw new Error('Expected idempotency key validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ response: { data: { reason } } });
    }
  });

  it('allows an omitted optional key and returns stable request conflict reasons', async () => {
    expect(service.prepare('user-a', 'POST', '/api/records', undefined, {}, false)).toBeUndefined();
    const scope = service.prepare('user-a', 'POST', '/api/records', 'request-key-123', { amount: '1.00' })!;
    const existing = {
      id: 'idem-1',
      requestHash: 'different',
      status: 'completed',
      responseBody: { id: 'record-1' }
    };
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      idempotencyKey: { findUnique: jest.fn(async () => existing) }
    };

    await expect(service.execute(tx as never, scope, 201, async () => ({ id: 'new' })))
      .rejects.toMatchObject({
        response: { data: { reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' } }
      });
    expect(tx.idempotencyKey.findUnique).toHaveBeenCalledTimes(1);

    existing.requestHash = scope.requestHash;
    existing.status = 'processing';
    await expect(service.execute(tx as never, scope, 201, async () => ({ id: 'new' })))
      .rejects.toMatchObject({
        response: { data: { reason: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' } }
      });
    expect(ConflictException).toBeDefined();
  });
});
