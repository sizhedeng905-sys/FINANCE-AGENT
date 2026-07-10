import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProjectTemplatesController } from './project-templates.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuditLogsModule, JwtModule.register({})],
  controllers: [ProjectsController, ProjectTemplatesController],
  providers: [ProjectsService, JwtAuthGuard, RolesGuard],
  exports: [ProjectsService]
})
export class ProjectsModule {}
