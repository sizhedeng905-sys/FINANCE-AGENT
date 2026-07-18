import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateRetentionLegalHoldDto } from './dto/create-retention-legal-hold.dto';
import { CreateRetentionRunDto } from './dto/create-retention-run.dto';
import { QueryRetentionLegalHoldsDto } from './dto/query-retention-legal-holds.dto';
import { QueryRetentionRunsDto } from './dto/query-retention-runs.dto';
import { RetentionService } from './retention.service';

@ApiTags('retention')
@ApiBearerAuth()
@Controller('retention')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.auditor)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('classes')
  classes() {
    return this.retention.classes();
  }

  @Get('runs')
  listRuns(@Query() query: QueryRetentionRunsDto) {
    return this.retention.listRuns(query);
  }

  @Get('runs/:id')
  findRun(@Param('id') id: string) {
    return this.retention.findRun(id);
  }

  @Post('runs')
  @Roles(UserRole.admin)
  createRun(
    @Body() dto: CreateRetentionRunDto,
    @CurrentUserDecorator() actor: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.retention.createRun(dto, actor, getRequestContext(request));
  }

  @Get('legal-holds')
  listLegalHolds(@Query() query: QueryRetentionLegalHoldsDto) {
    return this.retention.listLegalHolds(query);
  }

  @Post('legal-holds')
  @Roles(UserRole.admin)
  createLegalHold(
    @Body() dto: CreateRetentionLegalHoldDto,
    @CurrentUserDecorator() actor: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.retention.createLegalHold(dto, actor, getRequestContext(request));
  }
}
