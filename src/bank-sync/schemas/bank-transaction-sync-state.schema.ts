import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BankTransactionSyncStateDocument =
  HydratedDocument<BankTransactionSyncState>;

@Schema({ timestamps: true, collection: 'bank_transaction_sync_states' })
export class BankTransactionSyncState {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: 'BankAccount',
  })
  bankAccountId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  UID: string;

  @Prop({ required: true, trim: true })
  cardNbr: string;

  @Prop({ required: true, default: [] })
  breakpointY1: Array<Record<string, string>>;

  @Prop({ trim: true })
  lastBeginDate?: string;

  @Prop({ trim: true })
  lastEndDate?: string;

  @Prop()
  lastStartedAt?: Date;

  @Prop()
  lastFinishedAt?: Date;

  @Prop({ default: 0 })
  lastSyncedCount: number;

  @Prop({ trim: true })
  lastError?: string;
}

export const BankTransactionSyncStateSchema = SchemaFactory.createForClass(
  BankTransactionSyncState,
);

BankTransactionSyncStateSchema.index(
  { bankAccountId: 1, cardNbr: 1 },
  { unique: true },
);
