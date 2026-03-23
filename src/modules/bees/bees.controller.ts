import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { BeesService } from './bees.service';
import { CreateBeeDto } from './dto/create-bee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../entities/user.entity';
import { Throttle } from '@nestjs/throttler';

@Controller('bees')
@UseGuards(JwtAuthGuard)
export class BeesController {
  constructor(private readonly beesService: BeesService) {}

  @Post()
  create(@Body() createBeeDto: CreateBeeDto, @CurrentUser() user: User) {
    return this.beesService.create(createBeeDto, user);
  }

  @Get('my-bees')
  findAllMyBees(@CurrentUser() user: User) {
    return this.beesService.findAllByAgent(user.id);
  }

  @Post('migrate-locations')
  migrateLocations(
    @CurrentUser() user: User,
    @Body() body: { lat: number; lng: number; address: string },
  ) {
    return this.beesService.migrateLocations(user.id, body.lat, body.lng, body.address);
  }

  @Get('agent/:agentId')
  findAllByAgent(@Param('agentId') agentId: string) {
    return this.beesService.findAllByAgent(agentId);
  }

  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  search(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('category') category?: string,
    @Query('radius') radius?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('query') search?: string,
    @Query('minRating') minRating?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
    @Query('onlineOnly') onlineOnly?: string,
    @Query('hasInspection') hasInspection?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    return this.beesService.searchNearby(
      parseFloat(lat),
      parseFloat(lng),
      category,
      radius ? parseFloat(radius) : 15,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      search,
      minRating ? parseFloat(minRating) : undefined,
      verifiedOnly === 'true',
      onlineOnly === 'true',
      hasInspection === 'true',
      sortBy,
    );
  }

  @Get('admin/list/all')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)
  adminFindAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.beesService.adminFindAll({
      search,
      category,
      isActive,
      take: take ? parseInt(take) : 20,
      skip: skip ? parseInt(skip) : 0,
      sortBy,
      sortOrder,
    });
  }

  @Get('admin/stats')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)
  getAdminStats() {
    return this.beesService.getAdminStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.beesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBeeDto: Partial<CreateBeeDto>,
    @CurrentUser() user: User,
  ) {
    return this.beesService.update(id, updateBeeDto, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.beesService.remove(id, user.id);
  }

  @Delete('admin/:id')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  adminRemove(@Param('id') id: string) {
    return this.beesService.adminRemove(id);
  }

  @Patch('admin/:id/toggle-active')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  adminToggleActive(@Param('id') id: string) {
    return this.beesService.adminToggleActive(id);
  }

  @Post('admin/reconcile-metrics')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  reconcileMetrics() {
    return this.beesService.reconcileMetrics();
  }
}
