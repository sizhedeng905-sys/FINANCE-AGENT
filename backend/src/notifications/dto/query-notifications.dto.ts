import { UserRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryNotificationsDto {
  // Kept for frontend compatibility. Authorization always uses the token user.
  @IsOptional()
  @IsEnum(UserRole)
  targetRole?: UserRole;

  @IsOptional()
  @Transform(({ obj, key, value }) => {
    const rawValue = (obj as Record<string, unknown>)[key];
    if (rawValue === true || rawValue === 'true') return true;
    if (rawValue === false || rawValue === 'false') return false;
    return rawValue ?? value;
  })
  @IsBoolean()
  read?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
