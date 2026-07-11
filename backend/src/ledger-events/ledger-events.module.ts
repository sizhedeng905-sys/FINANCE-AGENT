import { Module } from '@nestjs/common';

import { LedgerEventsService } from './ledger-events.service';

@Module({
  providers: [LedgerEventsService],
  exports: [LedgerEventsService]
})
export class LedgerEventsModule {}
