import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { RequireStepUp } from '../step-up/require-step-up.decorator';
import { StepUpGuard } from '../step-up/step-up.guard';
import { TempUploadCleanupInterceptor } from '../files/temp-upload-cleanup.interceptor';
import { UploadAdmissionInterceptor } from '../files/upload-admission.interceptor';
import { ConfirmOcrTaskDto } from './dto/confirm-ocr-task.dto';
import { CorrectOcrTaskDto } from './dto/correct-ocr-task.dto';
import { CreateOcrTaskDto } from './dto/create-ocr-task.dto';
import { CreateOcrUploadDto } from './dto/create-ocr-upload.dto';
import { QueryOcrTasksDto } from './dto/query-ocr-tasks.dto';
import { RevalidateOcrTaskDto } from './dto/revalidate-ocr-task.dto';
import { OcrAiSuggestionService } from './ocr-ai-suggestion.service';
import { OcrTasksService } from './ocr-tasks.service';

@ApiTags('ocr-tasks')
@ApiBearerAuth()
@Controller(['ocr-tasks', 'ocr/tasks'])
@UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
export class OcrTasksController {
  constructor(
    private readonly tasks: OcrTasksService,
    private readonly aiSuggestions: OcrAiSuggestionService
  ) {}

  @Post()
  @Roles(UserRole.finance)
  create(
    @Body() dto: CreateOcrTaskDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.create(dto, user, getRequestContext(request), idempotencyKey);
  }

  @Post('upload')
  @Roles(UserRole.finance)
  @UseInterceptors(UploadAdmissionInterceptor, FileInterceptor('file'), TempUploadCleanupInterceptor)
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateOcrUploadDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.createFromUpload(file, dto, user, getRequestContext(request), idempotencyKey);
  }

  @Get()
  @Roles(UserRole.finance, UserRole.boss)
  findMany(@Query() query: QueryOcrTasksDto) {
    return this.tasks.findMany(query);
  }

  @Get(':id')
  @Roles(UserRole.finance, UserRole.boss)
  findOne(@Param('id') id: string) {
    return this.tasks.findOne(id);
  }

  @Post(':id/ai-suggestions')
  @Roles(UserRole.finance)
  aiSuggest(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.aiSuggestions.suggest(id, user, getRequestContext(request));
  }

  @Get(':id/ai-suggestions')
  @Roles(UserRole.finance)
  aiSuggestionHistory(@Param('id') id: string) {
    return this.aiSuggestions.latest(id);
  }

  @Post(':id/run')
  @Roles(UserRole.finance)
  run(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.tasks.run(id, user, getRequestContext(request));
  }

  @Post(':id/recognize')
  @Roles(UserRole.finance)
  recognize(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.tasks.run(id, user, getRequestContext(request));
  }

  @Put(':id/corrections')
  @Roles(UserRole.finance)
  correct(
    @Param('id') id: string,
    @Body() dto: CorrectOcrTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.correct(id, dto, user, getRequestContext(request));
  }

  @Post(':id/corrections')
  @Roles(UserRole.finance)
  correctPost(
    @Param('id') id: string,
    @Body() dto: CorrectOcrTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.correct(id, dto, user, getRequestContext(request));
  }

  @Post(':id/correct')
  @Roles(UserRole.finance)
  correctLegacy(
    @Param('id') id: string,
    @Body() dto: CorrectOcrTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.correct(id, dto, user, getRequestContext(request));
  }

  @Post(':id/revalidate')
  @Roles(UserRole.finance)
  revalidate(
    @Param('id') id: string,
    @Body() dto: RevalidateOcrTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.revalidate(id, dto, user, getRequestContext(request));
  }

  @Post(':id/confirm')
  @Roles(UserRole.finance)
  @RequireStepUp({ action: 'ocr.confirm', resourceType: 'ocr_task', resourceParam: 'id' })
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmOcrTaskDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.tasks.confirm(id, dto, user, getRequestContext(request), idempotencyKey);
  }

  @Post(':id/retry')
  @Roles(UserRole.finance)
  retry(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.tasks.retry(id, user, getRequestContext(request));
  }

  @Post(':id/cancel')
  @Roles(UserRole.finance)
  cancel(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.tasks.cancel(id, user, getRequestContext(request));
  }
}
