import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FilesModule } from '../files/files.module';
import { LedgerEventsModule } from '../ledger-events/ledger-events.module';
import { DocumentPreprocessorService } from './document-preprocessor.service';
import { LocalPaddleOcrProvider } from './local-paddle-ocr.provider';
import { MockOcrProvider } from './mock-ocr.provider';
import { OcrProviderRegistry } from './ocr-provider.registry';
import { OcrTasksController } from './ocr-tasks.controller';
import { OcrTasksService } from './ocr-tasks.service';

@Module({
  imports: [FilesModule, AuditLogsModule, LedgerEventsModule, JwtModule.register({})],
  controllers: [OcrTasksController],
  providers: [
    OcrTasksService,
    DocumentPreprocessorService,
    MockOcrProvider,
    LocalPaddleOcrProvider,
    OcrProviderRegistry,
    JwtAuthGuard,
    RolesGuard
  ],
  exports: [OcrTasksService]
})
export class OcrModule {}
