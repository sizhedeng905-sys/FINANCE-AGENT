import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProjectTemplateDto {
  @ApiProperty({ example: 'dt-transport' })
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @ApiPropertyOptional({ example: '太和运输费用' })
  @IsOptional()
  @IsString()
  customName?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
