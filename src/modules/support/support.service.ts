import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket, TicketStatus } from '../../entities/support-ticket.entity';
import { SupportMessage } from '../../entities/support-message.entity';
import { SupportGateway } from './support.gateway';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepository: Repository<SupportTicket>,
    @InjectRepository(SupportMessage)
    private readonly messageRepository: Repository<SupportMessage>,
    @Inject(forwardRef(() => SupportGateway))
    private readonly supportGateway: SupportGateway,
  ) {}

  async createTicket(userId: string, subject: string, description: string, evidence?: string[]): Promise<SupportTicket> {
    const ticket = this.ticketRepository.create({
      userId,
      subject,
      description,
      status: TicketStatus.OPEN,
      evidence: evidence || [],
    });
    
    const savedTicket = await this.ticketRepository.save(ticket);

    // Create initial message from user's description
    await this.addMessage(savedTicket.id, userId, description, false);

    this.logger.log(`New support ticket created by user ${userId}: ${subject}`);
    return savedTicket;
  }

  async getUserTickets(userId: string, page: number = 1, limit: number = 20) {
    const [items, total] = await this.ticketRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTicketDetails(id: string, userId: string): Promise<SupportTicket | null> {
    return this.ticketRepository.findOne({
      where: { id, userId },
      relations: ['messages', 'messages.sender', 'messages.adminSender'],
      order: {
        messages: {
          createdAt: 'ASC'
        }
      }
    });
  }

  async getAllTickets(page: number = 1, limit: number = 20) {
    const [items, total] = await this.ticketRepository.findAndCount({
      relations: ['user'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getAdminTicketDetails(id: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepository.findOne({
      where: { id },
      relations: ['messages', 'messages.sender', 'messages.adminSender', 'user'],
      order: {
        messages: {
          createdAt: 'ASC'
        }
      }
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async claimTicket(ticketId: string, adminId: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.assignedAdminId = adminId;
    ticket.status = TicketStatus.IN_PROGRESS;
    
    return this.ticketRepository.save(ticket);
  }

  async resolveTicket(ticketId: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.status = TicketStatus.RESOLVED;
    return this.ticketRepository.save(ticket);
  }

  async addMessage(ticketId: string, senderId: string, text: string, isFromSupport: boolean): Promise<SupportMessage> {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const messageData: any = {
      text,
      isFromSupport,
      ticket,
    };

    if (isFromSupport) {
      messageData.adminId = senderId;
    } else {
      messageData.senderId = senderId;
    }

    const message = this.messageRepository.create(messageData);
    const savedMessage = await this.messageRepository.save(message);
    const messageId = (savedMessage as any).id;

    // Fetch the saved message with relations for broadcasting
    const fullMessage = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: isFromSupport ? ['adminSender'] : ['sender'],
    });

    if (!fullMessage) throw new NotFoundException('Message not found after save');

    // Broadcast real-time message
    this.supportGateway.broadcastToTicket(ticketId, 'newSupportMessage', fullMessage);

    return fullMessage;
  }
}
