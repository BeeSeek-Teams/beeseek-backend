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
import { SupportService } from './support.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from '../../entities/support-ticket.entity';

const WS_ALLOWED_ORIGINS = [
  'https://beeseek.site',
  'https://www.beeseek.site',
  'https://admin.beeseek.site',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081', 'http://localhost:8082'] : []),
];

@WebSocketGateway({
  cors: {
    origin: process.env.NODE_ENV !== 'production' ? true : (origin: string, callback: Function) => {
      if (!origin || WS_ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('WebSocket CORS: origin not allowed'));
      }
    },
    credentials: true,
  },
})
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SupportGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => SupportService))
    private readonly supportService: SupportService,
    @InjectRepository(SupportTicket)
    private readonly ticketRepository: Repository<SupportTicket>,
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
      this.logger.log(`Support Client connected: ${payload.sub}`);
    } catch (e) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Support Client disconnected`);
  }

  @SubscribeMessage('joinTicket')
  async handleJoinTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() ticketId: string,
  ) {
    const userId = client.data.user?.sub;
    const userRole = client.data.user?.role;
    if (!userId) return { event: 'error', message: 'Not authenticated' };

    // Admins can join any ticket; users can only join their own
    const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT'].includes(userRole);
    if (!isAdmin) {
      const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
      if (!ticket || ticket.userId !== userId) {
        return { event: 'error', message: 'Not authorized to join this ticket' };
      }
    }

    client.join(`ticket_${ticketId}`);
    return { event: 'joined', ticket: ticketId };
  }

  @SubscribeMessage('leaveTicket')
  handleLeaveTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() ticketId: string,
  ) {
    client.leave(`ticket_${ticketId}`);
    return { event: 'left', ticket: ticketId };
  }

  // Helper to broadcast to a ticket room
  broadcastToTicket(ticketId: string, event: string, payload: any) {
    this.server.to(`ticket_${ticketId}`).emit(event, payload);
  }

  // Broadcast new ticket to all connected admins
  broadcastNewTicket(ticket: any) {
    this.server.emit('newTicket', ticket);
  }
}
