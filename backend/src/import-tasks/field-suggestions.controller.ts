import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import {
  ApproveFieldSuggestionDto,
  MapFieldSuggestionDto,
  QueryFieldSuggestionsDto
} from './dto/field-suggestion.dto';
import { ImportTasksService } from './import-tasks.service';

@ApiTags('field-suggestions')
@ApiBearerAuth()
@Controller('field-suggestions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class FieldSuggestionsController {
  constructor(private readonly imports: ImportTasksService) {}

  @Get()
  findMany(@Query() query: QueryFieldSuggestionsDto) {
    return this.imports.findSuggestions(query);
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveFieldSuggestionDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.imports.approveSuggestion(id, dto, user, getRequestContext(request));
  }

  @Post(':id/map')
  map(
    @Param('id') id: string,
    @Body() dto: MapFieldSuggestionDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.imports.mapSuggestion(id, dto, user, getRequestContext(request));
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.imports.rejectSuggestion(id, user, getRequestContext(request));
  }
}
