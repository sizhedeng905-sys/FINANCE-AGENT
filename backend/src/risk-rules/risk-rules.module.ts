import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { AiAnomaliesController, ReportAnomaliesController } from './anomalies.controller';
import { RiskRulesController, RuleRunsController } from './risk-rules.controller';
import { RiskRulesService } from './risk-rules.service';

@Module({
  imports: [AuditLogsModule, LedgerEventsModule, JwtModule.register({})],
  controllers: [RiskRulesController, RuleRunsController, ReportAnomaliesController, AiAnomaliesController],
  providers: [RiskRulesService, JwtAuthGuard, RolesGuard],
  exports: [RiskRulesService]
})
export class RiskRulesModule {}
