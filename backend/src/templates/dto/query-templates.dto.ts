import { ApiPropertyOptional } from '@nestjs/swagger';
import { DataRecordType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryTemplatesDto extends PaginationDto {
  @ApiPropertyOptional({ example: '运输' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ enum: DataRecordType })
  @IsOptional()
  @IsEnum(DataRecordType)
  recordType?: DataRecordType;
}
