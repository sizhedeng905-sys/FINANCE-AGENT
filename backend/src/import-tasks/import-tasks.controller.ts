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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { QueryImportRowsDto } from './dto/query-import-rows.dto';
import { QueryImportTasksDto } from './dto/query-import-tasks.dto';
import { SaveMappingsDto } from './dto/save-mappings.dto';
import { ImportTasksService } from './import-tasks.service';

@ApiTags('import-tasks')
@ApiBearerAuth()
@Controller('import-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance)
export class ImportTasksController {
  constructor(private readonly imports: ImportTasksService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'projectId', 'templateId', 'importType'],
      properties: {
        file: { type: 'string', format: 'binary' },
        projectId: { type: 'string' },
        templateId: { type: 'string' },
        importType: { type: 'string' }
      }
    }
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateImportTaskDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.imports.create(file, dto, user, getRequestContext(request), idempotencyKey);
  }

  @Get()
  findMany(@Query() query: QueryImportTasksDto) {
    return this.imports.findMany(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.imports.findOne(id);
  }

  @Post(':id/parse')
  parse(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.imports.parse(id, user, getRequestContext(request));
  }

  @Get(':id/columns')
  columns(@Param('id') id: string) {
    return this.imports.getColumns(id);
  }

  @Get(':id/rows')
  rows(@Param('id') id: string, @Query() query: QueryImportRowsDto) {
    return this.imports.getRows(id, query);
  }

  @Get(':id/errors')
  errors(@Param('id') id: string, @Query() query: QueryImportRowsDto) {
    return this.imports.getRows(id, query, true);
  }

  @Put(':id/mappings')
  saveMappings(
    @Param('id') id: string,
    @Body() dto: SaveMappingsDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.imports.saveMappings(id, dto, user, getRequestContext(request));
  }

  @Post(':id/mapping-rules')
  saveMappingRules(
    @Param('id') id: string,
    @Body() dto: SaveMappingsDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.imports.saveMappings(id, dto, user, getRequestContext(request));
  }

  @Post(':id/auto-match')
  autoMatch(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.imports.autoMatch(id, user, getRequestContext(request));
  }

  @Post(':id/generate-suggestions')
  generateSuggestions(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.imports.generateSuggestions(id, user, getRequestContext(request));
  }

  @Get(':id/preview')
  preview(@Param('id') id: string) {
    return this.imports.preview(id);
  }

  @Get(':id/confirm-preview')
  confirmPreview(@Param('id') id: string) {
    return this.imports.preview(id);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.imports.confirm(id, user, getRequestContext(request));
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser, @Req() request: AuthenticatedRequest) {
    return this.imports.cancel(id, user, getRequestContext(request));
  }
}
