import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ConfirmOcrTaskDto {
  @ApiPropertyOptional({ description: 'Required when low-confidence or missing fields remain.' })
  @IsOptional()
  @IsBoolean()
  acknowledgeLowConfidence?: boolean;
}
