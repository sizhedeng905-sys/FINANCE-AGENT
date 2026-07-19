import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FilesModule } from '../files/files.module';
import { TempUploadCleanupInterceptor } from '../files/temp-upload-cleanup.interceptor';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { RecordPolicyModule } from '../record-policy/record-policy.module';
import { ExcelParserService } from './excel-parser.service';
import { FieldSuggestionsController } from './field-suggestions.controller';
import { ImportTasksController } from './import-tasks.controller';
import { ImportTasksService } from './import-tasks.service';
import { MappingProfilesController } from './mapping-profiles.controller';
import { XlsConverterService } from './xls-converter.service';

@Module({
  imports: [FilesModule, AuditLogsModule, LedgerEventsModule, RecordPolicyModule, JwtModule.register({})],
  controllers: [ImportTasksController, FieldSuggestionsController, MappingProfilesController],
  providers: [
    ImportTasksService,
    ExcelParserService,
    XlsConverterService,
    TempUploadCleanupInterceptor,
    JwtAuthGuard,
    RolesGuard
  ],
  exports: [ImportTasksService]
})
export class ImportTasksModule {}
