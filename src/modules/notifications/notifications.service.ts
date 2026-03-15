import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import * as admin from 'firebase-admin';
import { ConfigService } from '@nestjs/config';
import { Inject, forwardRef } from '@nestjs/common';
import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    if (admin.apps.length === 0) {
      try {
        // Try ConfigService first, fall back to process.env directly
        const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID') || process.env.FIREBASE_PROJECT_ID;
        const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY') || process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL') || process.env.FIREBASE_CLIENT_EMAIL;

        if (!projectId || !privateKey || !clientEmail) {
          this.logger.warn(`Firebase credentials missing. projectId=${!!projectId}, privateKey=${!!privateKey}, clientEmail=${!!clientEmail}`);
          return;
        }

        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: projectId.replace(/"/g, ''),
            privateKey: privateKey.replace(/"/g, '').replace(/\\n/g, '\n'),
            clientEmail: clientEmail.replace(/"/g, ''),
          } as Partial<admin.ServiceAccount>),
        });
        this.logger.log('Firebase Admin SDK initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
      }
    }
  }

  /**
   * Internal Notification: Saved to Database
   */
  async createInternal(userId: string, title: string, message: string, type: NotificationType, metadata?: any) {
    const notification = this.notificationRepository.create({
      userId,
      title,
      message,
      type,
      metadata,
    });
    return await this.notificationRepository.save(notification);
  }

  /**
   * Push Notification: Sent via FCM
   */
  async sendPush(userId: string, title: string, body: string, data?: any) {
    // PREVENT SPAM: Skip push if user is already in the specific chat room
    if (data?.roomId) {
      try {
        const isInRoom = this.chatGateway.isUserInRoom(data.roomId, userId);
        if (isInRoom) {
          this.logger.log(`User ${userId} is active in room ${data.roomId}. Skipping push.`);
          return;
        }
      } catch (error) {
        // Fallback: if check fails, proceed with push to be safe
        this.logger.warn(`Failed to check room presence for user ${userId}:`, error.message);
      }
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.firebaseToken) {
      this.logger.warn(`User ${userId} has no FCM token. Skipping push notification.`);
      return;
    }

    const message: admin.messaging.Message = {
      token: user.firebaseToken,
      notification: {
        title,
        body,
      },
      data: data ? this.stringifyMetadata(data) : {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      },
      apns: {
         payload: {
           aps: {
             sound: 'default'
           }
         }
      }
    };

    try {
      await admin.messaging().send(message);
      this.logger.log(`Push notification sent to user ${userId}`);
    } catch (error) {
      this.logger.error(`Error sending push notification to user ${userId}:`, error.stack);
    }
  }

  /**
   * Both: Internal + Push
   */
  async notify(userId: string, title: string, message: string, type: NotificationType, metadata?: any) {
    // 1. Create Internal Notification
    const internal = await this.createInternal(userId, title, message, type, metadata);
    
    // 2. Send Push Notification
    await this.sendPush(userId, title, message, metadata);

    // 3. Emit real-time updates via Socket
    try {
      const { count } = await this.getUnreadCount(userId);
      this.chatGateway.sendToUser(userId, 'notificationUnreadUpdate', { count });
      
      // If payment-related, also trigger balance sync for client apps
      if (type === NotificationType.PAYMENT) {
        this.chatGateway.sendToUser(userId, 'walletBalanceUpdate', { 
            timestamp: new Date().getTime() 
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to emit unread count update for user ${userId}:`, error.message);
    }

    return internal;
  }

  /**
   * Broadcast: Bulk Internal + Push (batched to avoid memory spikes)
   */
  async broadcast(title: string, message: string, type: NotificationType, target?: { role?: string; userId?: string }) {
    if (target?.userId) {
      const user = await this.userRepository.findOne({ where: { id: target.userId } });
      if (user) {
        await this.notify(user.id, title, message, type);
        return { sentCount: 1 };
      }
      return { sentCount: 0 };
    }

    const where: any = { isDeleted: false };
    if (target?.role) where.role = target.role;

    const totalUsers = await this.userRepository.count({ where });
    this.logger.log(`Broadcasting "${title}" to ${totalUsers} users.`);

    const BATCH_SIZE = 100;
    let sentCount = 0;

    for (let skip = 0; skip < totalUsers; skip += BATCH_SIZE) {
      const batch = await this.userRepository.find({
        where,
        select: ['id'],
        skip,
        take: BATCH_SIZE,
      });

      await Promise.all(
        batch.map(async (user) => {
          try {
            await this.notify(user.id, title, message, type);
            sentCount++;
          } catch (error) {
            this.logger.error(`Broadcast failure for user ${user.id}:`, error.message);
          }
        }),
      );
    }

    return { sentCount };
  }

  /**
   * Get User Notifications with Pagination
   */
  async getUserNotifications(userId: string, page: number = 1, limit: number = 20) {
    const [data, total] = await this.notificationRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      lastPage: Math.ceil(total / limit),
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    notification.isRead = true;
    const saved = await this.notificationRepository.save(notification);
    
    // Emit update
    const { count } = await this.getUnreadCount(userId);
    this.chatGateway.sendToUser(userId, 'notificationUnreadUpdate', { count });
    
    return saved;
  }

  async markAllAsRead(userId: string) {
    await this.notificationRepository.update({ userId, isRead: false }, { isRead: true });
    
    // Emit update
    this.chatGateway.sendToUser(userId, 'notificationUnreadUpdate', { count: 0 });
    
    return { success: true };
  }

  private stringifyMetadata(metadata: any): { [key: string]: string } {
    const stringified: { [key: string]: string } = {};
    for (const key in metadata) {
      if (typeof metadata[key] === 'object') {
        stringified[key] = JSON.stringify(metadata[key]);
      } else {
        stringified[key] = String(metadata[key]);
      }
    }
    return stringified;
  }
}
