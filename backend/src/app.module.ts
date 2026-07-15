import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import configuration from './config/configuration';
import { validateEnvironment } from './config/validate-environment';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestRateLimitMiddleware } from './common/middleware/request-rate-limit.middleware';
import { FieldsModule } from './fields/fields.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { ImportTasksModule } from './import-tasks/import-tasks.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RecordsModule } from './records/records.module';
import { RiskRulesModule } from './risk-rules/risk-rules.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ModelRuntimeModule } from './model-runtime/model-runtime.module';
import { OcrModule } from './ocr/ocr.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validate: validateEnvironment
    }),
    PrismaModule,
    IdempotencyModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    TemplatesModule,
    FieldsModule,
    RecordsModule,
    ImportTasksModule,
    WorkOrdersModule,
    FilesModule,
    NotificationsModule,
    ModelRuntimeModule,
    OcrModule,
    RiskRulesModule,
    ReportsModule,
    AiModule
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, RequestRateLimitMiddleware).forRoutes('*');
  }
}
