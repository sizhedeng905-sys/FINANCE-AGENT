import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { QueryRecordsDto } from './dto/query-records.dto';
import { RecordsService } from './records.service';

@ApiTags('project-records')
@ApiBearerAuth()
@Controller('projects/:projectId/records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance, UserRole.boss)
export class ProjectRecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  findProjectRecords(@Param('projectId') projectId: string, @Query() query: QueryRecordsDto) {
    return this.recordsService.findProjectRecords(projectId, query);
  }
}
