import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ReportSnapshotsService } from './report-snapshots.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuditLogsModule, JwtModule.register({})],
  controllers: [ReportsController],
  providers: [ReportsService, ReportSnapshotsService, JwtAuthGuard, RolesGuard],
  exports: [ReportsService, ReportSnapshotsService]
})
export class ReportsModule {}
