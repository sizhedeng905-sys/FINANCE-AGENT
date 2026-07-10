import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TemplateFieldsController } from './template-fields.controller';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [AuditLogsModule, JwtModule.register({})],
  controllers: [TemplatesController, TemplateFieldsController],
  providers: [TemplatesService, JwtAuthGuard, RolesGuard],
  exports: [TemplatesService]
})
export class TemplatesModule {}
