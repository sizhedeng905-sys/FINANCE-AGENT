import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountingDirection, DataRecordType, RecordDataLayer } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty({ example: '运输费用模板' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;

  @ApiProperty({ enum: DataRecordType, example: DataRecordType.transport })
  @IsEnum(DataRecordType)
  recordType!: DataRecordType;

  @ApiPropertyOptional({ enum: AccountingDirection, description: '由模板固定的会计方向；不接受记录请求覆盖' })
  @IsOptional()
  @IsEnum(AccountingDirection)
  accountingDirection?: AccountingDirection;

  @ApiPropertyOptional({ enum: RecordDataLayer, description: 'actual 进入经营报表；reconciliation/budget 仅用于对账或预算' })
  @IsOptional()
  @IsEnum(RecordDataLayer)
  dataLayer?: RecordDataLayer;

  @ApiPropertyOptional({ example: '记录车辆、司机、线路和运输成本。' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;
}
