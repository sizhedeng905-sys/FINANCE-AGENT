import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Response } from 'express';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/types/current-user';
import { AuthenticatedRequest } from '../common/types/current-user';
import { getRequestContext } from '../common/utils/request-context';
import { csrfCookieName, sessionCookieName } from '../common/utils/auth-cookies';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: {
          accessToken: 'jwt-token',
          user: {
            id: 'user-id',
            username: 'finance',
            name: '财务',
            role: 'finance',
            department: '财务部',
            title: '财务审核'
          }
        }
      }
    }
  })
  @ApiUnauthorizedResponse({ description: '账号或密码错误' })
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
      title: this.getTitle(user.role)
    };
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
    const production = this.config.get<string>('nodeEnv') === 'production';
    const options = { secure: production, sameSite: 'strict' as const, path: '/' };
    response.clearCookie(sessionCookieName(production), { ...options, httpOnly: true });
    response.clearCookie(csrfCookieName(production), { ...options, httpOnly: false });
  }

  private getTitle(role: CurrentUser['role']): string {
    const titleMap: Record<CurrentUser['role'], string> = {
      employee: '员工',
      finance: '财务审核',
      reviewer: '复核员',
      boss: '老板'
    };

    return titleMap[role];
  }
}
