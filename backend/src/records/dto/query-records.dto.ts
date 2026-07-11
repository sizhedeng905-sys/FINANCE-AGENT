import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessRecordStatus, DataRecordType, RecordSourceType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryRecordsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'dp-001' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ example: 'dt-transport' })
  @IsOptional()
  @IsString()
  templateId?: string;

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
