import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum UserStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
}

@Entity('user_presence')
export class UserPresence {
  @PrimaryColumn('uuid')
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.OFFLINE,
  })
  @Index()
  status: UserStatus;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  lastSeenAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
