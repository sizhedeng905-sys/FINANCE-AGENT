import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateProjectTemplateDto {
  @ApiPropertyOptional({ example: '太和运输费用' })
  @IsOptional()
  @IsString()
  customName?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
