import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Bee } from './bee.entity';
import { Job } from './job.entity';

export enum ContractStatus {
  PENDING = 'PENDING', // Client sent request
  ACCEPTED = 'ACCEPTED', // Agent accepted and sent quote
  REJECTED = 'REJECTED', // Agent rejected
  PAID = 'PAID', // Client paid (future)
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ServiceType {
  TASK = 'TASK',
  INSPECTION = 'INSPECTION',
}

@Entity('contracts')
@Index(['clientId'])
@Index(['agentId'])
@Index(['status'])
@Index(['agentId', 'workDate', 'status'])
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'clientId' })
  client: User;

  @Column()
  clientId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'agentId' })
  agent: User;

  @Column()
  agentId: string;

  @ManyToOne(() => Bee)
  @JoinColumn({ name: 'beeId' })
  bee: Bee;

  @Column()
  beeId: string;

  @OneToOne(() => Job, (job) => job.contract)
  job: Job;

  @Column({
    type: 'enum',
    enum: ServiceType,
    default: ServiceType.TASK,
  })
  type: ServiceType;

  @Column({ type: 'text' })
  details: string;

  @Column({ type: 'date' })
  workDate: string;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number;

  @Column({ type: 'double precision', nullable: true })
  longitude: number;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({
    type: 'enum',
    enum: ContractStatus,
    default: ContractStatus.PENDING,
  })
  status: ContractStatus;

  // Quote details (filled by Agent when accepting) stored in Kobo (bigint)
  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  workmanshipCost: number;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  transportFare: number;

  @Column({ type: 'jsonb', nullable: true })
  materials: { item: string; cost: number }[];

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  totalCost: number;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  serviceFee: number; // Client-side platform fee

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  commissionRate: number; // e.g., 0.05 for 5%

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  commissionAmount: number; // Amount deducted from workmanship

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
