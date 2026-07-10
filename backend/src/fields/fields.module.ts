import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';

@Module({
  imports: [AuditLogsModule, JwtModule.register({})],
  controllers: [FieldsController],
  providers: [FieldsService, JwtAuthGuard, RolesGuard],
  exports: [FieldsService]
})
export class FieldsModule {}
