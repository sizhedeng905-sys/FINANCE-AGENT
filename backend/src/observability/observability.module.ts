import { Global, Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { ModelRuntimeModule } from '../model-runtime/model-runtime.module';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';
import { TraceExporterService } from './trace-exporter.service';
import { TracingMiddleware } from './tracing.middleware';

@Global()
@Module({
  imports: [FilesModule, ModelRuntimeModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware, TraceExporterService, TracingMiddleware],
  exports: [MetricsService, MetricsMiddleware, TraceExporterService, TracingMiddleware]
})
export class ObservabilityModule {}
