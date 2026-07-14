import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessRecordStatus, DataRecordType, RecordSourceType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryRecordsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'dp-001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  projectId?: string;

  @ApiPropertyOptional({ example: 'dt-transport' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  templateId?: string;

  @ApiPropertyOptional({ example: 'import-task-id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  importTaskId?: string;

  @ApiPropertyOptional({ enum: DataRecordType })
  @IsOptional()
  @IsEnum(DataRecordType)
  recordType?: DataRecordType;

  @ApiPropertyOptional({ enum: RecordSourceType })
  @IsOptional()
  @IsEnum(RecordSourceType)
  sourceType?: RecordSourceType;

  @ApiPropertyOptional({ enum: BusinessRecordStatus })
  @IsOptional()
  @IsEnum(BusinessRecordStatus)
  status?: BusinessRecordStatus;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
