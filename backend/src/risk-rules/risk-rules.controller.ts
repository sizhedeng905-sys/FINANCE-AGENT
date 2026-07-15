import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateRiskRuleDto } from './dto/create-risk-rule.dto';
import { QueryRiskRulesDto } from './dto/query-risk-rules.dto';
import { UpdateRiskRuleDto } from './dto/update-risk-rule.dto';
import { RiskRulesService } from './risk-rules.service';

@ApiTags('risk-rules')
@ApiBearerAuth()
@Controller('risk-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskRulesController {
  constructor(private readonly rules: RiskRulesService) {}

  @Get()
  @Roles(UserRole.finance, UserRole.boss)
  findMany(@Query() query: QueryRiskRulesDto) {
    return this.rules.findMany(query);
  }

  @Post()
  @Roles(UserRole.finance)
  create(@Body() dto: CreateRiskRuleDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.rules.create(dto, user, getRequestContext(request));
  }

  @Patch(':id')
  @Roles(UserRole.finance)
  update(@Param('id') id: string, @Body() dto: UpdateRiskRuleDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.rules.update(id, dto, user, getRequestContext(request));
  }
}

@ApiTags('work-orders')
@ApiBearerAuth()
@Controller('work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RuleRunsController {
  constructor(private readonly rules: RiskRulesService) {}

  @Post(':id/run-rules')
  @Roles(UserRole.finance)
  run(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.rules.runForWorkOrder(id, user, getRequestContext(request));
  }
}
