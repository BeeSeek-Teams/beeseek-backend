import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Incident } from './incident.entity';

@Entity('incident_updates')
export class IncidentUpdate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column()
  incidentId: string;

  @ManyToOne(() => Incident, (incident) => incident.updates)
  @JoinColumn({ name: 'incidentId' })
  incident: Incident;
}
