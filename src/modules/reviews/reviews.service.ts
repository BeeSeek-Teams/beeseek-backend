import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from '../../entities/review.entity';
import { Job, JobStatus } from '../../entities/job.entity';
import { User } from '../../entities/user.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
    @InjectRepository(Job)
    private jobRepository: Repository<Job>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async createReview(
    reviewerId: string,
    data: {
      jobId: string;
      rating: number;
      comment?: string;
    },
  ) {
    const job = await this.jobRepository.findOne({
      where: { id: data.jobId },
      relations: ['contract', 'contract.client', 'contract.agent'],
    });

    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException('Can only review completed jobs');
    }

    const { contract } = job;
    let reviewerRole: 'CLIENT' | 'AGENT';
    let revieweeId: string;

    if (contract.clientId === reviewerId) {
      reviewerRole = 'CLIENT';
      revieweeId = contract.agentId;
    } else if (contract.agentId === reviewerId) {
      reviewerRole = 'AGENT';
      revieweeId = contract.clientId;
    } else {
      throw new BadRequestException('Unauthorized to review this job');
    }

    // Check if review already exists
    const existing = await this.reviewRepository.findOne({
      where: { jobId: data.jobId, reviewerId },
    });
    if (existing) throw new BadRequestException('Review already submitted');

    const reviewer = await this.userRepository.findOne({ where: { id: reviewerId } });
    const reviewee = await this.userRepository.findOne({ where: { id: revieweeId } });

    // 1. Transaction verification threshold (N500 = 50,000 Kobo)
    const isVerifiedTransaction = Number(contract.workmanshipCost) >= 50000;

    // 2. Fraud Triangulation
    let isFlagged = false;
    let flagReason: string | null = null;

    // Identity check (BVN/Linked Account)
    if (reviewer && reviewee) {
      if (reviewer.monnifyBVN && reviewee.monnifyBVN && reviewer.monnifyBVN === reviewee.monnifyBVN) {
        throw new BadRequestException('Security Alert: Review fraud detected (Identity Match)');
      }
      if (reviewer.linkedAccountId === revieweeId || reviewee.linkedAccountId === reviewerId) {
        throw new BadRequestException('Security Alert: Review fraud detected (Linked Account Match)');
      }

      // Hardware/Network check
      if (reviewer.deviceId && reviewee.deviceId && reviewer.deviceId === reviewee.deviceId) {
        isFlagged = true;
        flagReason = 'Shared Hardware Fingerprint';
      } else if (reviewer.lastIpAddress && reviewee.lastIpAddress && reviewer.lastIpAddress === reviewee.lastIpAddress) {
        isFlagged = true;
        flagReason = 'Shared Network Address';
      }
    }

    const review = this.reviewRepository.create({
      jobId: data.jobId,
      reviewerId,
      revieweeId,
      rating: data.rating,
      comment: data.comment,
      reviewerRole,
      isVerifiedTransaction,
      isFlagged,
      flagReason,
    });

    const savedReview = await this.reviewRepository.save(review);

    // Update reviewee's average rating (simplified for high performance)
    // We only count reviews that are NOT flagged
    await this.updateUserRating(revieweeId);

    return savedReview;
  }

  private async updateUserRating(userId: string) {
    const stats = await this.reviewRepository
      .createQueryBuilder('review')
      .where('review.revieweeId = :userId', { userId })
      .andWhere('review.isFlagged = :isFlagged', { isFlagged: false })
      .select('AVG(review.rating)', 'avg')
      .addSelect('COUNT(review.id)', 'count')
      .getRawOne();

    await this.userRepository.update(userId, {
      rating: parseFloat(stats.avg) || 0,
      totalReviews: parseInt(stats.count) || 0,
    });
  }

  async getReviewsForUser(userId: string, page: number = 1, limit: number = 10) {
    const [items, total] = await this.reviewRepository.findAndCount({
      where: { revieweeId: userId },
      relations: ['reviewer'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async getReviewsByUser(userId: string, page: number = 1, limit: number = 10) {
    const [items, total] = await this.reviewRepository.findAndCount({
      where: { reviewerId: userId },
      relations: ['reviewee'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async getFlaggedReviews(page: number = 1, limit: number = 10) {
    const [items, total] = await this.reviewRepository.findAndCount({
      where: { isFlagged: true },
      relations: ['reviewer', 'reviewee', 'job'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async toggleReviewFlag(reviewId: string, isFlagged: boolean) {
    const review = await this.reviewRepository.findOne({ 
      where: { id: reviewId },
      relations: ['reviewee'] 
    });
    if (!review) throw new NotFoundException('Review not found');

    review.isFlagged = isFlagged;
    await this.reviewRepository.save(review);
    
    // Recalculate reviewee rating since a hidden/flagged review might now be visible or vice versa
    await this.updateUserRating(review.revieweeId);
    
    return review;
  }

  async getJobReviews(jobId: string) {
    return this.reviewRepository.find({
      where: { jobId },
      relations: ['reviewer'],
    });
  }
}
