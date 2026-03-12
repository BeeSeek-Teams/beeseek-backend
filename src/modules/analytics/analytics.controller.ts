import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { BeeAnalyticsEventType } from '../../entities/bee-analytics.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('track')
  @UseGuards(JwtAuthGuard)
  async trackEvent(
    @Body()
    body: { beeId: string; type: BeeAnalyticsEventType; metadata?: any },
    @Request() req,
  ) {
    const userId = req.user?.id;
    return this.analyticsService.trackEvent(
      body.beeId,
      body.type,
      userId,
      body.metadata,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('bee/:id')
  async getStats(@Param('id') beeId: string, @Query('days') days: number = 7) {
    return this.analyticsService.getBeeStats(beeId, days);
  }

  @UseGuards(JwtAuthGuard)
  @Get('overview')
  async getOverview(@Request() req, @Query('period') period?: string) {
    if (req.user.role === 'AGENT') {
      return this.analyticsService.getAgentOverview(req.user.id, period);
    }
    return this.analyticsService.getClientOverview(req.user.id, period);
  }

  @UseGuards(JwtAuthGuard)
  @Get('hires/recent')
  async getRecentHires(@Request() req) {
    return this.analyticsService.getRecentHires(req.user.id, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('hires/recurring')
  async getRecurringHires(@Request() req) {
    return this.analyticsService.getRecurringHires(req.user.id, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('pending-reviews')
  async getPendingReviews(@Request() req) {
    return this.analyticsService.getUnratedJobs(req.user.id, req.user.role);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  @Get('admin/dashboard')
  async getAdminDashboardStats() {
    return this.analyticsService.getAdminDashboardStats();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)
  @Get('admin/distributions')
  async getPlatformDistributions() {
    return this.analyticsService.getPlatformDistributions();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)
  @Get('admin/map-markers')
  async getMapMarkers() {
    return this.analyticsService.getMapMarkers();
  }
}
