import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileScanStatus, Prisma, RawFileStatus, UserRole, WorkOrderStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { extname, basename } from 'node:path';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { VoidFileDto } from './dto/void-file.dto';
import { toRawFile } from './file.presenter';
import { FILE_STORAGE, FileStorage } from './file-storage';

const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.xls': ['application/vnd.ms-excel'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};
const EMPLOYEE_FILE_EDITABLE_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.draft,
  WorkOrderStatus.returned_for_supplement
];
const MAX_WORK_ORDER_ATTACHMENTS = 20;

@Injectable()
export class FilesService {
  private readonly maxFileSize: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(AuditLogsService) private readonly auditLogs: AuditLogsService,
    @Inject(LedgerEventsService) private readonly ledgerEvents: LedgerEventsService,
    @Inject(ConfigService) config: ConfigService
  ) {
    const configuredMb = config.get<number>('maxFileSizeMb') ?? 50;
    this.maxFileSize = Math.max(1, configuredMb) * 1024 * 1024;
  }

  async upload(file: Express.Multer.File | undefined, dto: UploadFileDto, actor: CurrentUser, context: RequestContext) {
    if (!file) throw new BadRequestException('请选择上传文件');
    const originalFileName = this.validateFile(file);

    if (actor.role === UserRole.employee && !dto.workOrderId) {
      throw new ForbiddenException('员工上传附件必须关联本人工单');
    }
    if (actor.role === UserRole.finance && dto.workOrderId) {
      throw new ForbiddenException('财务只能上传项目级原始文件');
    }

    const linkedWorkOrder = dto.workOrderId ? await this.workOrders.findOne(dto.workOrderId, actor) : undefined;
    if (
      linkedWorkOrder &&
      actor.role === UserRole.employee &&
      !EMPLOYEE_FILE_EDITABLE_STATUSES.includes(linkedWorkOrder.status)
    ) {
      throw new ForbiddenException('当前工单状态不能新增附件');
    }
    const projectId = dto.relatedProjectId ?? linkedWorkOrder?.projectId;
    if (!projectId) throw new BadRequestException('relatedProjectId 或 workOrderId 至少提供一个');
    if (dto.relatedProjectId && linkedWorkOrder && dto.relatedProjectId !== linkedWorkOrder.projectId) {
      throw new BadRequestException('文件项目与工单项目不一致');
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.status !== 'active') throw new BadRequestException('项目不存在或未启用');

    const storagePath = await this.storage.save(file);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.workOrderId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.workOrderId}, 0))`;
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
            scanStatus: FileScanStatus.pending
          }
        });
        if (dto.workOrderId) {
          await tx.workOrderAttachment.create({
            data: { workOrderId: dto.workOrderId, rawFileId: rawFile.id, uploadedBy: actor.id }
          });
        }
        await this.auditLogs.write(tx, actor, 'file.upload', 'raw_file', rawFile.id, { sha256: rawFile.sha256, fileSize: file.size }, context);
        await this.ledgerEvents.write(tx, actor, 'raw_file_uploaded', 'raw_file', rawFile.id, {
          relatedProjectId: projectId,
          relatedWorkOrderId: dto.workOrderId ?? null,
          sha256: rawFile.sha256
        });
        return toRawFile(rawFile);
      });
    } catch (error) {
      await this.storage.remove(storagePath);
      throw error;
    }
  }

  async get(id: string, actor: CurrentUser) {
    return toRawFile(await this.findAccessibleOrThrow(id, actor));
  }

  async read(id: string, actor: CurrentUser, context: RequestContext, action: 'preview' | 'download') {
    const file = await this.findAccessibleOrThrow(id, actor);
    if (file.scanStatus === FileScanStatus.infected) throw new ForbiddenException('文件安全扫描未通过');
    const buffer = await this.storage.read(file.storagePath);
    await this.auditLogs.write(this.prisma, actor, `file.${action}`, 'raw_file', file.id, { sha256: file.sha256 }, context);
    return { buffer, fileName: file.originalFileName, mimeType: file.mimeType };
  }

  async readForProcessing(id: string, actor: CurrentUser) {
    const file = await this.findAccessibleOrThrow(id, actor);
    if (file.scanStatus === FileScanStatus.infected) throw new ForbiddenException('文件安全扫描未通过');
    return {
      buffer: await this.storage.read(file.storagePath),
      fileName: file.originalFileName,
      mimeType: file.mimeType,
      sha256: file.sha256
    };
  }

  async void(id: string, dto: VoidFileDto, actor: CurrentUser, context: RequestContext) {
    await this.findAccessibleOrThrow(id, actor);
    if (actor.role === UserRole.boss || actor.role === UserRole.reviewer) throw new ForbiddenException('无权删除文件');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 1))`;
      const file = await tx.rawFile.findUnique({ where: { id } });
      if (!file || file.isVoided) throw new NotFoundException('资源不存在');

      if (file.relatedWorkOrderId) {
        const workOrder = await tx.workOrder.findUnique({ where: { id: file.relatedWorkOrderId } });
        if (!workOrder) throw new NotFoundException('资源不存在');
        if (actor.role !== UserRole.employee || file.uploadedBy !== actor.id || workOrder.creatorId !== actor.id) {
          throw new ForbiddenException('只能删除本人可编辑工单中自己上传的附件');
        }
        if (!EMPLOYEE_FILE_EDITABLE_STATUSES.includes(workOrder.status)) {
          throw new ForbiddenException('当前工单状态不能删除附件');
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
      if (referencedRecord) {
        throw new ConflictException('文件已被业务记录引用，必须保留原始凭证');
      }

      await tx.workOrderAttachment.deleteMany({ where: { rawFileId: id } });
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
      await this.auditLogs.write(tx, actor, 'file.delete', 'raw_file', id, { reason: updated.voidReason }, context);
      await this.ledgerEvents.write(tx, actor, 'raw_file_voided', 'raw_file', id, { reason: updated.voidReason ?? null });
      return toRawFile(updated);
    });
  }

  private async findAccessibleOrThrow(id: string, actor: CurrentUser) {
    const file = await this.prisma.rawFile.findUnique({ where: { id } });
    if (!file || file.isVoided) throw new NotFoundException('资源不存在');
    if (file.relatedWorkOrderId) {
      await this.workOrders.findOne(file.relatedWorkOrderId, actor);
      return file;
    }
    if (actor.role === UserRole.employee && file.uploadedBy !== actor.id) throw new ForbiddenException('无权访问该文件');
    if (actor.role === UserRole.reviewer) throw new ForbiddenException('无权访问该文件');
    return file;
  }

  private validateFile(file: Express.Multer.File) {
    if (file.size <= 0 || file.buffer.length <= 0) throw new BadRequestException('不能上传空文件');
    if (file.size !== file.buffer.length) throw new BadRequestException('文件内容长度不一致');
    if (file.size > this.maxFileSize) throw new BadRequestException(`文件大小不能超过 ${this.maxFileSize / 1024 / 1024}MB`);
    const originalFileName = this.validateFileName(file.originalname);
    const extension = extname(originalFileName).toLowerCase();
    const mimeTypes = ALLOWED_MIME_TYPES[extension];
    if (!mimeTypes || !mimeTypes.includes(file.mimetype.toLowerCase()) || !this.hasExpectedSignature(extension, file.buffer)) {
      throw new BadRequestException('不支持的文件类型');
    }
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

  private hasExpectedSignature(extension: string, buffer: Buffer) {
    const startsWith = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
    if (extension === '.png') {
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) && buffer.includes(Buffer.from('IEND'));
    }
    if (extension === '.jpg' || extension === '.jpeg') {
      return startsWith(0xff, 0xd8, 0xff) && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
    }
    if (extension === '.pdf') {
      return buffer.subarray(0, 5).toString('ascii') === '%PDF-' && buffer.subarray(-1024).includes(Buffer.from('%%EOF'));
    }
    if (extension === '.webp') {
      return buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
        buffer.readUInt32LE(4) + 8 === buffer.length;
    }
    if (extension === '.xlsx' || extension === '.docx') {
      const archiveText = buffer.toString('latin1');
      const expectedFolder = extension === '.xlsx' ? 'xl/' : 'word/';
      return startsWith(0x50, 0x4b) && archiveText.includes('[Content_Types].xml') && archiveText.includes(expectedFolder);
    }
    if (extension === '.xls' || extension === '.doc') {
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    }
    if (extension === '.csv') {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return text.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
      } catch {
        return false;
      }
    }
    return false;
  }

  private resolveFileType(fileName: string) {
    const extension = extname(fileName).slice(1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'image';
    if (extension === 'pdf') return 'pdf';
    if (['xlsx', 'xls', 'csv'].includes(extension)) return 'excel';
    if (['doc', 'docx'].includes(extension)) return 'word';
    return 'other';
  }
}
