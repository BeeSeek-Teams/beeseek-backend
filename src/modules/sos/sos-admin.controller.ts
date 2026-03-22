import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SosService } from './sos.service';
import { SosStatus } from '../../entities/sos-alert.entity';

@Controller('admin/sos')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SosAdminController {
  constructor(private readonly sosService: SosService) {}

  @Get()
  @Roles(AdminRole.SUPPORT, AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: SosStatus,
  ) {
    return this.sosService.findAll(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      status,
    );
  }

  @Post(':id/resolve')
  @Roles(AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  resolve(
    @Param('id') id: string,
    @CurrentUser() admin: any,
    @Body() body: { note?: string },
  ) {
    return this.sosService.resolve(id, admin.id, body.note);
  }
}
