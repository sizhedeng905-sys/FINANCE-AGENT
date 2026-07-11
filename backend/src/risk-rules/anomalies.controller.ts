import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
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
}
