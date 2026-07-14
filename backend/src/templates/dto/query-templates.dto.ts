import { ApiPropertyOptional } from '@nestjs/swagger';
import { DataRecordType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryTemplatesDto extends PaginationDto {
  @ApiPropertyOptional({ example: '运输' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  keyword?: string;

  @ApiPropertyOptional({ enum: DataRecordType })
  @IsOptional()
  @IsEnum(DataRecordType)
  recordType?: DataRecordType;
}
