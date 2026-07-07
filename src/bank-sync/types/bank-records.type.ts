import type {
  BankAccount,
  BankAccountCard,
  BankTransaction,
  BankTransactionSyncState,
  Prisma,
} from '@prisma/client';

export type BankAccountWithCards = BankAccount & {
  cards: BankAccountCard[];
};

export type BankAccountDocument = BankAccountWithCards;
export type BankTransactionDocument = BankTransaction;

export type BankTransactionSyncStateDocument = BankTransactionSyncState & {
  breakpointY1: Array<Record<string, string>>;
};

export type BankTransactionRaw = Prisma.InputJsonObject;
