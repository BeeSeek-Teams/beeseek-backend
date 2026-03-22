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

export enum SosStatus {
  SENT = 'SENT',
  CANCELLED = 'CANCELLED',
  RESOLVED = 'RESOLVED',
}

@Entity('sos_alerts')
export class SosAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lat: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lng: number;

  @Column({ nullable: true })
  address: string;

  @Column({ type: 'int' })
  batteryLevel: number;

  @Column({ nullable: true })
  contactPhone: string;

  @Column({ nullable: true })
  contactName: string;

  @Column({
    type: 'enum',
    enum: SosStatus,
    default: SosStatus.SENT,
  })
  status: SosStatus;

  @Column({ default: 'device' })
  channel: string; // 'device' = sent via user SMS, 'server' = sent via Termii

  @Column({ nullable: true })
  resolvedById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedById' })
  resolvedBy: User;

  @Column({ type: 'text', nullable: true })
  adminNote: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;
}
