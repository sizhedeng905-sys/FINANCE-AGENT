import { ApiProperty } from '@nestjs/swagger';
import { DataRecordType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateImportTaskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  projectId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  templateId!: string;

  @ApiProperty({ enum: DataRecordType })
  @IsEnum(DataRecordType)
  importType!: DataRecordType;
}
