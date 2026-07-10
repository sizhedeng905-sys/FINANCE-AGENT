import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdateUserPasswordDto {
  @ApiProperty({ example: '654321' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}
