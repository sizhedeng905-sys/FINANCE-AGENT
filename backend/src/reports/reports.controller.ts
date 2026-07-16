import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  QueryBossReportDto,
  QueryDailyReportDto,
  QueryFinanceReportDto,
  QueryMonthlyReportDto,
  QueryRankingReportDto
} from './dto/query-reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('finance')
  @Roles(UserRole.finance, UserRole.boss)
  finance(@Query() query: QueryFinanceReportDto) {
    return this.reports.finance(query);
  }

  @Get('boss')
  @Roles(UserRole.boss)
  boss(@Query() query: QueryBossReportDto) {
    return this.reports.boss(query);
  }

  @Get('ranking')
  @Roles(UserRole.finance, UserRole.boss)
  ranking(@Query() query: QueryRankingReportDto) {
    return this.reports.ranking(query);
  }

  @Get('projects/:projectId/daily')
  @Roles(UserRole.finance, UserRole.boss)
  projectDaily(@Param('projectId') projectId: string, @Query() query: QueryDailyReportDto) {
    return this.reports.projectDaily(projectId, query);
  }

  @Get('projects/:projectId/monthly')
  @Roles(UserRole.finance, UserRole.boss)
  projectMonthly(@Param('projectId') projectId: string, @Query() query: QueryMonthlyReportDto) {
    return this.reports.projectMonthly(projectId, query);
  }
}
