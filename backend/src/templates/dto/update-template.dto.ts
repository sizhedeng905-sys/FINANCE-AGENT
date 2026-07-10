import { ApiPropertyOptional } from '@nestjs/swagger';
import { DataRecordType } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateTemplateDto {
  @ApiPropertyOptional({ example: '运输费用模板' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: DataRecordType })
  @IsOptional()
  @IsEnum(DataRecordType)
  recordType?: DataRecordType;

  @ApiPropertyOptional({ example: '记录车辆、司机、线路和运输成本。' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
