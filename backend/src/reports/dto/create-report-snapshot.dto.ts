import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ReportSnapshotType } from '@prisma/client';

const REPORT_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class CreateReportSnapshotDto {
  @IsEnum(ReportSnapshotType)
  reportType!: ReportSnapshotType;

  @IsOptional()
  @Matches(REPORT_DATE_PATTERN)
  date?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  projectIds?: string[];
}
