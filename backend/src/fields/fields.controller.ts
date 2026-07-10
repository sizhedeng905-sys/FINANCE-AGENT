import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateFieldDto } from './dto/create-field.dto';
import { QueryFieldsDto } from './dto/query-fields.dto';
import { UpdateFieldDto } from './dto/update-field.dto';
import { FieldsService } from './fields.service';

@ApiTags('fields')
@ApiBearerAuth()
@Controller('fields')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Get()
  findMany(@Query() query: QueryFieldsDto) {
    return this.fieldsService.findMany(query);
  }

  @Post()
  create(
    @Body() dto: CreateFieldDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.fieldsService.create(dto, user, getRequestContext(request));
  }

  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.fieldsService.usage(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fieldsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFieldDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.fieldsService.update(id, dto, user, getRequestContext(request));
  }

  @Patch(':id/disable')
  disable(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.fieldsService.disable(id, user, getRequestContext(request));
  }
}
