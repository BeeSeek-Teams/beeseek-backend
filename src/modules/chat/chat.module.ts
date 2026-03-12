import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { Conversation } from '../../entities/conversation.entity';
import { Message } from '../../entities/message.entity';
import { User } from '../../entities/user.entity';
import { Job } from '../../entities/job.entity';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../sync/presence.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, User, Job]),
    AuthModule,
    PresenceModule,
    NotificationsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
