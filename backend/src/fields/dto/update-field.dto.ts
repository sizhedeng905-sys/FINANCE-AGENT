import { ApiPropertyOptional } from '@nestjs/swagger';
import { FieldType, SemanticType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFieldDto {
  @ApiPropertyOptional({ example: 'amount' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  fieldKey?: string;

  @ApiPropertyOptional({ example: '金额' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  fieldName?: string;

  @ApiPropertyOptional({ enum: FieldType })
  @IsOptional()
  @IsEnum(FieldType)
  fieldType?: FieldType;

  @ApiPropertyOptional({ example: '元' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  unit?: string;

  @ApiPropertyOptional({ enum: SemanticType })
  @IsOptional()
  @IsEnum(SemanticType)
  semanticType?: SemanticType;

  @ApiPropertyOptional({ example: ['费用金额', '总金额'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(({ value }) => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item.trim() : item).filter(Boolean) : value)
  aliases?: string[];

  @ApiPropertyOptional({ example: '金额字段定义' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;
}
