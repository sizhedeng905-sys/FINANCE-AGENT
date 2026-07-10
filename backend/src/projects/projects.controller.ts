import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateProjectTemplateDto } from './dto/create-project-template.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Roles(UserRole.finance, UserRole.boss, UserRole.employee)
  findMany(@Query() query: QueryProjectsDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.projectsService.findMany(query, user);
  }

  @Post()
  @Roles(UserRole.finance)
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.projectsService.create(dto, user, getRequestContext(request));
  }

  @Get(':id/structure')
  @Roles(UserRole.finance, UserRole.boss)
  structure(@Param('id') id: string) {
    return this.projectsService.getStructure(id);
  }

  @Get(':id/summary')
  @Roles(UserRole.finance, UserRole.boss)
  summary(@Param('id') id: string) {
    return this.projectsService.getSummary(id);
  }

  @Get(':projectId/templates')
  @Roles(UserRole.finance, UserRole.boss)
  getProjectTemplates(@Param('projectId') projectId: string) {
    return this.projectsService.getProjectTemplates(projectId);
  }

  @Post(':projectId/templates')
  @Roles(UserRole.finance)
  enableTemplate(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectTemplateDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.projectsService.enableTemplate(projectId, dto, user, getRequestContext(request));
  }

  @Get(':id')
  @Roles(UserRole.finance, UserRole.boss)
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.finance)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.projectsService.update(id, dto, user, getRequestContext(request));
  }

  @Delete(':id')
  @Roles(UserRole.finance)
  archive(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.projectsService.archive(id, user, getRequestContext(request));
  }
}
