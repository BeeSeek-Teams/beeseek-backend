import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { Administrator } from './administrator.entity';

export enum FundingRequestStatus {
  PENDING = 'Pending',
  PAID = 'Paid',
  REJECTED = 'Rejected',
}

@Entity('funding_requests')
@Index(['status'])
@Index(['createdAt'])
export class FundingRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: FundingRequestStatus,
    default: FundingRequestStatus.PENDING,
  })
  status: FundingRequestStatus;

  @ManyToOne(() => Administrator, { nullable: true, onDelete: 'SET NULL' })
  createdBy: Administrator | null;

  @Column({ type: 'varchar', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
