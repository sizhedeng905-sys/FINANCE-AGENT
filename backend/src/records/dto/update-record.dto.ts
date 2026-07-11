import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessRecordStatus, DataRecordType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

import { RecordValueInputDto } from './record-value-input.dto';

export class UpdateRecordDto {
  @ApiPropertyOptional({ enum: DataRecordType })
  @IsOptional()
  @IsEnum(DataRecordType)
  recordType?: DataRecordType;

  @ApiPropertyOptional({ example: '2026-07-10' })
  @IsOptional()
  @IsDateString()
  recordDate?: string;

  @ApiPropertyOptional({ example: 8800 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: '成本' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: '运输费用模板' })
  @IsOptional()
  @IsString()
  subCategory?: string;

  @ApiPropertyOptional({ example: '太和运输费用手工补录' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: BusinessRecordStatus })
  @IsOptional()
  @IsEnum(BusinessRecordStatus)
  status?: BusinessRecordStatus;

  @ApiPropertyOptional({ type: [RecordValueInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordValueInputDto)
  values?: RecordValueInputDto[];

  @ApiPropertyOptional({ example: ['凭证.pdf'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
