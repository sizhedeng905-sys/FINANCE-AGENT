import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength
} from 'class-validator';

export class CreateWorkOrderDto {
  @ApiProperty({ enum: WorkOrderType })
  @IsEnum(WorkOrderType)
  type!: WorkOrderType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  projectId!: string;

  @ApiPropertyOptional({ example: '8800.00', type: String })
  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, {
    message: 'amount 必须是最多两位小数的非负十进制字符串'
  })
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;

  @ApiPropertyOptional({ example: '2026-07-11' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'occurredDate 必须是 YYYY-MM-DD 格式' })
  @IsDateString({ strict: true })
  occurredDate?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(({ value }) => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item.trim() : item).filter(Boolean) : value)
  attachments?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  extraValues?: Record<string, unknown>;
}
