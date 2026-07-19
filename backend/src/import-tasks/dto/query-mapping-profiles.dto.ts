import { ApiPropertyOptional } from '@nestjs/swagger';
import { MappingProfileStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../data-center/pagination.dto';

export class QueryMappingProfilesDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  templateId?: string;

  @ApiPropertyOptional({ enum: MappingProfileStatus })
  @IsOptional()
  @IsEnum(MappingProfileStatus)
  status?: MappingProfileStatus;
}
