import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsString, Length, Matches, Min } from 'class-validator';
import { ReportNarrativeReviewCommand } from '@prisma/client';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class ReviewReportNarrativeDto {
  @IsInt()
  @Min(0)
  expectedReviewVersion!: number;

  @Matches(SHA256_PATTERN)
  expectedNarrativeHash!: string;

  @Matches(SHA256_PATTERN)
  expectedSnapshotHash!: string;

  @IsEnum(ReportNarrativeReviewCommand)
  command!: ReportNarrativeReviewCommand;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(2, 500)
  @Matches(/^[^\u0000-\u001f\u007f]+$/)
  reason!: string;
}
