import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  findMany(@Query() query: QueryNotificationsDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.notifications.findMany(query, user);
  }

  @Patch('read-all')
  markAllRead(@CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(user, getRequestContext(request));
  }

  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.notifications.markRead(id, user, getRequestContext(request));
  }
}
