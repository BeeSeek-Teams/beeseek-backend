import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { IncidentUpdate } from './incident-update.entity';

export enum IncidentStatus {
  RESOLVED = 'Resolved',
  INVESTIGATING = 'Investigating',
  IDENTIFIED = 'Identified',
  MONITORING = 'Monitoring',
}

export enum IncidentSeverity {
  CRITICAL = 'Critical',
  MAJOR = 'Major',
  MINOR = 'Minor',
}

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    default: IncidentStatus.INVESTIGATING,
  })
  status: IncidentStatus;

  @Column({
    type: 'enum',
    enum: IncidentSeverity,
    default: IncidentSeverity.MAJOR,
  })
  severity: IncidentSeverity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => IncidentUpdate, (update) => update.incident, { cascade: true })
  updates: IncidentUpdate[];
}
