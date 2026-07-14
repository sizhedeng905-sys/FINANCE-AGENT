import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModelRuntimeService } from './model-runtime.service';

@ApiTags('model-runtime')
@ApiBearerAuth()
@Controller('model-runtime')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.finance, UserRole.boss)
export class ModelRuntimeController {
  constructor(private readonly runtime: ModelRuntimeService) {}

  @Get('deployments')
  deployments() {
    return this.runtime.deployments();
  }

  @Get('routes')
  routes() {
    return this.runtime.routes();
  }

  @Get('health')
  health() {
    return this.runtime.health();
  }
}
