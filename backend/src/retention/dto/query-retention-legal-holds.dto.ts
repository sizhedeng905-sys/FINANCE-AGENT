import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { RETENTION_RESOURCE_TYPES, RetentionResourceType } from '../retention.constants';

export class QueryRetentionLegalHoldsDto {
  @IsOptional()
  @IsIn(RETENTION_RESOURCE_TYPES)
  resourceType?: RetentionResourceType;

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
