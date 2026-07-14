import { ApiPropertyOptional } from '@nestjs/swagger';
import { ImportRowStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryImportRowsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ImportRowStatus })
  @IsOptional()
  @IsEnum(ImportRowStatus)
  status?: ImportRowStatus;
}
