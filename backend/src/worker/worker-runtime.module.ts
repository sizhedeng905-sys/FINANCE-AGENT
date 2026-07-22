import { Module } from '@nestjs/common';

import { ImportTasksModule } from '../import-tasks/import-tasks.module';
import { OcrModule } from '../ocr/ocr.module';
import { WorkerRuntimeService } from './worker-runtime.service';

@Module({
  imports: [ImportTasksModule, OcrModule],
  providers: [WorkerRuntimeService]
})
export class WorkerRuntimeModule {}
