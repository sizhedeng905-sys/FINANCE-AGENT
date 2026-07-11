import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { QueryWorkOrdersDto } from './dto/query-work-orders.dto';
import { BossApproveDto, FinanceReviewDto, ReviewerReviewDto, UrgeWorkOrderDto } from './dto/review-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { WorkOrdersService } from './work-orders.service';

@ApiTags('work-orders')
@ApiBearerAuth()
@Controller('work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  findMany(@Query() query: QueryWorkOrdersDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.workOrders.findMany(query, user);
  }

  @Post()
  @Roles(UserRole.employee)
  create(@Body() dto: CreateWorkOrderDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.create(dto, user, getRequestContext(request));
  }

  @Get(':id/timeline')
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  timeline(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.workOrders.timeline(id, user);
  }

  @Post(':id/submit')
  @Roles(UserRole.employee)
  submit(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.submit(id, user, getRequestContext(request));
  }

  @Post(':id/finance-review')
  @Roles(UserRole.finance)
  financeReview(@Param('id') id: string, @Body() dto: FinanceReviewDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.financeReview(id, dto, user, getRequestContext(request));
  }

  @Post(':id/reviewer-review')
  @Roles(UserRole.reviewer)
  reviewerReview(@Param('id') id: string, @Body() dto: ReviewerReviewDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.reviewerReview(id, dto, user, getRequestContext(request));
  }

  @Post(':id/ai-review')
  @Roles(UserRole.finance)
  aiReview(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.aiReview(id, user, getRequestContext(request));
  }

  @Post(':id/boss-approve')
  @Roles(UserRole.boss)
  bossApprove(@Param('id') id: string, @Body() dto: BossApproveDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.bossApprove(id, dto, user, getRequestContext(request));
  }

  @Post(':id/urge')
  @Roles(UserRole.employee)
  urge(@Param('id') id: string, @Body() dto: UrgeWorkOrderDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.urge(id, dto, user, getRequestContext(request));
  }

  @Get(':id')
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  findOne(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.workOrders.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.employee)
  update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.workOrders.update(id, dto, user, getRequestContext(request));
  }
}
