import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CorrectOcrTaskDto {
  @ApiProperty({ type: [OcrFieldCorrectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OcrFieldCorrectionDto)
  corrections!: OcrFieldCorrectionDto[];
}
