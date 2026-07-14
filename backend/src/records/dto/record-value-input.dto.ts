import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Allow, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RecordValueInputDto {
  @ApiProperty({ example: 'f-amount' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  fieldId!: string;

  @ApiProperty({ example: 8800 })
  @Allow()
  value!: unknown;
}
