import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Message } from './message.entity';

@Entity('conversations')
@Index(['participant1Id', 'participant2Id'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'participant1Id' })
  participant1: User;

  @Column()
  participant1Id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'participant2Id' })
  participant2: User;

  @Column()
  participant2Id: string;

  @Column({ nullable: true })
  lastMessageText: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastMessageAt: Date;

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ default: 0 })
  unreadCountP1: number;

  @Column({ default: 0 })
  unreadCountP2: number;
}
