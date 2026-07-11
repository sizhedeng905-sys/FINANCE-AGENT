import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';
import { QueryAiCallLogsDto } from './dto/query-ai-call-logs.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('chat')
  @Roles(UserRole.boss)
  chat(@Body() dto: AiChatDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.ai.chat(dto, user, getRequestContext(request));
  }

  @Get('call-logs')
  @Roles(UserRole.boss)
  callLogs(@Query() query: QueryAiCallLogsDto) {
    return this.ai.callLogs(query);
  }
}
