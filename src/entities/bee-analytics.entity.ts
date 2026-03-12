import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { Bee } from './bee.entity';

export enum BeeAnalyticsEventType {
  VIEW = 'VIEW',
  HIRE = 'HIRE',
  COMPLETION = 'COMPLETION',
  CANCELLATION = 'CANCELLATION',
}

@Entity('bee_analytics')
@Index(['beeId', 'type', 'createdAt'])
export class BeeAnalytics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  beeId: string;

  @ManyToOne(() => Bee, { onDelete: 'CASCADE' })
  bee: Bee;

  @Column({ nullable: true })
  userId: string;

  @Column({
    type: 'enum',
    enum: BeeAnalyticsEventType,
  })
  type: BeeAnalyticsEventType;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt: Date;
}
