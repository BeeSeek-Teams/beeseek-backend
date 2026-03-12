import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum TransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
  LOCKED = 'LOCKED', // Funds moved to locked balance
  ESCROW = 'ESCROW', // Funds held by platform
  REVENUE = 'REVENUE', // Platform revenue (fees/commissions)
}

@Entity('transactions')
@Index(['userId'])
@Index(['contractId'])
@Index(['createdAt'])
@Index(['userId', 'type', 'status'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: true })
  user: User | null;

  @Column({ type: 'varchar', nullable: true })
  userId: string | null;

  @Column({
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  amount: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'varchar', nullable: true })
  monnifyReference: string | null;

  @Column({ type: 'varchar', nullable: true })
  contractId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ type: 'varchar', nullable: true })
  idempotencyKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
