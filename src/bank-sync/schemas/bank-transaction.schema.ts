import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BankTransactionDocument = HydratedDocument<BankTransaction>;

@Schema({ timestamps: true, collection: 'bank_transactions' })
export class BankTransaction {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: 'BankAccount',
    index: true, // 添加单字段索引
  })
  bankAccountId: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  UID: string;

  @Prop({ required: true, trim: true, index: true })
  cardNbr: string;

  @Prop({ required: true, type: Date })
  transDatetime: Date;

  @Prop({ required: true, trim: true, index: true, unique: true })
  transSequenceIdn: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  raw: Record<string, unknown>;
}

export const BankTransactionSchema =
  SchemaFactory.createForClass(BankTransaction);

BankTransactionSchema.index({ transDatetime: -1 });
BankTransactionSchema.index({ cardNbr: 1, transDatetime: -1 });
BankTransactionSchema.index({ UID: 1, cardNbr: 1, transDatetime: -1 });
