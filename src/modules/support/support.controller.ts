import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  Patch,
} from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../entities/user.entity';
import { AdminRole } from '../../entities/administrator.entity';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // USER ENDPOINTS
  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  async createTicket(
    @CurrentUser() user: User,
    @Body('subject') subject: string,
    @Body('description') description: string,
    @Body('evidence') evidence?: string[],
  ) {
    return this.supportService.createTicket(user.id, subject, description, evidence);
  }

  @Get('tickets')
  async getUserTickets(
    @CurrentUser() user: User,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.supportService.getUserTickets(user.id, parseInt(page), parseInt(limit));
  }

  @Get('tickets/:id')
  async getTicketDetails(@CurrentUser() user: User, @Param('id') id: string) {
    return this.supportService.getTicketDetails(id, user.id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  async addMessage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body('text') text: string,
  ) {
    return this.supportService.addMessage(id, user.id, text, false);
  }

  // ADMIN ENDPOINTS
  @Get('admin/tickets')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.SUPPORT, AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async getAllTickets(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.supportService.getAllTickets(parseInt(page), parseInt(limit));
  }

  @Get('admin/tickets/:id')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.SUPPORT, AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async getAdminTicketDetails(@Param('id') id: string) {
    return this.supportService.getAdminTicketDetails(id);
  }

  @Patch('admin/tickets/:id/claim')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.SUPPORT, AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async claimTicket(
    @CurrentUser() admin: any,
    @Param('id') id: string,
  ) {
    return this.supportService.claimTicket(id, admin.id);
  }

  @Patch('admin/tickets/:id/resolve')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.SUPPORT, AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async resolveTicket(@Param('id') id: string) {
    return this.supportService.resolveTicket(id);
  }

  @Post('admin/tickets/:id/messages')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.SUPPORT, AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async adminAddMessage(
    @CurrentUser() admin: any,
    @Param('id') id: string,
    @Body('text') text: string,
  ) {
    return this.supportService.addMessage(id, admin.id, text, true);
  }
}
