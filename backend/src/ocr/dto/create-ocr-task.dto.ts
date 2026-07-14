import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { MockOcrScenario } from '../ocr-provider';

const MOCK_SCENARIOS: MockOcrScenario[] = ['normal', 'low_confidence', 'missing_field', 'failure', 'failure_once'];

export class CreateOcrTaskDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  rawFileId!: string;

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
}
