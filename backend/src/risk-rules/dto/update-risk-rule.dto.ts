import { PartialType } from '@nestjs/swagger';

import { CreateRiskRuleDto } from './create-risk-rule.dto';

export class UpdateRiskRuleDto extends PartialType(CreateRiskRuleDto) {}
