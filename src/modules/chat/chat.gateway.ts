import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Inject, forwardRef, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { PresenceService } from '../sync/presence.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../../entities/conversation.entity';
import { Job } from '../../entities/job.entity';

const WS_ALLOWED_ORIGINS = [
  'https://beeseek.site',
  'https://www.beeseek.site',
  'https://admin.beeseek.site',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081', 'http://localhost:8082'] : []),
];

@WebSocketGateway({
  cors: {
    origin: process.env.NODE_ENV !== 'production' ? true : (origin: string, callback: Function) => {
      // Allow mobile apps (no origin) and whitelisted origins
      if (!origin || WS_ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('WebSocket CORS: origin not allowed'));
      }
    },
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly presenceService: PresenceService,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token || client.handshake.headers.authorization;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token.replace('Bearer ', ''));
      client.data.user = payload;

      const userId = payload.sub;

      // Join a private room for the user to receive personal notifications
      client.join(`user_${userId}`);
      this.logger.log(`Client connected: ${userId}`);

      // Mark user as ONLINE and broadcast
      const presence = await this.presenceService.heartbeat(userId);
      this.server.emit('presenceUpdate', {
        userId,
        status: presence.status,
        lastSeenAt: presence.lastSeenAt,
      });
    } catch (e) {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.user?.sub;
    if (userId) {
      this.logger.log(`Client disconnected: ${userId}`);

      // Mark user as OFFLINE and broadcast
      const presence = await this.presenceService.setOffline(userId);
      this.server.emit('presenceUpdate', {
        userId,
        status: presence.status,
        lastSeenAt: presence.lastSeenAt,
      });
    }
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.user?.sub;
    if (userId) {
      const presence = await this.presenceService.heartbeat(userId);
      this.server.emit('presenceUpdate', {
        userId,
        status: presence.status,
        lastSeenAt: presence.lastSeenAt,
      });
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId: string,
  ) {
    const userId = client.data.user?.sub;
    if (!userId) return { event: 'error', message: 'Not authenticated' };

    // Verify user is a participant of this conversation
    const conversation = await this.conversationRepository.findOne({
      where: { id: roomId },
    });
    if (!conversation || (conversation.participant1Id !== userId && conversation.participant2Id !== userId)) {
      return { event: 'error', message: 'Not authorized to join this room' };
    }

    client.join(`room_${roomId}`);
    return { event: 'joined', room: roomId };
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId: string,
  ) {
    client.leave(`room_${roomId}`);
    return { event: 'left', room: roomId };
  }

  @SubscribeMessage('joinJob')
  async handleJoinJob(
    @ConnectedSocket() client: Socket,
    @MessageBody() jobId: string,
  ) {
    const userId = client.data.user?.sub;
    if (!userId) return { event: 'error', message: 'Not authenticated' };

    // Verify user is client or agent on this job
    const job = await this.jobRepository.findOne({
      where: { id: jobId },
      relations: ['contract'],
    });
    if (!job || (job.contract?.clientId !== userId && job.contract?.agentId !== userId)) {
      return { event: 'error', message: 'Not authorized to join this job room' };
    }

    client.join(`job_${jobId}`);
    this.logger.log(`Client joined job_${jobId}`);
    return { event: 'joined', job: jobId };
  }

  @SubscribeMessage('leaveJob')
  handleLeaveJob(
    @ConnectedSocket() client: Socket,
    @MessageBody() jobId: string,
  ) {
    client.leave(`job_${jobId}`);
    return { event: 'left', job: jobId };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; isTyping: boolean },
  ) {
    const userId = client.data.user?.sub;
    client.to(`room_${data.roomId}`).emit('typingStatus', {
      roomId: data.roomId,
      userId,
      isTyping: data.isTyping,
    });
  }

  // Helper to broadcast to a conversation room
  broadcastToRoom(roomId: string, event: string, payload: any) {
    this.logger.log(`Broadcasting to room_${roomId}: event=${event}, payload=${JSON.stringify(payload)}`);
    this.server.to(`room_${roomId}`).emit(event, payload);
  }

  // Helper to broadcast to a job room
  broadcastToJob(jobId: string, event: string, payload: any) {
    this.logger.log(`Broadcasting to job_${jobId}: event=${event}`);
    this.server.to(`job_${jobId}`).emit(event, payload);
  }

  // Send to a specific user's private room
  sendToUser(userId: string, event: string, payload: any) {
    this.logger.log(`Sending to user_${userId}: event=${event}`);
    this.server.to(`user_${userId}`).emit(event, payload);
  }

  // Check if a user is currently in a room
  isUserInRoom(roomId: string, userId: string): boolean {
    const roomName = `room_${roomId}`;
    const sockets = this.server.sockets.adapter.rooms.get(roomName);
    if (!sockets) return false;

    for (const socketId of sockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket?.data?.user?.sub === userId) {
        return true;
      }
    }
    return false;
  }
}
