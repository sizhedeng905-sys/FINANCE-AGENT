import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'finance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  username!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
