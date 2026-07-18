import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RetentionController } from './retention.controller';
import { RetentionWorkerService } from './retention-worker.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [AuditLogsModule, JwtModule.register({})],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionWorkerService, JwtAuthGuard, RolesGuard],
  exports: [RetentionService]
})
export class RetentionModule {}
