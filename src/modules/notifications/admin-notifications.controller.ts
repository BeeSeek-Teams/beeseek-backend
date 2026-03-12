import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';
import { NotificationType } from '../../entities/notification.entity';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminNotificationsController {
  private readonly logger = new Logger(AdminNotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async sendNotification(
    @Body() body: { 
      title: string; 
      message: string; 
      type: NotificationType;
      target?: { role?: string; userId?: string };
    }
  ) {
    this.logger.log(`Admin sending notification: ${body.title}`);
    return this.notificationsService.broadcast(
        body.title, 
        body.message, 
        body.type, 
        body.target
    );
  }
}
