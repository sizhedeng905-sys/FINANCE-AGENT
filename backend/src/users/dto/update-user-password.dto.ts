import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserPasswordDto {
  @ApiProperty({ example: '654321' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword!: string;
}
