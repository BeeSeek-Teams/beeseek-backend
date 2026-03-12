import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';

@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, AdminGuard)
@Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  findAll() {
    return this.promotionsService.findAll();
  }

  @Post()
  create(@Body() data: any) {
    return this.promotionsService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.promotionsService.update(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.promotionsService.delete(id);
  }
}
