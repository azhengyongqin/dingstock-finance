import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BankAccountDocument = HydratedDocument<BankAccount>;

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

  @Prop({ required: true, type: [String], default: [] })
  cardNbr: string[];

  @Prop({ required: true, default: true })
  enabled: boolean;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);
