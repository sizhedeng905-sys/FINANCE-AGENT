import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { UploadFileDto } from './dto/upload-file.dto';
import { VoidFileDto } from './dto/void-file.dto';
import { FilesService } from './files.service';
import { TempUploadCleanupInterceptor } from './temp-upload-cleanup.interceptor';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload')
  @Roles(UserRole.employee, UserRole.finance)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        relatedProjectId: { type: 'string' },
        workOrderId: { type: 'string' }
      },
      required: ['file']
    }
  })
  @UseInterceptors(UploadAdmissionInterceptor, FileInterceptor('file'), TempUploadCleanupInterceptor)
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadFileDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.files.upload(file, dto, user, getRequestContext(request));
  }

  @Get(':id/preview')
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async preview(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    const file = await this.files.read(id, user, getRequestContext(request), 'preview');
    response.setHeader('Content-Type', file.inlineAllowed ? file.mimeType : 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      this.contentDisposition(file.inlineAllowed ? 'inline' : 'attachment', file.fileName)
    );
    response.setHeader('Content-Length', file.fileSize.toString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-File-Trust', file.trustStatus);
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.stream);
  }

  @Get(':id/download')
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    const file = await this.files.read(id, user, getRequestContext(request), 'download');
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', this.contentDisposition('attachment', file.fileName));
    response.setHeader('Content-Length', file.fileSize.toString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Download-Options', 'noopen');
    response.setHeader('X-File-Trust', file.trustStatus);
    return new StreamableFile(file.stream);
  }

  @Get(':id/signed-download')
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  signedDownload(
    @Param('id') id: string,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.files.createSignedDownloadUrl(id, user, getRequestContext(request));
  }

  @Get(':id')
  @Roles(UserRole.employee, UserRole.finance, UserRole.reviewer, UserRole.boss)
  get(@Param('id') id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.files.get(id, user);
  }

  @Delete(':id')
  @Roles(UserRole.employee, UserRole.finance)
  remove(
    @Param('id') id: string,
    @Body() dto: VoidFileDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.files.void(id, dto, user, getRequestContext(request));
  }

  private contentDisposition(type: 'inline' | 'attachment', fileName: string) {
    const encoded = encodeURIComponent(fileName).replace(/['()]/g, escape);
    return `${type}; filename="file"; filename*=UTF-8''${encoded}`;
  }
}
