import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { SupportTicket } from './support-ticket.entity';
import { Administrator } from './administrator.entity';

@Entity('support_messages')
export class SupportMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  text: string;

  @Column({ default: false })
  isFromSupport: boolean;

  @ManyToOne(() => SupportTicket, (ticket) => ticket.messages, { onDelete: 'CASCADE' })
  ticket: SupportTicket;

  @Column({ nullable: true })
  senderId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'senderId' })
  sender: User;

  @Column({ nullable: true })
  adminId: string;

  @ManyToOne(() => Administrator, { nullable: true })
  @JoinColumn({ name: 'adminId' })
  adminSender: Administrator;

  @CreateDateColumn()
  createdAt: Date;
}
