import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateRecordDto } from './dto/create-record.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
import { RecordsService } from './records.service';

@ApiTags('records')
@ApiBearerAuth()
@Controller('records')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  @Roles(UserRole.finance, UserRole.boss)
  findMany(@Query() query: QueryRecordsDto) {
    return this.recordsService.findMany(query);
  }

  @Post()
  @Roles(UserRole.finance)
  create(
    @Body() dto: CreateRecordDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.recordsService.create(dto, user, getRequestContext(request));
  }

  @Get(':id')
  @Roles(UserRole.finance, UserRole.boss)
  findOne(@Param('id') id: string) {
    return this.recordsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.finance)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecordDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.recordsService.update(id, dto, user, getRequestContext(request));
  }

  @Delete(':id')
  @Roles(UserRole.finance)
  remove(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.recordsService.void(id, user, getRequestContext(request));
  }

  @Post(':id/confirm')
  @Roles(UserRole.finance)
  confirm(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.recordsService.confirm(id, user, getRequestContext(request));
  }
}
