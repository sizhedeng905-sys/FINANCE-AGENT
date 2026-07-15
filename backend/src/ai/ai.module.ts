import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ReportsModule } from '../reports/reports.module';
import { RiskRulesModule } from '../risk-rules/risk-rules.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { AiController } from './ai.controller';
import { AiAnswerGroundingService } from './ai-answer-grounding.service';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { HttpAiProviderService } from './http-ai-provider.service';
import { MockAiProviderService } from './mock-ai-provider.service';

@Module({
  imports: [AuditLogsModule, ReportsModule, RiskRulesModule, WorkOrdersModule, JwtModule.register({})],
  controllers: [AiController],
  providers: [
    AiService,
    AiAnswerGroundingService,
    AiToolsService,
    AiProviderService,
    MockAiProviderService,
    HttpAiProviderService,
    JwtAuthGuard,
    RolesGuard
  ]
})
export class AiModule {}
