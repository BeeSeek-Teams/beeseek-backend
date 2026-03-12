import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Contract } from './contract.entity';
import { Conversation } from './conversation.entity';

@Entity('messages')
@Index(['conversationId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages)
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column()
  conversationId: string;

  @ManyToOne(() => User)
  sender: User;

  @Column()
  senderId: string;

  @Column()
  content: string;

  @Column({
    type: 'enum',
    enum: ['text', 'image', 'audio', 'service_request', 'service_quote'],
    default: 'text',
  })
  type: string;

  @ManyToOne(() => Contract, { nullable: true })
  @JoinColumn({ name: 'contractId' })
  contract: Contract;

  @Column({ nullable: true })
  contractId: string;

  @Column({ nullable: true })
  mediaUrl: string;

  @Column({
    type: 'enum',
    enum: ['sending', 'sent', 'delivered', 'read'],
    default: 'sent',
  })
  status: string;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
