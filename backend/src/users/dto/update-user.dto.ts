import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'new_employee' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  username?: string;

  @ApiPropertyOptional({ example: '新员工' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @ApiPropertyOptional({ enum: UserRole, example: UserRole.employee })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

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
}
