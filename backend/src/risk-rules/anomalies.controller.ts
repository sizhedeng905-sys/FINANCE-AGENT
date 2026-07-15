import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { HandleAnomalyDto } from './dto/handle-anomaly.dto';
import { QueryAnomaliesDto } from './dto/query-anomalies.dto';
import { RiskRulesService } from './risk-rules.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportAnomaliesController {
  constructor(private readonly rules: RiskRulesService) {}

  @Get('anomalies')
  @Roles(UserRole.finance, UserRole.boss)
  findMany(@Query() query: QueryAnomaliesDto) {
    return this.rules.findAnomalies(query);
  }

  @Patch('anomalies/:id/status')
  @Roles(UserRole.finance, UserRole.boss)
  handle(
    @Param('id') id: string,
    @Body() dto: HandleAnomalyDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.rules.handleAnomaly(id, dto, user, getRequestContext(request));
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiAnomaliesController {
  constructor(private readonly rules: RiskRulesService) {}

  @Get('anomalies')
  @Roles(UserRole.finance, UserRole.boss)
  findMany(@Query() query: QueryAnomaliesDto) {
    return this.rules.findAnomalies(query);
  }

  @Patch('anomalies/:id/status')
  @Roles(UserRole.finance, UserRole.boss)
  handle(
    @Param('id') id: string,
    @Body() dto: HandleAnomalyDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.rules.handleAnomaly(id, dto, user, getRequestContext(request));
  }
}
