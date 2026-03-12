import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Contract } from './contract.entity';
import { Review } from './review.entity';
import { CancellationAudit } from './cancellation-audit.entity';

export enum JobStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  ESCALATED = 'ESCALATED',
  COMPLETED = 'COMPLETED',
}

export enum JobStep {
  ALL_SET = 'ALL_SET',
  MATERIALS_PURCHASED = 'MATERIALS_PURCHASED',
  ON_THE_WAY = 'ON_THE_WAY',
  ARRIVED = 'ARRIVED',
  STARTED = 'STARTED',
  FINISHED = 'FINISHED',
  HOME_SAFE = 'HOME_SAFE',
}

@Entity('jobs')
@Index(['contractId'])
@Index(['status'])
@Index(['createdAt'])
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Contract)
  @JoinColumn({ name: 'contractId' })
  contract: Contract;

  @Column()
  contractId: string;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.ACTIVE,
  })
  status: JobStatus;

  @Column({
    type: 'enum',
    enum: JobStep,
    default: JobStep.ALL_SET,
  })
  currentStep: JobStep;

  @Column({ type: 'varchar', length: 4 })
  arrivalCode: string;

  // Forensic Timestamps (Lawyer-ready evidence)
  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  materialsPurchasedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  onTheWayAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  arrivedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  homeSafeAt: Date;

  @OneToMany(() => Review, (review) => review.job)
  reviews: Review[];

  @OneToOne(() => CancellationAudit, (audit) => audit.job)
  cancellationAudit: CancellationAudit;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
