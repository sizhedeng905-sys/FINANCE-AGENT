import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: '太和中转项目' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: '太和物流' })
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @ApiPropertyOptional({ example: '中转场地、车辆、人工和杂费综合项目。' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '林雪' })
  @IsString()
  @IsNotEmpty()
  ownerName!: string;

  @ApiPropertyOptional({ enum: ProjectStatus, example: ProjectStatus.active })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
