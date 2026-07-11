import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileScanStatus, NotificationType, RawFileStatus, UserRole, UserStatus } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FilesService } from '../src/files/files.service';
import { LocalFileStorageService } from '../src/files/local-file-storage.service';
import { NotificationsService } from '../src/notifications/notifications.service';

function actor(role: UserRole, id: string = role) {
  return { id, username: id, name: id, role, department: '', phone: '', status: UserStatus.active };
}

describe('phase 5 files and notifications', () => {
  let uploadDir: string;

  afterEach(async () => {
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  it('validates, hashes, stores, authorizes, reads, and soft deletes a file', async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'finance-agent-files-'));
    const rawFiles: any[] = [];
    const prisma: any = {
      project: { findUnique: jest.fn(async ({ where }) => (where.id === 'project_1' ? { id: 'project_1', status: 'active' } : null)) },
      rawFile: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `file_${rawFiles.length + 1}`,
            uploadedAt: new Date(),
            isVoided: false,
            voidReason: null,
            voidedAt: null,
            voidedBy: null,
            previewStatus: 'original',
            ...data
          };
          rawFiles.push(item);
          return item;
        }),
        findUnique: jest.fn(async ({ where }) => rawFiles.find((item) => item.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }) => {
          const item = rawFiles.find((file) => file.id === where.id);
          Object.assign(item, data);
          return item;
        })
      },
      workOrderAttachment: { create: jest.fn() },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const config: any = {
      get: jest.fn((key: string) => ({ uploadDir, maxFileSizeMb: 1 })[key])
    };
    const auditLogs = { write: jest.fn(async () => undefined) };
    const ledgerEvents = { write: jest.fn(async () => undefined) };
    const workOrders = { findOne: jest.fn() };
    const service = new FilesService(
      prisma,
      new LocalFileStorageService(config),
      workOrders as any,
      auditLogs as any,
      ledgerEvents as any,
      config
    );
    const file = {
      fieldname: 'file',
      originalname: '凭证.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: 7,
      buffer: Buffer.from('pdf-test'),
      stream: undefined,
      destination: '',
      filename: '',
      path: ''
    } as unknown as Express.Multer.File;

    const uploaded = await service.upload(file, { relatedProjectId: 'project_1' }, actor(UserRole.employee, 'employee_1'), {});
    expect(uploaded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploaded.fileSize).toBe(7);
    expect(auditLogs.write).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'file.upload', 'raw_file', uploaded.id, expect.anything(), {});
    expect(ledgerEvents.write).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'raw_file_uploaded', 'raw_file', uploaded.id, expect.anything());

    const downloaded = await service.read(uploaded.id, actor(UserRole.employee, 'employee_1'), {}, 'download');
    expect(downloaded.buffer.toString()).toBe('pdf-test');
    await expect(service.get(uploaded.id, actor(UserRole.employee, 'employee_2'))).rejects.toBeInstanceOf(ForbiddenException);

    const voided = await service.void(uploaded.id, { reason: '重复上传' }, actor(UserRole.employee, 'employee_1'), {});
    expect(voided.status).toBe(RawFileStatus.voided);
    await expect(service.get(uploaded.id, actor(UserRole.employee, 'employee_1'))).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.upload(
        { ...file, originalname: 'payload.exe', mimetype: 'application/octet-stream' },
        { relatedProjectId: 'project_1' },
        actor(UserRole.employee, 'employee_1'),
        {}
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes notifications from the token user and reduces unread count', async () => {
    const now = new Date();
    const notifications: any[] = [
      {
        id: 'role_notice',
        title: '财务通知',
        content: '待审核',
        type: NotificationType.audit,
        senderId: null,
        senderName: '系统',
        targetRole: UserRole.finance,
        targetUserId: null,
        relatedWorkOrderId: 'wo_1',
        read: false,
        createdAt: now,
        readAt: null
      },
      {
        id: 'private_notice',
        title: '私人通知',
        content: '仅指定用户',
        type: NotificationType.system,
        senderId: null,
        senderName: '系统',
        targetRole: UserRole.finance,
        targetUserId: 'finance_2',
        relatedWorkOrderId: null,
        read: false,
        createdAt: now,
        readAt: null
      }
    ];
    const matches = (item: any, where: any) => {
      const scoped = where.OR.some((condition: any) =>
        Object.entries(condition).every(([key, value]) => item[key] === value)
      );
      return scoped && (typeof where.read !== 'boolean' || item.read === where.read) && (!where.id || item.id === where.id);
    };
    const prisma: any = {
      notification: {
        findMany: jest.fn(async ({ where }) => notifications.filter((item) => matches(item, where))),
        count: jest.fn(async ({ where }) => notifications.filter((item) => matches(item, where)).length),
        findFirst: jest.fn(async ({ where }) => notifications.find((item) => matches(item, where)) ?? null),
        update: jest.fn(async ({ where, data }) => {
          const item = notifications.find((notification) => notification.id === where.id);
          Object.assign(item, data);
          return item;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const items = notifications.filter((item) => matches(item, where));
          items.forEach((item) => Object.assign(item, data));
          return { count: items.length };
        })
      }
    };
    const service = new NotificationsService(prisma);
    const finance1 = actor(UserRole.finance, 'finance_1');
    const list = await service.findMany({}, finance1);
    expect(list.items.map((item) => item.id)).toEqual(['role_notice']);
    expect(list.unreadCount).toBe(1);

    await expect(service.markRead('private_notice', finance1)).rejects.toBeInstanceOf(NotFoundException);
    const marked = await service.markRead('role_notice', finance1);
    expect(marked.read).toBe(true);
    const result = await service.markAllRead(finance1);
    expect(result.unreadCount).toBe(0);
  });
});
