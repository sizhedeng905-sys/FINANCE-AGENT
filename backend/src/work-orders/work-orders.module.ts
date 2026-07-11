import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RiskRulesModule } from '../risk-rules/risk-rules.module';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';

@Module({
  imports: [AuditLogsModule, RiskRulesModule, JwtModule.register({})],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, JwtAuthGuard, RolesGuard],
  exports: [WorkOrdersService]
})
export class WorkOrdersModule {}
