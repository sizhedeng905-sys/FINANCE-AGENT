import { ApiPropertyOptional } from '@nestjs/swagger';
import { ImportTaskStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryImportTasksDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  projectId?: string;

  @ApiPropertyOptional({ enum: ImportTaskStatus })
  @IsOptional()
  @IsEnum(ImportTaskStatus)
  status?: ImportTaskStatus;
}
