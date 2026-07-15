import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException
} from '@nestjs/common';
import { FileScanStatus, NotificationType, RawFileStatus, UserRole, UserStatus } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { FileSecurityService } from '../src/files/file-security.service';
import { FilesService } from '../src/files/files.service';
import { LocalFileStorageService } from '../src/files/local-file-storage.service';
import { NotificationsService } from '../src/notifications/notifications.service';

function actor(role: UserRole, id: string = role) {
  return { id, username: id, name: id, role, department: '', phone: '', status: UserStatus.active, tokenVersion: 0 };
}

describe('phase 5 files and notifications', () => {
  let uploadDir: string;

  afterEach(async () => {
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  it('validates, hashes, stores, authorizes, reads, and soft deletes a file', async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'finance-agent-files-'));
    const rawFiles: any[] = [];
    let linkedWorkOrder: any = null;
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
        }),
        aggregate: jest.fn(async ({ where }) => ({
          _sum: {
            fileSize: rawFiles
              .filter((item) => !item.isVoided && (!where.uploadedBy || item.uploadedBy === where.uploadedBy) && (!where.relatedProjectId || item.relatedProjectId === where.relatedProjectId))
              .reduce((sum, item) => sum + BigInt(item.fileSize), 0n)
          }
        }))
      },
      workOrder: { findUnique: jest.fn(async () => linkedWorkOrder) },
      workOrderAttachment: {
        count: jest.fn(async () => 0),
        create: jest.fn(),
        deleteMany: jest.fn(async () => ({ count: 0 }))
      },
      businessRecord: { findFirst: jest.fn(async () => null) },
      importTask: { findFirst: jest.fn(async () => null) },
      ocrTask: { findFirst: jest.fn(async () => null) },
      $executeRaw: jest.fn(async () => 1),
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
      new FileSecurityService(config),
      config
    );
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const buffer = Buffer.from(await pdf.save());
    const file = {
      fieldname: 'file',
      originalname: '凭证.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
      stream: undefined,
      destination: '',
      filename: '',
      path: ''
    } as unknown as Express.Multer.File;

    const uploaded = await service.upload(file, { relatedProjectId: 'project_1' }, actor(UserRole.finance, 'finance_1'), {});
    expect(uploaded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploaded.fileSize).toBe(buffer.length);
    expect(auditLogs.write).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'file.upload', 'raw_file', uploaded.id, expect.anything(), {});
    expect(ledgerEvents.write).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'raw_file_uploaded', 'raw_file', uploaded.id, expect.anything(), `raw_file:${uploaded.id}:uploaded`);

    const downloaded = await service.read(uploaded.id, actor(UserRole.finance, 'finance_1'), {}, 'download');
    const downloadedChunks: Buffer[] = [];
    for await (const chunk of downloaded.stream) downloadedChunks.push(Buffer.from(chunk));
    expect(Buffer.concat(downloadedChunks).equals(buffer)).toBe(true);
    await expect(service.get(uploaded.id, actor(UserRole.employee, 'employee_2'))).rejects.toBeInstanceOf(ForbiddenException);

    const voided = await service.void(uploaded.id, { reason: '重复上传' }, actor(UserRole.finance, 'finance_1'), {});
    expect(voided.status).toBe(RawFileStatus.voided);
    await expect(service.get(uploaded.id, actor(UserRole.finance, 'finance_1'))).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.upload(
        { ...file, originalname: 'payload.exe', mimetype: 'application/octet-stream' },
        { relatedProjectId: 'project_1' },
        actor(UserRole.finance, 'finance_1'),
        {}
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.upload(file, { relatedProjectId: 'project_1' }, actor(UserRole.employee, 'employee_1'), {})
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.upload(
        { ...file, originalname: '../voucher.pdf' },
        { relatedProjectId: 'project_1' },
        actor(UserRole.finance, 'finance_1'),
        {}
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload(
        { ...file, buffer: Buffer.from('%PDF-not-complete'), size: 17 },
        { relatedProjectId: 'project_1' },
        actor(UserRole.finance, 'finance_1'),
        {}
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload(
        { ...file, buffer: Buffer.alloc(1024 * 1024 + 1), size: 1024 * 1024 + 1 },
        { relatedProjectId: 'project_1' },
        actor(UserRole.finance, 'finance_1'),
        {}
      )
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    const referenced = await service.upload(
      file,
      { relatedProjectId: 'project_1' },
      actor(UserRole.finance, 'finance_1'),
      {}
    );
    prisma.businessRecord.findFirst.mockResolvedValueOnce({ id: 'record_1' });
    await expect(
      service.void(referenced.id, { reason: '误删测试' }, actor(UserRole.finance, 'finance_1'), {})
    ).rejects.toBeInstanceOf(ConflictException);

    linkedWorkOrder = {
      id: 'work_order_1',
      projectId: 'project_1',
      creatorId: 'employee_1',
      status: 'boss_pending'
    };
    await expect(
      service.upload(file, { workOrderId: 'work_order_1' }, actor(UserRole.employee, 'employee_1'), {})
    ).rejects.toBeInstanceOf(ConflictException);

    linkedWorkOrder = {
      id: 'work_order_1',
      projectId: 'project_1',
      creatorId: 'employee_1',
      status: 'draft'
    };
    prisma.workOrderAttachment.count.mockResolvedValueOnce(20);
    await expect(
      service.upload(file, { workOrderId: 'work_order_1' }, actor(UserRole.employee, 'employee_1'), {})
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$executeRaw).toHaveBeenCalled();
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
        id: 'private_notice_1',
        title: '私人通知一',
        content: '仅指定财务一',
        type: NotificationType.system,
        senderId: null,
        senderName: '系统',
        targetRole: UserRole.finance,
        targetUserId: 'finance_1',
        relatedWorkOrderId: null,
        read: false,
        createdAt: now,
        readAt: null
      },
      {
        id: 'private_notice_2',
        title: '私人通知二',
        content: '仅指定财务二',
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
    const receipts: Array<{ id: string; notificationId: string; userId: string; readAt: Date; createdAt: Date }> = [];
    const matches = (item: any, where: any) => {
      const and = where.AND as any[] | undefined;
      const scope = and?.[0] ?? where;
      const readFilter = and?.[1]?.receipts;
      const scoped = scope.OR.some((condition: any) =>
        Object.entries(condition).every(([key, value]) => item[key] === value)
      );
      const userId = readFilter?.some?.userId ?? readFilter?.none?.userId;
      const hasReceipt = userId ? receipts.some((receipt) => receipt.notificationId === item.id && receipt.userId === userId) : false;
      const readMatches = readFilter?.some ? hasReceipt : readFilter?.none ? !hasReceipt : true;
      return scoped && readMatches && (!where.id || item.id === where.id);
    };
    const withReceipts = (item: any, include: any) => ({
      ...item,
      receipts: include?.receipts
        ? receipts.filter((receipt) => receipt.notificationId === item.id && receipt.userId === include.receipts.where.userId)
        : []
    });
    const prisma: any = {
      notification: {
        findMany: jest.fn(async ({ where, include, select }) => {
          const items = notifications.filter((item) => matches(item, where));
          return select ? items.map((item) => ({ id: item.id })) : items.map((item) => withReceipts(item, include));
        }),
        count: jest.fn(async ({ where }) => notifications.filter((item) => matches(item, where)).length),
        findFirst: jest.fn(async ({ where, include }) => {
          const item = notifications.find((notification) => matches(notification, where));
          return item ? withReceipts(item, include) : null;
        })
      },
      notificationReceipt: {
        create: jest.fn(async ({ data }) => {
          const receipt = { id: `receipt_${receipts.length + 1}`, ...data, readAt: new Date(), createdAt: new Date() };
          receipts.push(receipt);
          return receipt;
        }),
        createMany: jest.fn(async ({ data }) => {
          let count = 0;
          for (const input of data) {
            if (receipts.some((receipt) => receipt.notificationId === input.notificationId && receipt.userId === input.userId)) continue;
            receipts.push({ id: `receipt_${receipts.length + 1}`, ...input, readAt: new Date(), createdAt: new Date() });
            count += 1;
          }
          return { count };
        })
      },
      $executeRaw: jest.fn(async () => 1),
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const auditLogs = { write: jest.fn(async () => undefined) };
    const service = new NotificationsService(prisma, auditLogs as any);
    const finance1 = actor(UserRole.finance, 'finance_1');
    const list = await service.findMany({}, finance1);
    expect(list.items.map((item) => item.id)).toEqual(['role_notice', 'private_notice_1']);
    expect(list.unreadCount).toBe(2);

    await expect(service.markRead('private_notice_2', finance1, {})).rejects.toBeInstanceOf(NotFoundException);
    const marked = await service.markRead('role_notice', finance1, { requestId: 'read-one' });
    expect(marked.read).toBe(true);
    await service.markRead('role_notice', finance1, { requestId: 'read-duplicate' });
    expect(receipts.filter((receipt) => receipt.notificationId === 'role_notice' && receipt.userId === 'finance_1')).toHaveLength(1);
    expect(auditLogs.write).toHaveBeenCalledTimes(1);

    const finance2List = await service.findMany({}, actor(UserRole.finance, 'finance_2'));
    expect(finance2List.items.find((item) => item.id === 'role_notice')?.read).toBe(false);
    expect(finance2List.items.map((item) => item.id)).toEqual(['role_notice', 'private_notice_2']);

    const result = await service.markAllRead(finance1, { requestId: 'read-all' });
    expect(result.updatedCount).toBe(1);
    expect(result.unreadCount).toBe(0);
    expect(auditLogs.write).toHaveBeenCalledWith(
      expect.anything(),
      finance1,
      'notification.read_all',
      'notification',
      null,
      { updatedCount: 1 },
      { requestId: 'read-all' }
    );
  });
});
