import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Promotion } from '../../entities/promotion.entity';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { PromotionEvaluatorService } from './promotion-evaluator.service';

@Module({
  imports: [TypeOrmModule.forFeature([Promotion])],
  providers: [PromotionsService, PromotionEvaluatorService],
  controllers: [PromotionsController],
  exports: [PromotionsService, PromotionEvaluatorService],
})
export class PromotionsModule {}
