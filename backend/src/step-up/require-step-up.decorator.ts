import { SetMetadata } from '@nestjs/common';

import { StepUpAction, StepUpResourceType } from './step-up-actions';

export const STEP_UP_REQUIREMENT_KEY = 'step_up_requirement';

export interface StepUpRequirement {
  action: StepUpAction;
  resourceType: StepUpResourceType;
  resourceParam?: string;
  resourceBodyFields?: string[];
  staticResourceId?: string;
  whenBodyFieldPresent?: string;
}

export const RequireStepUp = (requirement: StepUpRequirement) => (
  SetMetadata(STEP_UP_REQUIREMENT_KEY, requirement)
);
