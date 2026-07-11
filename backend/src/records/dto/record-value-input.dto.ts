import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsString } from 'class-validator';

export class RecordValueInputDto {
  @ApiProperty({ example: 'f-amount' })
  @IsString()
  fieldId!: string;

  @ApiProperty({ example: 8800 })
  @Allow()
  value!: unknown;
}
