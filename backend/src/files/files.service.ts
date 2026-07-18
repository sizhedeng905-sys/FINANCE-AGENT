import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileScanStatus, Prisma, RawFileStatus, UserRole, WorkOrderStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { chmod, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { acquireProjectWriteLock } from '../common/database/project-write-lock';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { FileSecurityService } from './file-security.service';
import { resolveQuarantinedUploadPath, resolveUploadQuarantineRoot } from './secure-upload-options';
import { toRawFile } from './file.presenter';
import { FILE_STORAGE, FileStorage } from './file-storage';
import { StorageCapacityService } from './storage-capacity.service';
import { VoidFileDto } from './dto/void-file.dto';

const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.xls': ['application/vnd.ms-excel', 'application/xls', 'application/x-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};
const EMPLOYEE_FILE_EDITABLE_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.draft,
  WorkOrderStatus.returned_for_supplement
];
const MAX_WORK_ORDER_ATTACHMENTS = 20;

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly maxFileSize: number;
  private readonly userQuotaBytes: bigint;
  private readonly projectQuotaBytes: bigint;
  private readonly quarantineRoot: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(AuditLogsService) private readonly auditLogs: AuditLogsService,
    @Inject(LedgerEventsService) private readonly ledgerEvents: LedgerEventsService,
    @Inject(FileSecurityService) private readonly fileSecurity: FileSecurityService,
    @Inject(StorageCapacityService) private readonly storageCapacity: StorageCapacityService,
    @Inject(ConfigService) config: ConfigService
  ) {
    const configuredMb = config.get<number>('maxFileSizeMb') ?? 20;
    this.maxFileSize = Math.max(1, configuredMb) * 1024 * 1024;
    this.userQuotaBytes = BigInt(config.get<number>('fileQuotas.userMb') ?? 500) * 1024n * 1024n;
    this.projectQuotaBytes = BigInt(config.get<number>('fileQuotas.projectMb') ?? 5000) * 1024n * 1024n;
    this.quarantineRoot = resolveUploadQuarantineRoot(config);
    this.signedUrlTtlSeconds = config.get<number>('storage.s3.presignedUrlTtlSeconds') ?? 60;
  }

  async upload(
    file: Express.Multer.File | undefined,
    dto: UploadFileDto,
    actor: CurrentUser,
    context: RequestContext
  ) {
    if (!file) throw new BadRequestException('请选择上传文件');
    if (actor.role === UserRole.employee && !dto.workOrderId) {
      throw new ForbiddenException('员工上传附件必须关联本人工单');
    }
    if (actor.role === UserRole.finance && dto.workOrderId) {
      throw new ForbiddenException('财务只能上传项目级原始文件');
    }

    const linkedWorkOrder = dto.workOrderId
      ? await this.prisma.workOrder.findUnique({ where: { id: dto.workOrderId } })
      : null;
    if (dto.workOrderId && !linkedWorkOrder) throw new NotFoundException('工单不存在');
    if (linkedWorkOrder) {
      if (actor.role !== UserRole.employee || linkedWorkOrder.creatorId !== actor.id) {
        throw new ForbiddenException('只能向本人工单新增附件');
      }
      if (!EMPLOYEE_FILE_EDITABLE_STATUSES.includes(linkedWorkOrder.status)) {
        throw new ConflictException('工单已提交，不能新增附件');
      }
    }
    const projectId = dto.relatedProjectId ?? linkedWorkOrder?.projectId;
    if (!projectId) throw new BadRequestException('relatedProjectId 或 workOrderId 至少提供一个');
    if (dto.relatedProjectId && linkedWorkOrder && dto.relatedProjectId !== linkedWorkOrder.projectId) {
      throw new BadRequestException('文件项目与工单项目不一致');
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.status !== 'active') throw new BadRequestException('项目不存在或未启用');
    const originalFileName = await this.validateFile(file);

    await this.storageCapacity.assertUploadAllowed(BigInt(file.size));

    const storagePath = await this.storage.save(file);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.workOrderId) {
          await this.lockWorkOrder(tx, dto.workOrderId);
        }
        await acquireProjectWriteLock(tx, projectId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id}, 20))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 21))`;
        const currentProject = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
        if (!currentProject || currentProject.status !== 'active') {
          throw new ConflictException('项目状态已经变化，不能上传文件');
        }
        await this.storageCapacity.assertWithinTransaction(tx, BigInt(file.size));
        await this.assertStorageQuotas(tx, actor.id, projectId, file.size);
        if (dto.workOrderId) {
          const current = await tx.workOrder.findUnique({ where: { id: dto.workOrderId } });
          if (!current) throw new NotFoundException('工单不存在');
          if (
            actor.role !== UserRole.employee ||
            current.creatorId !== actor.id ||
            !EMPLOYEE_FILE_EDITABLE_STATUSES.includes(current.status)
          ) {
            throw new ConflictException('工单状态已经变化，不能新增附件');
          }
          if (current.projectId !== projectId) throw new ConflictException('文件项目与工单项目不一致');
          const attachmentCount = await tx.workOrderAttachment.count({
            where: { workOrderId: dto.workOrderId, rawFile: { isVoided: false } }
          });
          if (attachmentCount >= MAX_WORK_ORDER_ATTACHMENTS) {
            throw new BadRequestException(`单个工单最多关联 ${MAX_WORK_ORDER_ATTACHMENTS} 个附件`);
          }
        }
        const rawFile = await tx.rawFile.create({
          data: {
            fileName: originalFileName,
            originalFileName,
            fileType: this.resolveFileType(originalFileName),
            mimeType: file.mimetype,
            fileSize: BigInt(file.size),
            storagePath,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            uploadedBy: actor.id,
            relatedProjectId: projectId,
            relatedWorkOrderId: dto.workOrderId,
            status: RawFileStatus.uploaded,
            scanStatus: FileScanStatus.clean,
            previewStatus: 'untrusted_original'
          }
        });
        if (dto.workOrderId) {
          await tx.workOrderAttachment.create({
            data: { workOrderId: dto.workOrderId, rawFileId: rawFile.id, uploadedBy: actor.id }
          });
          await tx.workOrder.update({
            where: { id: dto.workOrderId },
            data: { version: { increment: 1 }, submissionSnapshot: Prisma.JsonNull, submittedAt: null }
          });
        }
        await this.auditLogs.write(
          tx,
          actor,
          'file.upload',
          'raw_file',
          rawFile.id,
          { sha256: rawFile.sha256, fileSize: file.size, scanStatus: rawFile.scanStatus },
          context
        );
        await this.ledgerEvents.write(
          tx,
          actor,
          'raw_file_uploaded',
          'raw_file',
          rawFile.id,
          {
            relatedProjectId: projectId,
            relatedWorkOrderId: dto.workOrderId ?? null,
            sha256: rawFile.sha256,
            scanStatus: rawFile.scanStatus
          },
          `raw_file:${rawFile.id}:uploaded`
        );
        return toRawFile(rawFile);
      });
    } catch (error) {
      await this.storage.remove(storagePath).catch((cleanupError: unknown) => {
        this.logger.error(JSON.stringify({
          event: 'failed_upload_cleanup_deferred',
          cleanupError: cleanupError instanceof Error ? cleanupError.name : 'UnknownError'
        }));
      });
      throw error;
    }
  }

  async get(id: string, actor: CurrentUser) {
    return toRawFile(await this.findAccessibleOrThrow(id, actor));
  }

  async read(id: string, actor: CurrentUser, context: RequestContext, action: 'preview' | 'download') {
    const file = await this.findAccessibleOrThrow(id, actor);
    this.assertClean(file.scanStatus);
    await this.auditLogs.write(
      this.prisma,
      actor,
      `file.${action}`,
      'raw_file',
      file.id,
      { sha256: file.sha256 },
      context
    );
    return {
      stream: await this.storage.openReadStream(file.storagePath),
      fileName: file.originalFileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      inlineAllowed: file.fileType === 'image',
      trustStatus: file.previewStatus
    };
  }

  async createSignedDownloadUrl(id: string, actor: CurrentUser, context: RequestContext) {
    const file = await this.findAccessibleOrThrow(id, actor);
    this.assertClean(file.scanStatus);
    if (!this.storage.createSignedReadUrl) {
      throw new ConflictException('当前存储后端不支持签名下载地址');
    }
    const url = await this.storage.createSignedReadUrl(file.storagePath, {
      expiresInSeconds: this.signedUrlTtlSeconds,
      fileName: file.originalFileName,
      mimeType: 'application/octet-stream'
    });
    const expiresAt = new Date(Date.now() + this.signedUrlTtlSeconds * 1_000);
    await this.prisma.$transaction(async (tx) => {
      await this.auditLogs.write(
        tx,
        actor,
        'file.signed_download_url',
        'raw_file',
        file.id,
        { sha256: file.sha256, expiresAt: expiresAt.toISOString() },
        context
      );
      await this.ledgerEvents.write(
        tx,
        actor,
        'raw_file_signed_download_issued',
        'raw_file',
        file.id,
        { expiresAt: expiresAt.toISOString() }
      );
    });
    return { url, expiresAt: expiresAt.toISOString() };
  }

  async readForProcessing(id: string, actor: CurrentUser) {
    const file = await this.findAccessibleOrThrow(id, actor);
    this.assertClean(file.scanStatus);
    return {
      buffer: await this.storage.read(file.storagePath),
      fileName: file.originalFileName,
      mimeType: file.mimeType,
      sha256: file.sha256
    };
  }

  async void(id: string, dto: VoidFileDto, actor: CurrentUser, context: RequestContext) {
    const accessible = await this.findAccessibleOrThrow(id, actor);
    if (actor.role === UserRole.boss || actor.role === UserRole.reviewer) {
      throw new ForbiddenException('无权删除文件');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      if (accessible.relatedWorkOrderId) await this.lockWorkOrder(tx, accessible.relatedWorkOrderId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 1))`;
      const file = await tx.rawFile.findUnique({ where: { id } });
      if (!file || file.isVoided) throw new NotFoundException('资源不存在');

      if (file.relatedWorkOrderId) {
        const workOrder = await tx.workOrder.findUnique({ where: { id: file.relatedWorkOrderId } });
        if (!workOrder) throw new NotFoundException('工单不存在');
        if (actor.role !== UserRole.employee || file.uploadedBy !== actor.id || workOrder.creatorId !== actor.id) {
          throw new ForbiddenException('只能删除本人可编辑工单中自己上传的附件');
        }
        if (!EMPLOYEE_FILE_EDITABLE_STATUSES.includes(workOrder.status)) {
          throw new ConflictException('工单状态已经变化，不能删除附件');
        }
      } else if (actor.role === UserRole.employee || file.uploadedBy !== actor.id) {
        throw new ForbiddenException('只能删除自己上传的项目文件');
      }

      const referencedRecord = await tx.businessRecord.findFirst({
        where: {
          OR: [
            { attachments: { array_contains: [id] } },
            { values: { some: { valueJson: { array_contains: [id] } } } }
          ]
        },
        select: { id: true }
      });
      if (referencedRecord) throw new ConflictException('文件已被业务记录引用，必须保留原始凭证');
      const [importTask, ocrTask] = await Promise.all([
        tx.importTask.findFirst({ where: { rawFileId: id }, select: { id: true } }),
        tx.ocrTask.findFirst({ where: { rawFileId: id }, select: { id: true } })
      ]);
      if (importTask || ocrTask) {
        throw new ConflictException('文件已被导入或 OCR 任务引用，必须先保留原始凭证');
      }

      await tx.workOrderAttachment.deleteMany({ where: { rawFileId: id } });
      if (file.relatedWorkOrderId) {
        await tx.workOrder.update({
          where: { id: file.relatedWorkOrderId },
          data: { version: { increment: 1 }, submissionSnapshot: Prisma.JsonNull, submittedAt: null }
        });
      }
      const updated = await tx.rawFile.update({
        where: { id },
        data: {
          isVoided: true,
          status: RawFileStatus.voided,
          voidReason: dto.reason ?? '用户删除',
          voidedAt: new Date(),
          voidedBy: actor.id
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'file.delete',
        'raw_file',
        id,
        { reason: updated.voidReason, sha256: updated.sha256 },
        context
      );
      await this.ledgerEvents.write(
        tx,
        actor,
        'raw_file_voided',
        'raw_file',
        id,
        { reason: updated.voidReason ?? null },
        `raw_file:${id}:voided`
      );
      return { file: updated, storagePath: file.storagePath };
    });
    await this.storage.remove(result.storagePath).catch((error: unknown) => {
      this.logger.error(`Failed to remove voided file ${id}: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
    return toRawFile(result.file);
  }

  async discardFailedUpload(id: string, actor: CurrentUser, context: RequestContext, reason: string) {
    const file = await this.prisma.rawFile.findUnique({ where: { id } });
    if (!file || file.isVoided) return;
    if (file.uploadedBy !== actor.id || file.relatedWorkOrderId) {
      throw new ForbiddenException('只能清理当前请求创建且未关联工单的文件');
    }
    await this.void(id, { reason }, actor, context);
  }

  private async findAccessibleOrThrow(id: string, actor: CurrentUser) {
    const file = await this.prisma.rawFile.findUnique({ where: { id } });
    if (!file || file.isVoided) throw new NotFoundException('资源不存在');
    if (file.relatedWorkOrderId) {
      await this.workOrders.findOne(file.relatedWorkOrderId, actor);
      return file;
    }
    if (actor.role === UserRole.employee && file.uploadedBy !== actor.id) {
      throw new ForbiddenException('无权访问该文件');
    }
    if (actor.role === UserRole.reviewer) throw new ForbiddenException('无权访问该文件');
    return file;
  }

  private async validateFile(file: Express.Multer.File) {
    if (file.size <= 0) throw new BadRequestException('不能上传空文件');
    if (file.size > this.maxFileSize) {
      throw new PayloadTooLargeException(`文件大小不能超过 ${this.maxFileSize / 1024 / 1024}MB`);
    }
    const originalFileName = this.validateFileName(file.originalname);
    const extension = extname(originalFileName).toLowerCase();
    const mimeTypes = ALLOWED_MIME_TYPES[extension];
    if (!mimeTypes || !mimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException('文件扩展名与 MIME 类型不匹配');
    }
    if ((!file.buffer || file.buffer.length === 0) && file.path) {
      const quarantinedPath = resolveQuarantinedUploadPath(file, this.quarantineRoot);
      await chmod(quarantinedPath, 0o600);
      file.buffer = await readFile(quarantinedPath);
    }
    if (!file.buffer || file.buffer.length === 0) throw new BadRequestException('不能上传空文件');
    if (file.size !== file.buffer.length) throw new BadRequestException('文件内容长度不一致');
    await this.fileSecurity.scan(originalFileName, file.buffer);
    return originalFileName;
  }

  private validateFileName(value: string) {
    const utf8Candidate = Buffer.from(value, 'latin1').toString('utf8');
    const decoded = utf8Candidate.includes('\uFFFD') ? value : utf8Candidate;
    const normalized = decoded.normalize('NFC');
    const leafName = basename(normalized.replace(/\\/g, '/'));
    if (
      !normalized ||
      normalized.length > 255 ||
      leafName !== normalized ||
      leafName === '.' ||
      leafName === '..' ||
      /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
      throw new BadRequestException('文件名不合法');
    }
    return leafName;
  }

  private assertClean(status: FileScanStatus) {
    if (status === FileScanStatus.clean) return;
    if (status === FileScanStatus.pending) {
      throw new HttpException('文件安全扫描尚未完成', HttpStatus.LOCKED);
    }
    if (status === FileScanStatus.failed) throw new ConflictException('文件安全扫描失败，禁止访问');
    throw new ForbiddenException('文件安全扫描发现风险，禁止访问');
  }

  private resolveFileType(fileName: string) {
    const extension = extname(fileName).slice(1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'image';
    if (extension === 'pdf') return 'pdf';
    if (['xls', 'xlsx', 'csv'].includes(extension)) return 'excel';
    if (extension === 'docx') return 'word';
    return 'other';
  }

  private async lockWorkOrder(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  }

  private async assertStorageQuotas(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
    incomingSize: number
  ) {
    const [userUsage, projectUsage] = await Promise.all([
      tx.rawFile.aggregate({
        where: { uploadedBy: userId, isVoided: false },
        _sum: { fileSize: true }
      }),
      tx.rawFile.aggregate({
        where: { relatedProjectId: projectId, isVoided: false },
        _sum: { fileSize: true }
      })
    ]);
    const incoming = BigInt(incomingSize);
    if ((userUsage._sum.fileSize ?? 0n) + incoming > this.userQuotaBytes) {
      throw new HttpException('当前账号附件存储配额已用尽', HttpStatus.INSUFFICIENT_STORAGE);
    }
    if ((projectUsage._sum.fileSize ?? 0n) + incoming > this.projectQuotaBytes) {
      throw new HttpException('当前项目附件存储配额已用尽', HttpStatus.INSUFFICIENT_STORAGE);
    }
  }
}
