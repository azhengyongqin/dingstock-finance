import { Module } from '@nestjs/common';
import { CmbModule } from '../cmb/cmb.module';
import { BankTransactionSyncService } from './bank-transaction-sync.service';
import { BitableSyncService } from './bitable-sync.service';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';

@Module({
  imports: [CmbModule],
  controllers: [BankAccountController],
  providers: [
    BankAccountService,
    BankTransactionSyncService,
    BitableSyncService,
  ],
})
export class BankSyncModule {}
