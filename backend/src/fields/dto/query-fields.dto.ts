import { ApiPropertyOptional } from '@nestjs/swagger';
import { FieldType, SemanticType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryFieldsDto extends PaginationDto {
  @ApiPropertyOptional({ example: '金额' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ enum: FieldType })
  @IsOptional()
  @IsEnum(FieldType)
  fieldType?: FieldType;

  @ApiPropertyOptional({ enum: SemanticType })
  @IsOptional()
  @IsEnum(SemanticType)
  semanticType?: SemanticType;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
