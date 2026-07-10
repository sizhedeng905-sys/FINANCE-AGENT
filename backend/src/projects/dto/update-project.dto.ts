import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: '太和中转项目' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: '太和物流' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customerName?: string;

  @ApiPropertyOptional({ example: '中转场地、车辆、人工和杂费综合项目。' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '林雪' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ownerName?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
