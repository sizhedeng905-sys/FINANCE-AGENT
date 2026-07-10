import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'new_employee' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: '新员工' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.employee })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ example: '运营部' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: '13800000000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.active })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
