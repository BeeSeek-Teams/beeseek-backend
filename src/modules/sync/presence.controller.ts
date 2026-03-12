import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Query,
} from '@nestjs/common';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@CurrentUser() user: any) {
    await this.presenceService.heartbeat(user.id);
    return { success: true };
  }

  @Get('batch')
  async getBatch(@Query('ids') ids: string) {
    if (!ids) return {};
    const idArray = ids.split(',');
    return this.presenceService.getBatchStatus(idArray);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: any) {
    await this.presenceService.setOffline(user.id);
    return { success: true };
  }
}
