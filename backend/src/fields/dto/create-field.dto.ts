import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldType, SemanticType } from '@prisma/client';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFieldDto {
  @ApiPropertyOptional({ example: 'amount' })
  @IsOptional()
  @IsString()
  fieldKey?: string;

  @ApiProperty({ example: '金额' })
  @IsString()
  @IsNotEmpty()
  fieldName!: string;

  @ApiProperty({ enum: FieldType, example: FieldType.money })
  @IsEnum(FieldType)
  fieldType!: FieldType;

  @ApiPropertyOptional({ example: '元' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ enum: SemanticType, example: SemanticType.amount })
  @IsEnum(SemanticType)
  semanticType!: SemanticType;

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
