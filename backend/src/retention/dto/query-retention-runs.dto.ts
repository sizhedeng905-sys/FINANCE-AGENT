import { RetentionDataClass, RetentionRunStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryRetentionRunsDto {
  @IsOptional()
  @IsEnum(RetentionDataClass)
  dataClass?: RetentionDataClass;

  @IsOptional()
  @IsEnum(RetentionRunStatus)
  status?: RetentionRunStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
