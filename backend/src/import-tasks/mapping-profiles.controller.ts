import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { QueryMappingProfilesDto } from './dto/query-mapping-profiles.dto';
import { ImportTasksService } from './import-tasks.service';

@ApiTags('mapping-profiles')
@ApiBearerAuth()
@Controller('mapping-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class MappingProfilesController {
  constructor(private readonly imports: ImportTasksService) {}

  @Get()
  findMany(@Query() query: QueryMappingProfilesDto) {
    return this.imports.findMappingProfiles(query);
  }

  @Post(':id/revoke')
  revoke(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.imports.revokeMappingProfile(id, user, getRequestContext(request));
  }
}
