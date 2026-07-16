import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { FilesController } from './files.controller';
import { FileSecurityService } from './file-security.service';
import { FileStorageMaintenanceService } from './file-storage-maintenance.service';
import { FILE_STORAGE } from './file-storage';
import { FilesService } from './files.service';
import { LocalFileStorageService } from './local-file-storage.service';
import { createSecureUploadOptions } from './secure-upload-options';
import { TempUploadCleanupInterceptor } from './temp-upload-cleanup.interceptor';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';
import { UploadAdmissionService } from './upload-admission.service';

@Module({
  imports: [
    AuditLogsModule,
    LedgerEventsModule,
    WorkOrdersModule,
    JwtModule.register({}),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: createSecureUploadOptions
    })
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    FileSecurityService,
    FileStorageMaintenanceService,
    TempUploadCleanupInterceptor,
    UploadAdmissionInterceptor,
    UploadAdmissionService,
    LocalFileStorageService,
    { provide: FILE_STORAGE, useExisting: LocalFileStorageService },
    JwtAuthGuard,
    RolesGuard
  ],
  exports: [
    FilesService,
    FileSecurityService,
    UploadAdmissionInterceptor,
    UploadAdmissionService,
    MulterModule
  ]
})
export class FilesModule {}
