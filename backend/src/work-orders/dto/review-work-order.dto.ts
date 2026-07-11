import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class FinanceReviewDto {
  @ApiProperty({ enum: ['approve', 'reject', 'supplement'] })
  @IsIn(['approve', 'reject', 'supplement'])
  action!: 'approve' | 'reject' | 'supplement';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ReviewerReviewDto {
  @ApiProperty({ enum: ['approve', 'reject_to_finance', 'supplement'] })
  @IsIn(['approve', 'reject_to_finance', 'supplement'])
  action!: 'approve' | 'reject_to_finance' | 'supplement';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class BossApproveDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class UrgeWorkOrderDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
