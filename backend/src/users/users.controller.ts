import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance, UserRole.boss, UserRole.admin)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findMany(@Query() query: QueryUsersDto) {
    return this.usersService.findMany(query);
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.usersService.create(dto, user, getRequestContext(request));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id/password')
  updatePassword(
    @Param('id') id: string,
    @Body() dto: UpdateUserPasswordDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.usersService.updatePassword(id, dto, user, getRequestContext(request));
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.usersService.updateStatus(id, dto, user, getRequestContext(request));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.usersService.update(id, dto, user, getRequestContext(request));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.usersService.remove(id, user, getRequestContext(request));
  }
}
