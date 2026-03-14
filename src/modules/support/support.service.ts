import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket, TicketStatus } from '../../entities/support-ticket.entity';
import { SupportMessage } from '../../entities/support-message.entity';
import { User } from '../../entities/user.entity';
import { SupportGateway } from './support.gateway';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepository: Repository<SupportTicket>,
    @InjectRepository(SupportMessage)
    private readonly messageRepository: Repository<SupportMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(forwardRef(() => SupportGateway))
    private readonly supportGateway: SupportGateway,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createTicket(userId: string, subject: string, description: string, evidence?: string[]): Promise<SupportTicket> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

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

    // Fetch full ticket with user details for broadcast
    const ticketWithUser = await this.ticketRepository.findOne({
      where: { id: savedTicket.id },
      relations: ['user'],
    });

    // Send confirmation email to user
    try {
      await this.mailService.sendSupportTicketCreated(
        user.email,
        user.firstName,
        savedTicket.id,
        subject,
      );
    } catch (err) {
      this.logger.error(`Failed to send ticket creation email: ${err.message}`);
    }

    // Send push notification using notificationsService
    try {
      await this.notificationsService.notify(
        userId,
        'Support Ticket Created',
        `Your ticket has been created. ID: ${savedTicket.id.slice(0, 8).toUpperCase()}`,
        'SUPPORT' as any,
        { ticketId: savedTicket.id },
      );
    } catch (err) {
      this.logger.error(`Failed to send ticket creation notification: ${err.message}`);
    }

    // Broadcast new ticket to all connected admins
    if (ticketWithUser) {
      this.supportGateway.broadcastNewTicket(ticketWithUser);
    }

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
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.assignedAdminId = adminId;
    ticket.status = TicketStatus.IN_PROGRESS;
    
    const updatedTicket = await this.ticketRepository.save(ticket);

    // Send email notification to user that ticket is being handled
    try {
      const admin = await this.userRepository.findOne({ where: { id: adminId } });
      await this.mailService.sendSupportTicketAssigned(
        ticket.user.email,
        ticket.user.firstName,
        ticket.id,
        ticket.subject,
        admin?.firstName || 'Support Team',
      );
    } catch (err) {
      this.logger.error(`Failed to send ticket assigned email: ${err.message}`);
    }

    // Send push notification to user
    try {
      await this.notificationsService.notify(
        ticket.userId,
        'Ticket Assigned',
        `Your ticket is now being handled by our support team`,
        'SUPPORT' as any,
        { ticketId: ticket.id },
      );
    } catch (err) {
      this.logger.error(`Failed to send ticket assigned notification: ${err.message}`);
    }

    return updatedTicket;
  }

  async resolveTicket(ticketId: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.status = TicketStatus.RESOLVED;
    const updatedTicket = await this.ticketRepository.save(ticket);

    // Send resolution email to user
    try {
      await this.mailService.sendSupportTicketResolved(
        ticket.user.email,
        ticket.user.firstName,
        ticket.id,
        ticket.subject,
      );
    } catch (err) {
      this.logger.error(`Failed to send ticket resolved email: ${err.message}`);
    }

    // Send push notification to user
    try {
      await this.notificationsService.notify(
        ticket.userId,
        'Ticket Resolved',
        `Your support ticket has been resolved`,
        'SUPPORT' as any,
        { ticketId: ticket.id },
      );
    } catch (err) {
      this.logger.error(`Failed to send ticket resolved notification: ${err.message}`);
    }

    return updatedTicket;
  }

  async addMessage(ticketId: string, senderId: string, text: string, isFromSupport: boolean): Promise<SupportMessage> {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId }, relations: ['user'] });
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

    // Send notifications for new messages from support team
    if (isFromSupport) {
      // Send email to user
      try {
        await this.mailService.sendSupportMessageReceived(
          ticket.user.email,
          ticket.user.firstName,
          ticket.id,
          text,
        );
      } catch (err) {
        this.logger.error(`Failed to send support message email: ${err.message}`);
      }

      // Send push notification to user
      try {
        await this.notificationsService.notify(
          ticket.userId,
          'New Message on Your Ticket',
          text.slice(0, 80),
          'SUPPORT' as any,
          { ticketId: ticket.id },
        );
      } catch (err) {
        this.logger.error(`Failed to send support message notification: ${err.message}`);
      }
    }

    return fullMessage;
  }
}
