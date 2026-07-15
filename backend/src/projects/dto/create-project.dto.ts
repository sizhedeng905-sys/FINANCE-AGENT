import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: '太和中转项目' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;

  @ApiProperty({ example: '太和物流' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  customerName!: string;

  @ApiPropertyOptional({ example: '中转场地、车辆、人工和杂费综合项目。' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;

  @ApiProperty({ example: '林雪' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  ownerName!: string;

  @ApiPropertyOptional({ enum: ProjectStatus, example: ProjectStatus.active })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
