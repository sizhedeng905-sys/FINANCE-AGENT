import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'new_employee' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  username!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: '新员工' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.employee })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ example: '运营部' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  department?: string;

  @ApiPropertyOptional({ example: '13800000000' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  phone?: string;

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.active })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
