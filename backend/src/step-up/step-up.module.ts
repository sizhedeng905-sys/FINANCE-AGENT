import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { StepUpEnforcementService } from './step-up-enforcement.service';
import { StepUpGuard } from './step-up.guard';

@Global()
@Module({
  imports: [AuditLogsModule, JwtModule.register({})],
  providers: [StepUpEnforcementService, StepUpGuard],
  exports: [StepUpEnforcementService, StepUpGuard]
})
export class StepUpModule {}
