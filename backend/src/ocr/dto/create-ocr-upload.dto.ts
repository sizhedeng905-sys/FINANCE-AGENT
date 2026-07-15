import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { MockOcrScenario } from '../ocr-provider';

const MOCK_SCENARIOS: MockOcrScenario[] = [
  'normal',
  'low_confidence',
  'missing_field',
  'failure',
  'failure_once'
];

export class CreateOcrUploadDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  projectId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  templateId!: string;

  @ApiPropertyOptional({ enum: MOCK_SCENARIOS })
  @IsOptional()
  @IsIn(MOCK_SCENARIOS)
  mockScenario?: MockOcrScenario;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  pageStart?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  pageEnd?: number;
}
