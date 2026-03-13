import { Controller, Get, Put, Delete, Post, Body, UseGuards, Param, Patch, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { QueenGuard } from '../../common/guards/queen.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { User, NinStatus } from '../../entities/user.entity';
import { AdminRole } from '../../entities/administrator.entity';
import { UpdateProfileDto } from '../../dto/update-profile.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: User) {
    return this.usersService.getUserById(user.id);
  }

  /** GDPR / DSAR — download all personal data as JSON (rate-limited: 3 per hour) */
  @Get('export-data')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  async exportData(@CurrentUser() user: User, @Res() res: Response) {
    const data = await this.usersService.exportUserData(user.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="beeseek-data-export-${user.id}.json"`);
    return res.json(data);
  }

  @Delete('profile')
  @UseGuards(JwtAuthGuard)
  async deactivateAccount(@CurrentUser() user: User) {
    return this.usersService.deactivateAccount(user.id);
  }

  @Post('admin/reactivate/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async reactivateAccount(@Param('id') id: string) {
    return this.usersService.reactivateAccount(id);
  }

  @Get('verifications/pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async getPendingVerifications() {
    return this.usersService.getPendingVerifications();
  }

  @Patch('verifications/:id/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async updateVerificationStatus(
    @Param('id') id: string,
    @Body() body: { status: NinStatus; registryName?: string }
  ) {
    return this.usersService.updateNinStatus(id, body.status, body.registryName);
  }

  @Post('verifications/:id/background-check')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.MODERATOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async runBackgroundCheck(@Param('id') id: string) {
    return this.usersService.runBackgroundCheck(id);
  }

  @Post('verifications/:id/repair-wallet')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async repairWallet(@Param('id') id: string) {
    return this.usersService.repairWallet(id);
  }

  @Get('list/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async listAllUsers(
    @Req() req: any
  ) {
    const { search, role, status, ninStatus, take, skip } = req.query;
    return this.usersService.findAllFiltered({ search, role, status, ninStatus, take, skip });
  }

  @Patch(':id/toggle-block')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async toggleBlockUser(@Param('id') id: string) {
    return this.usersService.toggleBlockUser(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getUserById(@Param('id') id: string) {
    return this.usersService.getUserWithBees(id);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@CurrentUser() user: User, @Body() data: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, data);
  }

  @Put('fcm-token')
  @UseGuards(JwtAuthGuard)
  async updateFcmToken(@CurrentUser() user: User, @Body('token') token: string) {
    return this.usersService.updateFcmToken(user.id, token);
  }

  @Get('nearby')
  @UseGuards(JwtAuthGuard)
  async getNearby(@CurrentUser() user: User) {
    if (!user.latitude || !user.longitude) {
      return { error: 'Location not set' };
    }
    return this.usersService.getNearbyUsers(
      user.latitude,
      user.longitude,
      10,
      user.id,
    );
  }

  @Get('admin/list')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async listAdmins() {
    return this.usersService.getAdmins();
  }

  @Post('admin/create')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  async createAdmin(@Body() data: any) {
    return this.usersService.createAdmin(data);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  async removeAdmin(@Param('id') id: string) {
    return this.usersService.deleteAdmin(id);
  }
}
