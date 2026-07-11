import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
import { LocalFileStorageService } from './local-file-storage.service';

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

@Injectable()
export class FilesService {
  private readonly maxFileSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalFileStorageService,
    private readonly workOrders: WorkOrdersService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService,
    config: ConfigService
  ) {
    const configuredMb = config.get<number>('maxFileSizeMb') ?? 50;
    this.maxFileSize = Math.max(1, configuredMb) * 1024 * 1024;
  }

  async upload(file: Express.Multer.File | undefined, dto: UploadFileDto, actor: CurrentUser, context: RequestContext) {
    if (!file) throw new BadRequestException('请选择上传文件');
    this.validateFile(file);

    const linkedWorkOrder = dto.workOrderId ? await this.workOrders.findOne(dto.workOrderId, actor) : undefined;
    const projectId = dto.relatedProjectId ?? linkedWorkOrder?.projectId;
    if (!projectId) throw new BadRequestException('relatedProjectId 或 workOrderId 至少提供一个');
    if (dto.relatedProjectId && linkedWorkOrder && dto.relatedProjectId !== linkedWorkOrder.projectId) {
      throw new BadRequestException('文件项目与工单项目不一致');
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.status !== 'active') throw new BadRequestException('项目不存在或未启用');

    const originalFileName = basename(file.originalname);
    const storagePath = await this.storage.save(file);
    try {
      return await this.prisma.$transaction(async (tx) => {
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

  async void(id: string, dto: VoidFileDto, actor: CurrentUser, context: RequestContext) {
    const file = await this.findAccessibleOrThrow(id, actor);
    if (actor.role === UserRole.boss || actor.role === UserRole.reviewer) throw new ForbiddenException('无权删除文件');
    if (actor.role === UserRole.employee) {
      if (file.uploadedBy !== actor.id) throw new ForbiddenException('只能删除自己上传的文件');
      if (file.relatedWorkOrderId) {
        const workOrder = await this.workOrders.findOne(file.relatedWorkOrderId, actor);
        if (!EMPLOYEE_FILE_EDITABLE_STATUSES.includes(workOrder.status)) {
          throw new ForbiddenException('当前工单状态不能删除附件');
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
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
    if (file.size <= 0) throw new BadRequestException('不能上传空文件');
    if (file.size > this.maxFileSize) throw new BadRequestException(`文件大小不能超过 ${this.maxFileSize / 1024 / 1024}MB`);
    const extension = extname(file.originalname).toLowerCase();
    const mimeTypes = ALLOWED_MIME_TYPES[extension];
    if (!mimeTypes || !mimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException('不支持的文件类型');
    }
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
