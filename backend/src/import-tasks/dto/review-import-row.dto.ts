import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class ReviewImportRowDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;

  @ApiProperty({ enum: ['include', 'exclude'] })
  @IsString()
  @IsIn(['include', 'exclude'])
  decision!: 'include' | 'exclude';

  @ApiProperty({ minLength: 2, maxLength: 500 })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  reason!: string;
}
