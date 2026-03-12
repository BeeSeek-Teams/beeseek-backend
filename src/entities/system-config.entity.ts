import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('system_configs')
export class SystemConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: '1.0.0' })
  clientVersion: string;

  @Column({ default: '1.0.0' })
  clientMinVersion: string;

  @Column({ default: '1.0.0' })
  agentVersion: string;

  @Column({ default: '1.0.0' })
  agentMinVersion: string;

  @Column({ nullable: true })
  clientIosUrl: string;

  @Column({ nullable: true })
  clientAndroidUrl: string;

  @Column({ nullable: true })
  agentIosUrl: string;

  @Column({ nullable: true })
  agentAndroidUrl: string;

  @Column({ type: 'text', nullable: true })
  updateMessage: string;

  @Column({ default: false })
  maintenanceMode: string; // Storing as string to handle specific messages if needed, or boolean

  @UpdateDateColumn()
  updatedAt: Date;
}
