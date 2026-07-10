import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { CurrentUser as CurrentUserDecorator } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/types/current-user';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
  logout() {
    return this.authService.logout();
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
