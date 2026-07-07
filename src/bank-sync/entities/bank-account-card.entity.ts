import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BankAccount } from './bank-account.entity';

@Entity('bank_account_cards')
export class BankAccountCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, (account) => account.cards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bank_account_id' })
  account: BankAccount;

  @Column()
  name: string;

  // 银行卡号不应被配置到多个网银账户中，避免定时任务重复拉取同一卡交易。
  @Index({ unique: true })
  @Column({ name: 'card_nbr' })
  cardNbr: string;
}
