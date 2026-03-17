import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get('active')
  @UseGuards(JwtAuthGuard)
  findActive() {
    return this.promotionsService.findActive();
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  findAll() {
    return this.promotionsService.findAll();
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  create(@Body() data: any) {
    return this.promotionsService.create(data);
  }

  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() data: any) {
    return this.promotionsService.update(id, data);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  delete(@Param('id') id: string) {
    return this.promotionsService.delete(id);
  }
}
