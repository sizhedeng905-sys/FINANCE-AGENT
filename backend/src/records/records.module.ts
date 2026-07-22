import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { RecordPolicyModule } from '../record-policy/record-policy.module';
import { ProjectRecordsController } from './project-records.controller';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

@Module({
  imports: [AuditLogsModule, LedgerEventsModule, RecordPolicyModule, JwtModule.register({})],
  controllers: [RecordsController, ProjectRecordsController],
  providers: [RecordsService, JwtAuthGuard, RolesGuard],
  exports: [RecordsService]
})
export class RecordsModule {}
