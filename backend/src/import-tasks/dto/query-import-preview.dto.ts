import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryImportPreviewDto extends PaginationDto {
  @ApiPropertyOptional({ example: 1, default: 1, maximum: 50_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50_000)
  declare page?: number;
}
