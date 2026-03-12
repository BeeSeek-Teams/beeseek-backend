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

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  jobId: string;

  @ManyToOne(() => Job)
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Index()
  @Column()
  reviewerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reviewerId' })
  reviewer: User;

  @Index()
  @Column()
  revieweeId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'revieweeId' })
  reviewee: User;

  @Column({ type: 'int' })
  rating: number; // 1-5

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column()
  reviewerRole: 'CLIENT' | 'AGENT';

  @Column({ default: false })
  isVerifiedTransaction: boolean;

  @Column({ default: false })
  isFlagged: boolean;

  @Column({ type: 'text', nullable: true })
  flagReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
