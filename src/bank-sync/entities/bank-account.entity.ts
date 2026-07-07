import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BankAccountCard } from './bank-account-card.entity';

@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 兼容迁移前的 _id 访问，降低业务层改动范围。
  get _id() {
    return this.id;
  }

  @Index({ unique: true })
  @Column({ name: 'uid' })
  UID: string;

  @Column({ type: 'varchar', nullable: true })
  name?: string;

  @Column({ name: 'sm_private_key', type: 'text' })
  smPrivateKey: string;

  @Column({ name: 'sm_public_key', type: 'text' })
  smPublicKey: string;

  @Column({ name: 'sm_sym_key', type: 'text' })
  smSymKey: string;

  @OneToMany(() => BankAccountCard, (card) => card.account, {
    cascade: true,
    eager: true,
    orphanedRowAction: 'delete',
  })
  cards: BankAccountCard[];

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export type BankAccountDocument = BankAccount;
