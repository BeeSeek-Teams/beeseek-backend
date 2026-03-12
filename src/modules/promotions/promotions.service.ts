import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Promotion, PromotionType } from '../../entities/promotion.entity';

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    @InjectRepository(Promotion)
    private readonly promotionRepository: Repository<Promotion>,
  ) {}

  async findAll() {
    return this.promotionRepository.find({
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async findActive() {
    return this.promotionRepository.find({
      where: { isActive: true },
      order: { priority: 'DESC' },
    });
  }

  async create(data: Partial<Promotion>) {
    const promo = this.promotionRepository.create(data);
    return this.promotionRepository.save(promo);
  }

  async update(id: string, data: Partial<Promotion>) {
    await this.promotionRepository.update(id, data);
    return this.promotionRepository.findOne({ where: { id } });
  }

  async delete(id: string) {
    return this.promotionRepository.delete(id);
  }

  /**
   * Evaluate active promotions for a given user context
   */
  async evaluatePromotions(userId: string, context: { amountKobo: number; userTransactionCount: number; userRating?: number }) {
    const activePromos = await this.findActive();
    const now = new Date();
    const dayOfWeek = now.getDay();

    for (const promo of activePromos) {
      const { conditions } = promo;
      let matches = true;

      if (conditions) {
        // Condition: Day of Week
        if (conditions.dayOfWeek !== undefined && conditions.dayOfWeek !== dayOfWeek) {
          matches = false;
        }

        // Condition: Minimum Amount
        if (conditions.minAmount !== undefined && context.amountKobo < conditions.minAmount) {
          matches = false;
        }

        // Condition: Max User Transaction Count (New User)
        if (conditions.maxUserTransactionCount !== undefined && context.userTransactionCount > conditions.maxUserTransactionCount) {
          matches = false;
        }

        // Condition: Minimum Rating
        if (conditions.minRating !== undefined && (context.userRating || 0) < conditions.minRating) {
          matches = false;
        }
      }

      if (matches) {
        return promo; // Return the first matching promo based on priority
      }
    }

    return null;
  }
}
