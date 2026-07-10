import { Body, Controller, Delete, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { UpdateTemplateFieldDto } from './dto/update-template-field.dto';
import { TemplatesService } from './templates.service';

@ApiTags('template-fields')
@ApiBearerAuth()
@Controller('template-fields')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class TemplateFieldsController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateFieldDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.updateTemplateField(id, dto, user, getRequestContext(request));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.templatesService.removeTemplateField(id, user, getRequestContext(request));
  }
}
