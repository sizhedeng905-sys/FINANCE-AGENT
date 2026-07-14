import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateTemplateFieldDto } from './dto/create-template-field.dto';
import { QueryTemplatesDto } from './dto/query-templates.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplatesService } from './templates.service';

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  findMany(@Query() query: QueryTemplatesDto) {
    return this.templatesService.findMany(query);
  }

  @Post()
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.create(dto, user, getRequestContext(request));
  }

  @Get(':id/fields')
  @Roles(UserRole.finance, UserRole.boss)
  getFields(@Param('id') id: string) {
    return this.templatesService.getFields(id);
  }

  @Post(':id/fields')
  addField(
    @Param('id') id: string,
    @Body() dto: CreateTemplateFieldDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.addField(id, dto, user, getRequestContext(request));
  }

  @Post(':id/clone')
  clone(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.clone(id, user, getRequestContext(request));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.update(id, dto, user, getRequestContext(request));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.remove(id, user, getRequestContext(request));
  }
}
