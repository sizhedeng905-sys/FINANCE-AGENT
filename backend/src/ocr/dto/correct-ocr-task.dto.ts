import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';

export class OcrFieldCorrectionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  fieldId!: string;

  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'array', items: { type: 'string' } }] })
  @IsDefined()
  correctedValue!: unknown;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 32 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,255}$/, { each: true })
  evidenceRefs?: string[];
}

export class CorrectOcrTaskDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedReviewRevision?: number;

  @ApiProperty({ type: [OcrFieldCorrectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OcrFieldCorrectionDto)
  corrections!: OcrFieldCorrectionDto[];
}
