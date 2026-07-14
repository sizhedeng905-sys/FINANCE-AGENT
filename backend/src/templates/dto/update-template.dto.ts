import { ApiPropertyOptional } from '@nestjs/swagger';
import { AccountingDirection, DataRecordType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTemplateDto {
  @ApiPropertyOptional({ example: '运输费用模板' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @ApiPropertyOptional({ enum: DataRecordType })
  @IsOptional()
  @IsEnum(DataRecordType)
  recordType?: DataRecordType;

  @ApiPropertyOptional({ enum: AccountingDirection })
  @IsOptional()
  @IsEnum(AccountingDirection)
  accountingDirection?: AccountingDirection;

  @ApiPropertyOptional({ description: '模板字段关系中的 money 字段 ID' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  primaryAmountFieldId?: string;

  @ApiPropertyOptional({ description: '模板字段关系中的 date 字段 ID' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  primaryDateFieldId?: string;

  @ApiPropertyOptional({ example: '记录车辆、司机、线路和运输成本。' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;
}
