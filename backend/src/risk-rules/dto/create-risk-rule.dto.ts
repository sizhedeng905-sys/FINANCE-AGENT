import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RiskLevel } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const SUPPORTED_RULE_TYPES = [
  'amount_threshold',
  'missing_attachment',
  'duplicate_submission',
  'after_hours',
  'cost_trend'
] as const;

export class CreateRiskRuleDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,127}$/)
  ruleKey!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  ruleName!: string;

  @ApiProperty({ enum: SUPPORTED_RULE_TYPES })
  @IsIn(SUPPORTED_RULE_TYPES)
  ruleType!: (typeof SUPPORTED_RULE_TYPES)[number];

  @ApiPropertyOptional({ default: 'work_order' })
  @IsOptional()
  @IsIn(['work_order'])
  targetType?: 'work_order';

  @ApiProperty({ enum: RiskLevel })
  @IsEnum(RiskLevel)
  severity!: RiskLevel;

  @ApiProperty({ type: Object })
  @IsObject()
  conditionJson!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
