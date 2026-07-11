import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';

export class QueryFinanceReportDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month' = 'today';
}

export class QueryBossReportDto {
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly' = 'daily';
}

export class QueryDailyReportDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class QueryMonthlyReportDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}
