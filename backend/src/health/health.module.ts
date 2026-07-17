import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { ModelRuntimeModule } from '../model-runtime/model-runtime.module';
import { HealthController } from './health.controller';

@Module({
  imports: [FilesModule, ModelRuntimeModule],
  controllers: [HealthController]
})
export class HealthModule {}
