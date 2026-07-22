import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Response } from 'express';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedRequest, CurrentUser } from '../common/types/current-user';
import { csrfCookieName, sessionCookieName } from '../common/utils/auth-cookies';
import { getRequestContext } from '../common/utils/request-context';
import { getRoleTitle } from '../common/utils/user-presenter';
import { StepUpEnforcementService } from '../step-up/step-up-enforcement.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { StepUpDto } from './dto/step-up.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly stepUpEnforcement: StepUpEnforcementService
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Returns an access token and the authenticated user.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or disabled account.' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    const session = await this.authService.login(dto, getRequestContext(request));
    this.setSessionCookies(response, session.accessToken);
    return session;
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUserDecorator() user: CurrentUser) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department,
      title: getRoleTitle(user.role)
    };
  }

  @Get('security-capabilities')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  securityCapabilities() {
    const stepUp = this.stepUpEnforcement.capabilities();
    return {
      mfa: stepUp.mfa,
      stepUp: {
        ...stepUp,
        status: stepUp.mode === 'enforce' ? 'enforced_for_configured_actions' : 'available_disabled',
        endpoint: '/api/auth/step-up'
      }
    };
  }

  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  stepUp(
    @Body() dto: StepUpDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest
  ) {
    return this.authService.stepUp(dto, user, getRequestContext(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUserDecorator() user: CurrentUser,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.authService.logout(user, getRequestContext(request));
    this.clearSessionCookies(response);
    return result;
  }

  private setSessionCookies(response: Response, accessToken: string) {
    const production = this.config.get<string>('nodeEnv') === 'production';
    this.clearCookieFamily(response, !production);
    const options = {
      httpOnly: true,
      secure: production,
      sameSite: 'strict' as const,
      path: '/'
    };
    response.cookie(sessionCookieName(production), accessToken, options);
    response.cookie(csrfCookieName(production), randomBytes(32).toString('base64url'), {
      ...options,
      httpOnly: false
    });
  }

  private clearSessionCookies(response: Response) {
    this.clearCookieFamily(response, false);
    this.clearCookieFamily(response, true);
  }

  private clearCookieFamily(response: Response, production: boolean) {
    const options = { secure: production, sameSite: 'strict' as const, path: '/' };
    response.clearCookie(sessionCookieName(production), { ...options, httpOnly: true });
    response.clearCookie(csrfCookieName(production), { ...options, httpOnly: false });
  }
}
