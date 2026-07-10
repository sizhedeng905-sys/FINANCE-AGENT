import { ApiPropertyOptional } from '@nestjs/swagger';
import { FieldType, SemanticType } from '@prisma/client';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateFieldDto {
  @ApiPropertyOptional({ example: 'amount' })
  @IsOptional()
  @IsString()
  fieldKey?: string;

  @ApiPropertyOptional({ example: '金额' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fieldName?: string;

  @ApiPropertyOptional({ enum: FieldType })
  @IsOptional()
  @IsEnum(FieldType)
  fieldType?: FieldType;

  @ApiPropertyOptional({ example: '元' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ enum: SemanticType })
  @IsOptional()
  @IsEnum(SemanticType)
  semanticType?: SemanticType;

  @ApiPropertyOptional({ example: ['费用金额', '总金额'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ example: '金额字段定义' })
  @IsOptional()
  @IsString()
  description?: string;
}
