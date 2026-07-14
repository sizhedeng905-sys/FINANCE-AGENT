import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FilesModule } from '../files/files.module';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { ExcelParserService } from './excel-parser.service';
import { FieldSuggestionsController } from './field-suggestions.controller';
import { ImportTasksController } from './import-tasks.controller';
import { ImportTasksService } from './import-tasks.service';

@Module({
  imports: [FilesModule, AuditLogsModule, LedgerEventsModule, JwtModule.register({})],
  controllers: [ImportTasksController, FieldSuggestionsController],
  providers: [ImportTasksService, ExcelParserService, JwtAuthGuard, RolesGuard],
  exports: [ImportTasksService]
})
export class ImportTasksModule {}
