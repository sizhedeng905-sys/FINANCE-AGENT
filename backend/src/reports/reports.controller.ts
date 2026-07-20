import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateReportSnapshotDto } from './dto/create-report-snapshot.dto';
import { QueryReportSnapshotSourcesDto } from './dto/query-report-snapshot-sources.dto';
import {
  QueryBossReportDto,
  QueryDailyReportDto,
  QueryFinanceReportDto,
  QueryMonthlyReportDto,
  QueryRankingReportDto
} from './dto/query-reports.dto';
import { ReportsService } from './reports.service';
import { ReportSnapshotsService } from './report-snapshots.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly snapshots: ReportSnapshotsService
  ) {}

  @Post('snapshots')
  @Roles(UserRole.finance, UserRole.boss)
  createSnapshot(
    @Body() dto: CreateReportSnapshotDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.snapshots.create(dto, user, getRequestContext(request));
  }

  @Get('snapshots/:id/sources')
  @Roles(UserRole.finance, UserRole.boss)
  snapshotSources(
    @Param('id') id: string,
    @Query() query: QueryReportSnapshotSourcesDto
  ) {
    return this.snapshots.sources(id, query);
  }

  @Get('snapshots/:id')
  @Roles(UserRole.finance, UserRole.boss)
  snapshot(@Param('id') id: string) {
    return this.snapshots.findOne(id);
  }

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
