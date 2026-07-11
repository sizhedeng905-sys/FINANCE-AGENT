import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min
} from 'class-validator';

export class CreateWorkOrderDto {
  @ApiProperty({ enum: WorkOrderType })
  @IsEnum(WorkOrderType)
  type!: WorkOrderType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ example: '2026-07-11' })
  @IsDateString()
  occurredDate!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  attachments?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  extraValues?: Record<string, unknown>;
}
