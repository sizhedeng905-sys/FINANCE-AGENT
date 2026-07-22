import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { STEP_UP_ACTIONS, StepUpAction } from '../../step-up/step-up-actions';

export class StepUpDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ enum: STEP_UP_ACTIONS })
  @IsIn(STEP_UP_ACTIONS)
  action!: StepUpAction;

  @ApiProperty({ example: 'user' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  resourceType!: string;

  @ApiProperty({ example: 'user-id' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/)
  resourceId!: string;
}
