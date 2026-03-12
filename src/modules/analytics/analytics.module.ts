import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { Bee } from '../../entities/bee.entity';
import { BeeAnalytics } from '../../entities/bee-analytics.entity';
import { Contract } from '../../entities/contract.entity';
import { Job } from '../../entities/job.entity';
import { User } from '../../entities/user.entity';
import { Review } from '../../entities/review.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Bee, BeeAnalytics, Contract, Job, User, Review])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
