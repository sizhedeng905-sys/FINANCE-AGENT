import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModelExecutionGateService } from './model-execution-gate.service';
import { ModelRuntimeController } from './model-runtime.controller';
import { ModelRuntimeService } from './model-runtime.service';
import { ResilientHttpClientService } from './resilient-http-client.service';
import { StructuredOutputValidatorService } from './structured-output-validator.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [ModelRuntimeController],
  providers: [
    ModelRuntimeService,
    ModelExecutionGateService,
    ResilientHttpClientService,
    StructuredOutputValidatorService,
    JwtAuthGuard,
    RolesGuard
  ],
  exports: [ModelRuntimeService, ModelExecutionGateService, ResilientHttpClientService, StructuredOutputValidatorService]
})
export class ModelRuntimeModule {}
