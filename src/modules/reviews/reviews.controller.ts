import { Controller, Get, Post, Body, UseGuards, Param, Req, Query, Logger } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../entities/user.entity';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  private readonly logger = new Logger(ReviewsController.name);

  constructor(private readonly reviewsService: ReviewsService) {
    this.logger.log('ReviewsController initialized');
  }

  @Post()
  async create(@CurrentUser() user: User, @Body() data: { jobId: string; rating: number; comment?: string }) {
    return this.reviewsService.createReview(user.id, data);
  }

  @Get('admin/flagged')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)
  async getFlaggedReviews(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return this.reviewsService.getFlaggedReviews(parseInt(page), parseInt(limit));
  }

  @Post('admin/:id/toggle-flag')
  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async toggleFlag(
    @Param('id') id: string,
    @Body() body: { isFlagged: boolean },
  ) {
    return this.reviewsService.toggleReviewFlag(id, body.isFlagged);
  }

  @Get('me')
  async getMyReviews(
    @CurrentUser() user: User,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    this.logger.log(`Fetching reviews for user ${user.id}`);
    return this.reviewsService.getReviewsForUser(user.id, page, limit);
  }

  @Get('user/:userId')
  async getUserReviews(
    @Param('userId') userId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.reviewsService.getReviewsForUser(userId, page, limit);
  }

  @Get('given')
  async getGivenReviews(
    @CurrentUser() user: User,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.reviewsService.getReviewsByUser(user.id, page, limit);
  }

  @Get('job/:jobId')
  async getJobReviews(@Param('jobId') jobId: string) {
    return this.reviewsService.getJobReviews(jobId);
  }
}

