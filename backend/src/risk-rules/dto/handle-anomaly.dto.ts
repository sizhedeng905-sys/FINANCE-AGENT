import { AnomalyStatus } from '@prisma/client';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const HANDLED_STATUSES = [
  AnomalyStatus.acknowledged,
  AnomalyStatus.resolved,
  AnomalyStatus.accepted_risk,
  AnomalyStatus.false_positive
] as const;

export class HandleAnomalyDto {
  @IsIn(HANDLED_STATUSES)
  status!: (typeof HANDLED_STATUSES)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  reason!: string;
}
