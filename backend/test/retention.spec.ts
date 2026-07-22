import { ServiceUnavailableException } from '@nestjs/common';
import { RetentionDataClass, UserRole, UserStatus } from '@prisma/client';

import { RetentionService } from '../src/retention/retention.service';

describe('retention safety boundary', () => {
  const actor = {
    id: 'admin_1',
    username: 'admin',
    name: 'Administrator',
    role: UserRole.admin,
    department: '',
    phone: '',
    status: UserStatus.active,
    tokenVersion: 0
  };

  it('fails closed when retention mode is omitted or disabled', async () => {
    const config = { get: jest.fn(() => undefined) };
    const service = new RetentionService({} as never, {} as never, config as never);

    expect(service.classes()).toMatchObject({
      mode: 'disabled',
      destructiveExecutionEnabled: false,
      pendingDecisionRefs: ['H12', 'H14']
    });
    await expect(service.createRun({
      dataClass: RetentionDataClass.ai_conversation_content,
      cutoffAt: '2026-01-01T00:00:00.000Z',
      dryRun: true
    }, actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.processNext('disabled-instance')).resolves.toBeNull();
  });
});
