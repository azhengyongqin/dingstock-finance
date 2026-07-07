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

@Entity('bank_transactions')
@Index(['transDatetime'])
@Index(['cardNbr', 'transDatetime'])
@Index(['UID', 'cardNbr', 'transDatetime'])
export class BankTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 兼容迁移前的 _id 访问，降低飞书同步逻辑改动范围。
  get _id() {
    return this.id;
  }

  @Index()
  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount?: BankAccount;

  @Index()
  @Column({ name: 'uid' })
  UID: string;

  @Index()
  @Column({ name: 'card_nbr' })
  cardNbr: string;

  @Column({ name: 'trans_datetime', type: 'timestamptz' })
  transDatetime: Date;

  @Index({ unique: true })
  @Column({ name: 'trans_sequence_idn' })
  transSequenceIdn: string;

  // CMB 字段较多且可能变化，使用 jsonb 保存原始明细，方便后续字段映射调整。
  @Column({ type: 'jsonb' })
  raw: Record<string, unknown>;

  @Column({ name: 'synced_to_bitable_at', type: 'timestamptz', nullable: true })
  syncedToBitableAt?: Date | null;

  @Column({ name: 'bitable_record_id', type: 'varchar', nullable: true })
  bitableRecordId?: string | null;

  @Column({ name: 'bitable_fields_hash', type: 'varchar', nullable: true })
  bitableFieldsHash?: string | null;

  @Column({ name: 'bitable_checked_at', type: 'timestamptz', nullable: true })
  bitableCheckedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export type BankTransactionDocument = BankTransaction;
