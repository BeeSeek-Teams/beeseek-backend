import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Promotion, PromotionType } from '../../entities/promotion.entity';

@Injectable()
export class PromotionEvaluatorService {
  constructor(
    @InjectRepository(Promotion)
    private promotionRepository: Repository<Promotion>,
  ) {}

  async evaluateRules(amountKobo: number, context: { 
    userId: string, 
    dayOfWeek: number, 
    category?: string 
  }): Promise<{ 
    discountAmount: number, 
    appliedPromos: string[] 
  }> {
    const activePromos = await this.promotionRepository.find({
      where: { isActive: true },
      order: { priority: 'DESC' }
    });

    let totalDiscount = 0;
    const appliedPromos: string[] = [];

    for (const promo of activePromos) {
      // Basic match logic based on entity structure
      let meetsConditions = true;
      const { conditions } = promo;

      if (conditions) {
        if (conditions.minAmount !== undefined && amountKobo < conditions.minAmount) meetsConditions = false;
        if (conditions.dayOfWeek !== undefined && context.dayOfWeek !== conditions.dayOfWeek) meetsConditions = false;
        if (conditions.category !== undefined && context.category !== conditions.category) meetsConditions = false;
      }

      if (meetsConditions) {
        let discount = 0;
        if (promo.type === PromotionType.FEE_WAIVER) {
          // Typically handled as 100% discount of specific fee components elsewhere
          discount = 0; 
        } else if (promo.type === PromotionType.PERCENTAGE_DISCOUNT) {
          discount = Math.floor((amountKobo * promo.value) / 100);
        } else if (promo.type === PromotionType.FLAT_DISCOUNT) {
          discount = promo.value;
        }

        totalDiscount += discount;
        appliedPromos.push(promo.name);
      }
    }

    return { discountAmount: totalDiscount, appliedPromos };
  }
}
