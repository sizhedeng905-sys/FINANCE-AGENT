import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class StepUpDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}
