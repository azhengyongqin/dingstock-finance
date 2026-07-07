import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BankAccount } from './bank-account.entity';

@Entity('bank_transaction_sync_states')
@Index(['bankAccountId', 'cardNbr'], { unique: true })
export class BankTransactionSyncState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 兼容迁移前的 _id 访问，降低同步状态改动范围。
  get _id() {
    return this.id;
  }

  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount?: BankAccount;

  @Column({ name: 'uid' })
  UID: string;

  @Column({ name: 'card_nbr' })
  cardNbr: string;

  // 银行续传断点直接保存原始 Y1 数组，避免因字段变动丢失续传信息。
  @Column({
    name: 'breakpoint_y1',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  breakpointY1: Array<Record<string, string>>;

  @Column({ name: 'last_begin_date', type: 'varchar', nullable: true })
  lastBeginDate?: string | null;

  @Column({ name: 'last_end_date', type: 'varchar', nullable: true })
  lastEndDate?: string | null;

  @Column({ name: 'last_started_at', type: 'timestamptz', nullable: true })
  lastStartedAt?: Date | null;

  @Column({ name: 'last_finished_at', type: 'timestamptz', nullable: true })
  lastFinishedAt?: Date | null;

  @Column({ name: 'last_synced_count', default: 0 })
  lastSyncedCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export type BankTransactionSyncStateDocument = BankTransactionSyncState;
