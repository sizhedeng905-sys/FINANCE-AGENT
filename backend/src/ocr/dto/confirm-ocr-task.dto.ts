import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Min
} from 'class-validator';

export class ConfirmOcrTaskDto {
  @ApiProperty({ minimum: 1, description: 'Optimistic task version returned by the latest revalidation.' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minimum: 0, description: 'Finance review revision covered by the validation snapshot.' })
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  expectedValidationSnapshotHash!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  expectedPayloadHash!: string;

  @ApiProperty({
    type: [String],
    maxItems: 100,
    description: 'Exact warning IDs shown in the current deterministic validation snapshot.'
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^warning:[0-9a-f]{64}$/, { each: true })
  acknowledgedWarningIds!: string[];
}
