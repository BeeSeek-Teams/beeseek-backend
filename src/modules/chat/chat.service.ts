import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Conversation } from '../../entities/conversation.entity';
import { Message } from '../../entities/message.entity';
import { User, UserStatus } from '../../entities/user.entity';
import { ChatGateway } from './chat.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../../entities/notification.entity';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(forwardRef(() => ChatGateway))
    private chatGateway: ChatGateway,
    private notificationsService: NotificationsService,
  ) {}

  async getConversations(userId: string, page: number = 1, limit: number = 20) {
    const [items, total] = await this.conversationRepository.findAndCount({
      where: [{ participant1Id: userId }, { participant2Id: userId }],
      relations: ['participant1', 'participant2'],
      order: { lastMessageAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getConversation(roomId: string, userId: string) {
    const room = await this.conversationRepository.findOne({
      where: { id: roomId },
      relations: ['participant1', 'participant2'],
    });

    if (!room) throw new NotFoundException('Conversation not found');
    if (room.participant1Id !== userId && room.participant2Id !== userId) {
      throw new BadRequestException('Not authorized');
    }

    return room;
  }

  async getOrCreateRoom(userId: string, targetId: string) {
    try {
      // Validate inputs
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }
      if (!targetId) {
        throw new BadRequestException('Target user ID is required');
      }

      if (userId === targetId) {
        throw new BadRequestException('Cannot chat with yourself');
      }

      // Check if target user is active
      const targetUser = await this.userRepository.findOne({ where: { id: targetId } });
      if (!targetUser || targetUser.status === UserStatus.DEACTIVATED || targetUser.isDeleted) {
        throw new BadRequestException('This user is no longer active on BeeSeek and cannot receive messages.');
      }

      // Always store participant1 as the one with the smaller ID for consistency
      const [p1, p2] =
        userId < targetId ? [userId, targetId] : [targetId, userId];

      let room = await this.conversationRepository.findOne({
        where: { participant1Id: p1, participant2Id: p2 },
        relations: ['participant1', 'participant2'],
      });

      if (!room) {
        // Create new conversation with explicit assignment
        room = new Conversation();
        room.participant1Id = p1;
        room.participant2Id = p2;
        room.lastMessageAt = new Date();
        
        room = await this.conversationRepository.save(room);
        // Reload to get participants
        room = await this.conversationRepository.findOne({
          where: { id: room.id },
          relations: ['participant1', 'participant2'],
        });
      }

      return room;
    } catch (error) {
      this.logger.error(`getOrCreateRoom failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getMessages(
    roomId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ) {
    const room = await this.conversationRepository.findOne({
      where: { id: roomId },
    });

    if (!room) throw new NotFoundException('Room not found');
    if (room.participant1Id !== userId && room.participant2Id !== userId) {
      throw new BadRequestException('Not authorized');
    }

    return this.messageRepository.find({
      where: { conversationId: roomId },
      relations: ['sender', 'contract', 'contract.bee', 'contract.agent', 'contract.client'],
      order: { createdAt: 'DESC' }, // Use DESC for paging older messages
      take: limit,
      skip: offset,
    });
  }

  async sendMessage(
    roomId: string,
    senderId: string,
    content: string,
    type: string = 'text',
    mediaUrl?: string,
    contractId?: string,
  ) {
    const room = await this.conversationRepository.findOne({
      where: { id: roomId },
      relations: ['participant1', 'participant2'],
    });

    if (!room) throw new NotFoundException('Room not found');
    if (room.participant1Id !== senderId && room.participant2Id !== senderId) {
      throw new BadRequestException('Not authorized');
    }

    // Check if the recipient is deactivated
    const otherParticipant = room.participant1Id === senderId ? room.participant2 : room.participant1;
    if (otherParticipant?.status === UserStatus.DEACTIVATED || otherParticipant?.isDeleted) {
      throw new BadRequestException('Support Notice: This account has been closed. You can no longer send messages to this user.');
    }

    const message = this.messageRepository.create({
      conversationId: roomId,
      senderId,
      content,
      type,
      mediaUrl,
      contractId,
      status: 'sent',
    });

    const savedMessage = await this.messageRepository.save(message);

    // Format last message for conversation list preview
    let previewText = content;
    switch (type) {
      case 'image':
        previewText = '📷 Image';
        break;
      case 'audio':
        previewText = '🎤 Voice message';
        break;
      case 'service_request':
        previewText = '💼 New Service Request';
        break;
      case 'service_quote':
        // Try to extract the amount if present
        const amountMatch = content.match(/₦[\d,.]+/);
        previewText = amountMatch ? `💰 Quote: ${amountMatch[0]}` : '💰 New Quote';
        break;
    }

    room.lastMessageText = previewText;
    room.lastMessageAt = new Date();

    const recipientId =
      room.participant1Id === senderId
        ? room.participant2Id
        : room.participant1Id;
    const isRecipientInRoom = this.chatGateway.isUserInRoom(
      roomId,
      recipientId,
    );

    if (!isRecipientInRoom) {
      if (room.participant1Id === recipientId) {
        room.unreadCountP1 += 1;
      } else {
        room.unreadCountP2 += 1;
      }
    }

    await this.conversationRepository.save(room);

    // Fetch full message with sender for the client
    const fullMessage = await this.messageRepository.findOne({
      where: { id: savedMessage.id },
      relations: ['sender', 'contract', 'contract.bee', 'contract.agent', 'contract.client'],
    });

    // Broadcast to the room via WebSockets (for active chat users)
    this.chatGateway.broadcastToRoom(roomId, 'newMessage', fullMessage);

    // Also send to participants specifically (for global unread indicators/notifications)
    this.chatGateway.sendToUser(room.participant1Id, 'newMessage', fullMessage);
    this.chatGateway.sendToUser(room.participant2Id, 'newMessage', fullMessage);

    // Emit global unread count update for both users (for the Bell icon etc)
    this.emitUnreadCountUpdate(room.participant1Id);
    this.emitUnreadCountUpdate(room.participant2Id);

    // Create internal notification for the recipient
    if (fullMessage?.sender) {
      const senderName = `${fullMessage.sender.firstName} ${fullMessage.sender.lastName}`;
      try {
        await this.notificationsService.createInternal(
          recipientId,
          senderName,
          previewText,
          NotificationType.MESSAGE,
          {
            type: 'CHAT_MESSAGE',
            roomId: roomId,
            senderId: senderId,
          }
        );

        // Emit notification badge update to client (notification bell icon)
        try {
          const { count } = await this.notificationsService.getUnreadCount(recipientId);
          this.chatGateway.sendToUser(recipientId, 'notificationUnreadUpdate', { count });
        } catch (err) {
          this.logger.warn(`Failed to emit notification update: ${err.message}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to create notification for chat message: ${err.message}`);
      }
    }

    // Push Notification if recipient is not in room
    if (!isRecipientInRoom) {
      const sender = fullMessage?.sender;
      if (sender) {
        this.notificationsService.sendPush(
          recipientId,
          `${sender.firstName} ${sender.lastName}`,
          previewText,
          {
            type: 'CHAT_MESSAGE',
            roomId: roomId,
            senderId: senderId,
          }
        );
      }
    }

    return fullMessage;
  }

  private async emitUnreadCountUpdate(userId: string) {
    const totalCount = await this.getTotalUnreadCount(userId);
    this.chatGateway.sendToUser(userId, 'unreadCountUpdate', { count: totalCount });
  }

  async markAsRead(roomId: string, userId: string) {
    await this.messageRepository.update(
      { conversationId: roomId, senderId: Not(userId), isRead: false },
      { isRead: true, status: 'read' },
    );

    // Reset unread count for this user in the conversation
    const room = await this.conversationRepository.findOne({
      where: { id: roomId },
    });
    if (room) {
      if (room.participant1Id === userId) {
        room.unreadCountP1 = 0;
      } else if (room.participant2Id === userId) {
        room.unreadCountP2 = 0;
      }
      await this.conversationRepository.save(room);
    }

    this.chatGateway.broadcastToRoom(roomId, 'messagesRead', {
      roomId,
      userId,
    });
    return { success: true };
  }

  async sendJobUpdate(job: any) {
    // Broadcast to the job-specific room
    this.chatGateway.broadcastToJob(job.id, 'jobUpdate', job);

    // Also send to the client and agent individually for global notifications
    const contract = job.contract;
    if (contract) {
      if (contract.clientId) this.chatGateway.sendToUser(contract.clientId, 'jobUpdate', job);
      if (contract.agentId) this.chatGateway.sendToUser(contract.agentId, 'jobUpdate', job);
    }
  }

  async broadcastAgentStatus(agentId: string, status: {
    isBooked: boolean;
    bookedDate: string | null;
    bookedTime: string | null;
    isAvailable: boolean;
  }) {
    // Global broadcast for search results and detail modals
    this.chatGateway.server.emit('agentStatusUpdate', {
      agentId,
      ...status
    });
  }

  async getTotalUnreadCount(userId: string) {
    const result = await this.conversationRepository
      .createQueryBuilder('c')
      .select(
        `SUM(CASE WHEN c.participant1Id = :userId THEN c."unreadCountP1" ELSE c."unreadCountP2" END)`,
        'total',
      )
      .where('c.participant1Id = :userId OR c.participant2Id = :userId', { userId })
      .getRawOne();

    return parseInt(result?.total || '0', 10);
  }
}
