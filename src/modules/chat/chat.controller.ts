import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../entities/user.entity';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('rooms')
  getRooms(
    @CurrentUser() user: User,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.chatService.getConversations(user.id, parseInt(page), parseInt(limit));
  }

  @Get('rooms/:id')
  getRoom(@Param('id') id: string, @CurrentUser() user: User) {
    return this.chatService.getConversation(id, user.id);
  }

  @Post('rooms')
  getOrCreateRoom(
    @CurrentUser() user: User,
    @Body() body: { targetId: string },
  ) {
    return this.chatService.getOrCreateRoom(user.id, body.targetId);
  }

  @Get('rooms/:id/messages')
  getMessages(
    @Param('id') roomId: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.chatService.getMessages(roomId, user.id, limit, offset);
  }

  @Post('rooms/:id/messages')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  sendMessage(
    @Param('id') roomId: string,
    @CurrentUser() user: User,
    @Body() body: { content: string; type?: string; mediaUrl?: string },
  ) {
    return this.chatService.sendMessage(
      roomId,
      user.id,
      body.content,
      body.type || 'text',
      body.mediaUrl,
    );
  }

  @Post('rooms/:id/read')
  markAsRead(@Param('id') roomId: string, @CurrentUser() user: User) {
    return this.chatService.markAsRead(roomId, user.id);
  }

  @Get('unread-count')
  getTotalUnreadCount(@CurrentUser() user: User) {
    return this.chatService.getTotalUnreadCount(user.id);
  }
}
