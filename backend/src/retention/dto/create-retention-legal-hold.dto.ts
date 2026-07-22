import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { RETENTION_RESOURCE_TYPES, RetentionResourceType } from '../retention.constants';

export class CreateRetentionLegalHoldDto {
  @IsIn(RETENTION_RESOURCE_TYPES)
  resourceType!: RetentionResourceType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  resourceId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
