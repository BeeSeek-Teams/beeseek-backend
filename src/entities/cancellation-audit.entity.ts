import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Job } from './job.entity';
import { User } from './user.entity';

@Entity('cancellation_audits')
export class CancellationAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Job, (job) => job.cancellationAudit)
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column()
  jobId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'cancelledById' })
  cancelledBy: User;

  @Column()
  cancelledById: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ nullable: true })
  category: string; // e.g., 'TIME_ISSUE', 'FEE_DISPUTE', 'EMERGENCY', 'NO_SHOW'

  @Column({ default: false })
  isAgentInfraction: boolean;

  @Column({ type: 'bigint', default: 0, comment: 'Amount in Kobo' })
  refundedAmount: number;

  @Column({ type: 'bigint', default: 0, comment: 'Amount in Kobo' })
  agentRetention: number; // For example, the ₦300 fee (30000 Kobo)

  @CreateDateColumn()
  createdAt: Date;
}
