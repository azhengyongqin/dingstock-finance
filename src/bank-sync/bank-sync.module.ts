import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CmbModule } from '../cmb/cmb.module';
import { BankTransactionSyncService } from './bank-transaction-sync.service';
import { BitableSyncService } from './bitable-sync.service';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';
import {
  BankTransaction,
  BankTransactionSchema,
} from './schemas/bank-transaction.schema';
import {
  BankTransactionSyncState,
  BankTransactionSyncStateSchema,
} from './schemas/bank-transaction-sync-state.schema';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';

@Module({
  imports: [
    CmbModule,
    MongooseModule.forFeature([
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: BankTransaction.name, schema: BankTransactionSchema },
      {
        name: BankTransactionSyncState.name,
        schema: BankTransactionSyncStateSchema,
      },
    ]),
  ],
  controllers: [BankAccountController],
  providers: [
    BankAccountService,
    BankTransactionSyncService,
    BitableSyncService,
  ],
})
export class BankSyncModule {}
