import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BankAccountDocument = HydratedDocument<BankAccount>;

@Schema({ _id: false })
export class BankAccountCard {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  cardNbr: string;
}

export const BankAccountCardSchema =
  SchemaFactory.createForClass(BankAccountCard);

@Schema({ timestamps: true, collection: 'bank_accounts' })
export class BankAccount {
  @Prop({ required: true, unique: true, trim: true })
  UID: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ required: true })
  smPrivateKey: string;

  @Prop({ required: true })
  smPublicKey: string;

  @Prop({ required: true })
  smSymKey: string;

  @Prop({ required: true, type: [BankAccountCardSchema], default: [] })
  cards: BankAccountCard[];

  @Prop({ required: true, default: true })
  enabled: boolean;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);

// 银行卡号不应被配置到多个网银账户中，避免定时任务重复拉取同一卡交易。
BankAccountSchema.index({ 'cards.cardNbr': 1 }, { unique: true, sparse: true });
