import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RevalidateOcrTaskDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;
}
