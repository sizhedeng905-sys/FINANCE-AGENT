import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { QueryAiConversationsDto } from './dto/query-ai-conversations.dto';
import { QueryReportNarrativesDto } from './dto/query-report-narratives.dto';
import { ReviewReportNarrativeDto } from './dto/review-report-narrative.dto';
import { ReportNarrativesService } from './report-narratives.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly reportNarratives: ReportNarrativesService
  ) {}

  @Post('report-snapshots/:id/narrative')
  @Roles(UserRole.boss)
  reportNarrative(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.reportNarratives.generate(id, user, getRequestContext(request));
  }

  @Get('report-narratives/:id')
  @Roles(UserRole.finance, UserRole.boss)
  reportNarrativeDetail(@Param('id') id: string) {
    return this.reportNarratives.findOne(id);
  }

  @Get('report-narratives')
  @Roles(UserRole.finance, UserRole.boss)
  reportNarrativesPending(
    @Query() query: QueryReportNarrativesDto,
    @CurrentUserDecorator() user: CurrentUser
  ) {
    return this.reportNarratives.findPending(query, user);
  }

  @Post('report-narratives/:id/review')
  @Roles(UserRole.finance, UserRole.boss)
  reviewReportNarrative(
    @Param('id') id: string,
    @Body() dto: ReviewReportNarrativeDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.reportNarratives.review(id, dto, user, getRequestContext(request));
  }

  @Post('chat')
  @Roles(UserRole.boss)
  chat(@Body() dto: AiChatDto, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.ai.chat(dto, user, getRequestContext(request));
  }

  @Get('conversations')
  @Roles(UserRole.boss)
  conversations(@Query() query: QueryAiConversationsDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.ai.conversations(query, user);
  }

  @Get('conversations/:id/messages')
  @Roles(UserRole.boss)
  messages(
    @Param('id') id: string,
    @Query() query: QueryAiConversationsDto,
    @CurrentUserDecorator() user: CurrentUser
  ) {
    return this.ai.messages(id, query, user);
  }

  @Get('call-logs')
  @Roles(UserRole.boss)
  callLogs(@Query() query: QueryAiCallLogsDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.ai.callLogs(query, user);
  }

  @Get('call-logs/:id')
  @Roles(UserRole.boss)
  callLog(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.ai.callLog(id, user);
  }

  @Get('audit/call-logs')
  @Roles(UserRole.auditor)
  auditCallLogs(@Query() query: QueryAiCallLogsDto) {
    return this.ai.auditCallLogs(query);
  }

  @Get('audit/call-logs/:id')
  @Roles(UserRole.auditor)
  auditCallLog(@Param('id') id: string) {
    return this.ai.auditCallLog(id);
  }
}
