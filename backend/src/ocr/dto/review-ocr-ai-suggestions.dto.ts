import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';

export const OCR_AI_REVIEW_DECISIONS = ['accept', 'edit', 'reject', 'ignore'] as const;

export class OcrAiFieldReviewDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^candidate:[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,180}$/)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  sourceRef!: string;

  @ApiProperty({ enum: OCR_AI_REVIEW_DECISIONS })
  @IsIn(OCR_AI_REVIEW_DECISIONS)
  decision!: typeof OCR_AI_REVIEW_DECISIONS[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  finalTargetFieldId?: string;

  @ApiPropertyOptional({ description: 'Required only for an edit decision' })
  @IsOptional()
  finalValue?: unknown;

  @ApiPropertyOptional({ type: [String], maxItems: 32 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,255}$/, { each: true })
  evidenceRefs?: string[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(500)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  reason!: string;
}

export class ReviewOcrAiSuggestionsDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  aiTaskId!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  outputHash!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  versionVectorHash!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  reviewStateHash!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  reviewBasisHash!: string;

  @ApiProperty({ type: [OcrAiFieldReviewDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((item: OcrAiFieldReviewDto) => item.sourceRef)
  @ValidateNested({ each: true })
  @Type(() => OcrAiFieldReviewDto)
  reviews!: OcrAiFieldReviewDto[];
}
