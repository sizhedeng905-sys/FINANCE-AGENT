import { Module } from '@nestjs/common';

import { RecordPolicyService } from './record-policy.service';

@Module({
  providers: [RecordPolicyService],
  exports: [RecordPolicyService]
})
export class RecordPolicyModule {}
