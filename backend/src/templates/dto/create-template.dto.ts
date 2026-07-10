import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataRecordType } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty({ example: '运输费用模板' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: DataRecordType, example: DataRecordType.transport })
  @IsEnum(DataRecordType)
  recordType!: DataRecordType;

  @ApiPropertyOptional({ example: '记录车辆、司机、线路和运输成本。' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
