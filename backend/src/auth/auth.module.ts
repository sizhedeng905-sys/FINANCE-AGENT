import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StepUpModule } from '../step-up/step-up.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginRateLimitService } from './login-rate-limit.service';

@Module({
  imports: [AuditLogsModule, JwtModule.register({}), StepUpModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, LoginRateLimitService],
  exports: [AuthService, JwtModule]
})
export class AuthModule {}
