import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AdminRole {
  SUPPORT = 'SUPPORT',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum AdminStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('administrators')
@Index(['email'])
export class Administrator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  hashedPassword: string;

  @Column({
    type: 'enum',
    enum: AdminRole,
    default: AdminRole.SUPPORT,
  })
  role: AdminRole;

  @Column({
    type: 'enum',
    enum: AdminStatus,
    default: AdminStatus.ACTIVE,
  })
  status: AdminStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
