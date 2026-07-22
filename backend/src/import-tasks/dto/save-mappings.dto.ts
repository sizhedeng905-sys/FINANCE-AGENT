import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

export const IMPORT_AI_REVIEW_DECISIONS = ['accept', 'edit', 'reject', 'ignore'] as const;

export class AiMappingReviewDto {
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

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  sourceRef!: string;

  @ApiProperty({ enum: IMPORT_AI_REVIEW_DECISIONS })
  @IsIn(IMPORT_AI_REVIEW_DECISIONS)
  decision!: typeof IMPORT_AI_REVIEW_DECISIONS[number];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  reason!: string;
}

export class MappingInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  columnId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  targetFieldId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  ignore?: boolean;

  @ApiPropertyOptional({ type: AiMappingReviewDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiMappingReviewDto)
  aiReview?: AiMappingReviewDto;
}

export class SaveMappingsDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;

  @ApiProperty({ type: [MappingInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((item: MappingInputDto) => item.columnId)
  @ValidateNested({ each: true })
  @Type(() => MappingInputDto)
  mappings!: MappingInputDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  saveToProfile?: boolean = true;
}
