import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessRecordStatus, DataRecordType, RecordSourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';

import { RecordValueInputDto } from './record-value-input.dto';

export class CreateRecordDto {
  @ApiProperty({ example: 'dp-001' })
  @IsString()
  projectId!: string;

  @ApiProperty({ example: 'dt-transport' })
  @IsString()
  templateId!: string;

  @ApiProperty({ enum: DataRecordType, example: DataRecordType.transport })
  @IsEnum(DataRecordType)
  recordType!: DataRecordType;

  @ApiProperty({ example: '2026-07-10' })
  @IsDateString()
  recordDate!: string;

  @ApiProperty({ example: 8800 })
  @Type(() => Number)
  @IsNumber()
  amount!: number;

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

  @ApiPropertyOptional({ enum: RecordSourceType, example: RecordSourceType.manual })
  @IsOptional()
  @IsEnum(RecordSourceType)
  sourceType?: RecordSourceType;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ enum: BusinessRecordStatus, example: BusinessRecordStatus.pending_confirm })
  @IsOptional()
  @IsEnum(BusinessRecordStatus)
  status?: BusinessRecordStatus;

  @ApiProperty({ type: [RecordValueInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordValueInputDto)
  values!: RecordValueInputDto[];

  @ApiPropertyOptional({ example: ['凭证.pdf'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
