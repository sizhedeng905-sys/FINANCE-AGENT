import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { toAuthUser } from '../common/utils/user-presenter';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        username: dto.username
      }
    });

    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const passwordMatched = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatched) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id
      },
      {
        secret: this.configService.get<string>('jwtSecret'),
        expiresIn: '7d'
      }
    );

    return {
      accessToken,
      user: toAuthUser(user)
    };
  }

  logout() {
    return {
      success: true
    };
  }
}
