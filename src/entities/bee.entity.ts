import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('bees')
export class Bee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  category: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ default: false })
  offersInspection: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  inspectionPrice: number | null;

  @Column({ type: 'text', nullable: true })
  locationAddress: string;

  @Index()
  @Column({ type: 'double precision' })
  latitude: number;

  @Index()
  @Column({ type: 'double precision' })
  longitude: number;

  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location: string;

  @Column({ nullable: true })
  workHours: string;

  @Column({ type: 'simple-array', nullable: true })
  images: string[];

  @Column({ type: 'text', nullable: true })
  clientRequirements: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  totalViews: number;

  @Column({ type: 'int', default: 0 })
  totalHires: number;

  @Column({ type: 'int', default: 0 })
  jobsCompleted: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalRevenue: number;

  @Column({ type: 'float', default: 0 })
  rating: number;

  @ManyToOne(() => User, (user) => user.bees, { onDelete: 'CASCADE' })
  agent: User;

  @Column()
  agentId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
