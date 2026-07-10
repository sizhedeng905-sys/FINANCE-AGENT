import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { UpdateProjectTemplateDto } from './dto/update-project-template.dto';
import { ProjectsService } from './projects.service';

@ApiTags('project-templates')
@ApiBearerAuth()
@Controller('project-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class ProjectTemplatesController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectTemplateDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.projectsService.updateProjectTemplate(id, dto, user, getRequestContext(request));
  }

  @Patch(':id/disable')
  disable(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.projectsService.disableProjectTemplate(id, user, getRequestContext(request));
  }
}
