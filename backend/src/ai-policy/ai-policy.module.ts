import { Global, Module } from '@nestjs/common';

import { AiFeaturePolicyService } from './ai-feature-policy.service';

@Global()
@Module({
  providers: [AiFeaturePolicyService],
  exports: [AiFeaturePolicyService]
})
export class AiPolicyModule {}
