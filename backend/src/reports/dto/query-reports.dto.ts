import { IsIn, IsOptional, Matches } from 'class-validator';

const REPORT_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class QueryFinanceReportDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month' = 'today';

  @IsOptional()
  @Matches(REPORT_DATE_PATTERN)
  date?: string;
}

export class QueryBossReportDto {
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly' = 'daily';

  @IsOptional()
  @Matches(REPORT_DATE_PATTERN)
  date?: string;
}

export class QueryDailyReportDto {
  @IsOptional()
  @Matches(REPORT_DATE_PATTERN)
  date?: string;
}

export class QueryMonthlyReportDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class QueryRankingReportDto {
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly' = 'monthly';

  @IsOptional()
  @Matches(REPORT_DATE_PATTERN)
  date?: string;

  @IsIn(['project', 'customer'])
  groupBy!: 'project' | 'customer';

  @IsIn(['highest', 'lowest'])
  direction!: 'highest' | 'lowest';

  @IsOptional()
  @IsIn(['income', 'expense', 'profit'])
  metric?: 'income' | 'expense' | 'profit' = 'profit';
}
