import { RetentionDataClass } from '@prisma/client';
import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateRetentionRunDto {
  @IsEnum(RetentionDataClass)
  dataClass!: RetentionDataClass;

  @IsDateString({ strict: true })
  cutoffAt!: string;

  @IsBoolean()
  @Equals(true)
  dryRun!: true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  batchSize?: number;
}
