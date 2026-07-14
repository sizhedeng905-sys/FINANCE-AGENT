import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { FilesController } from './files.controller';
import { FILE_STORAGE } from './file-storage';
import { FilesService } from './files.service';
import { LocalFileStorageService } from './local-file-storage.service';

@Module({
  imports: [AuditLogsModule, LedgerEventsModule, WorkOrdersModule, JwtModule.register({})],
  controllers: [FilesController],
  providers: [
    FilesService,
    LocalFileStorageService,
    { provide: FILE_STORAGE, useExisting: LocalFileStorageService },
    JwtAuthGuard,
    RolesGuard
  ],
  exports: [FilesService]
})
export class FilesModule {}
