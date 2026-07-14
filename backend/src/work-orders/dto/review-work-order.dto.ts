import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class FinanceReviewDto {
  @ApiProperty({ enum: ['approve', 'reject', 'supplement'] })
  @IsIn(['approve', 'reject', 'supplement'])
  action!: 'approve' | 'reject' | 'supplement';

  @ApiPropertyOptional()
  @ValidateIf((dto: FinanceReviewDto) => dto.action !== 'approve' || dto.comment !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  comment?: string;
}

export class ReviewerReviewDto {
  @ApiProperty({ enum: ['approve', 'reject_to_finance', 'supplement'] })
  @IsIn(['approve', 'reject_to_finance', 'supplement'])
  action!: 'approve' | 'reject_to_finance' | 'supplement';

  @ApiPropertyOptional()
  @ValidateIf((dto: ReviewerReviewDto) => dto.action !== 'approve' || dto.comment !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  comment?: string;
}

export class BossApproveDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional()
  @ValidateIf((dto: BossApproveDto) => dto.action === 'reject' || dto.comment !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  comment?: string;
}

export class UrgeWorkOrderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  reason!: string;
}
