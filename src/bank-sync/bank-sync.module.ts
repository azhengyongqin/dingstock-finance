import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmbModule } from '../cmb/cmb.module';
import { BankTransactionSyncService } from './bank-transaction-sync.service';
import { BitableSyncService } from './bitable-sync.service';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';
import { BankAccount } from './entities/bank-account.entity';
import { BankAccountCard } from './entities/bank-account-card.entity';
import { BankTransaction } from './entities/bank-transaction.entity';
import { BankTransactionSyncState } from './entities/bank-transaction-sync-state.entity';

@Module({
  imports: [
    CmbModule,
    TypeOrmModule.forFeature([
      BankAccount,
      BankAccountCard,
      BankTransaction,
      BankTransactionSyncState,
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
