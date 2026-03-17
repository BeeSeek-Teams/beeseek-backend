import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Job } from './job.entity';

export enum FraudAction {
  BLOCKED = 'BLOCKED',
  FLAGGED = 'FLAGGED',
}

@Entity('fraud_logs')
export class FraudLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  jobId: string;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Index()
  @Column()
  attemptedById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'attemptedById' })
  attemptedBy: User;

  @Index()
  @Column()
  targetUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'targetUserId' })
  targetUser: User;

  @Column({
    type: 'enum',
    enum: FraudAction,
  })
  action: FraudAction;

  @Column()
  reason: string;

  @Column({ nullable: true })
  attemptedRole: 'CLIENT' | 'AGENT';

  @Column({ type: 'int', nullable: true })
  attemptedRating: number;

  @Column({ type: 'text', nullable: true })
  attemptedComment: string;

  @Column({ nullable: true })
  reviewId: string;

  @CreateDateColumn()
  createdAt: Date;
}
