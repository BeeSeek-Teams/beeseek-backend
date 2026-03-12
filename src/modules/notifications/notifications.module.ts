import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, User]),
    forwardRef(() => ChatModule),
  ],
  providers: [NotificationsService],
  controllers: [NotificationsController, AdminNotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
