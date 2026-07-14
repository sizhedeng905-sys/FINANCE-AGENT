import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

import { RecordValueInputDto } from './record-value-input.dto';

export class UpdateRecordDto {
  @ApiPropertyOptional({ example: '2026-07-10' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'recordDate 必须是 YYYY-MM-DD 格式' })
  @IsDateString({ strict: true })
  recordDate?: string;

  @ApiPropertyOptional({ example: 8800 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  amount?: number;

  @ApiPropertyOptional({ example: '成本' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  category?: string;

  @ApiPropertyOptional({ example: '运输费用模板' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  subCategory?: string;

  @ApiPropertyOptional({ example: '太和运输费用手工补录' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;

  @ApiPropertyOptional({ type: [RecordValueInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecordValueInputDto)
  values?: RecordValueInputDto[];

  @ApiPropertyOptional({ example: ['凭证.pdf'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Transform(({ value }) => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item.trim() : item).filter(Boolean) : value)
  attachments?: string[];
}
