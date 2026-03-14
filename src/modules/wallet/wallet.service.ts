import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Like, MoreThan } from 'typeorm';
import * as crypto from 'crypto';
import { User } from '../../entities/user.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../../entities/transaction.entity';
import { NotificationType } from '../../entities/notification.entity';
import { SecurityService } from '../security/security.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MonnifyService } from './monnify.service';
import { MailService } from '../mail/mail.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PromotionType } from '../../entities/promotion.entity';
import { UserBank } from '../../entities/user-bank.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(UserBank)
    private userBankRepository: Repository<UserBank>,
    private securityService: SecurityService,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private monnifyService: MonnifyService,
    private mailService: MailService,
    private promotionsService: PromotionsService,
  ) {
    this.logger = new Logger(WalletService.name);
  }

  private readonly logger: Logger;

  async getBalance(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['walletBalance', 'lockedBalance'],
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      availableBalance: user.walletBalance,
      lockedBalance: user.lockedBalance,
    };
  }

  async getTransactions(userId: string) {
    return this.transactionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async getAdminTransactions(query: {
    page?: number;
    limit?: number;
    type?: TransactionType;
    status?: TransactionStatus;
    search?: string;
  }) {
    const { page = 1, limit = 20, type, status, search } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.transactionRepository
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.user', 'user')
      .orderBy('tx.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (type) {
      queryBuilder.andWhere('tx.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('tx.status = :status', { status });
    }

    if (search) {
      queryBuilder.andWhere(
        '(tx.description ILIKE :search OR tx.monnifyReference ILIKE :search OR user.firstName ILIKE :search OR user.lastName ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdminTransactionStats() {
    const stats = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('tx.type', 'type')
      .addSelect('SUM(tx.amount)', 'total')
      .addSelect('COUNT(*)', 'count')
      .where('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .groupBy('tx.type')
      .getRawMany();

    const revenueStats = await this.transactionRepository
      .createQueryBuilder('tx')
      .select("SUM(CAST(tx.metadata->>'serviceFee' AS BIGINT))", 'totalServiceFees')
      .addSelect("SUM(CAST(tx.metadata->>'commissionAmount' AS BIGINT))", 'totalCommissions')
      .where('tx.type = :type', { type: TransactionType.REVENUE })
      .getRawOne();

    return {
      byType: stats,
      revenue: revenueStats,
    };
  }

  // High-integrity balance update with atomicity and idempotency
  async processPayment(
    userId: string,
    amountKobo: number,
    type: TransactionType,
    description: string,
    idempotencyKey?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      // 1. Check for existing transaction if idempotency key provided
      if (idempotencyKey) {
        const existing = await manager.findOne(Transaction, {
          where: { idempotencyKey },
        });
        if (existing) return existing;
      }

      // 2. Get user with lock to prevent race conditions
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (type === TransactionType.DEBIT && user.walletBalance < amountKobo) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      // 3. Update balance
      if (type === TransactionType.DEBIT) {
        user.walletBalance -= amountKobo;
      } else if (type === TransactionType.CREDIT) {
        user.walletBalance += amountKobo;
      } else if (type === TransactionType.LOCKED) {
        user.lockedBalance += amountKobo;
      }

      await manager.save(user);

      // 4. Record transaction
      const transaction = manager.create(Transaction, {
        userId,
        amount: amountKobo,
        type,
        status: TransactionStatus.SUCCESS,
        description,
        idempotencyKey,
      });

      const savedTransaction = await manager.save(transaction);

      // 5. Notify User of Balance Change
      const symbol = type === TransactionType.DEBIT ? '-' : '+';
      const typeLabel = type === TransactionType.DEBIT ? 'Debit' : 'Credit';
      
      this.notificationsService.notify(
        userId,
        `Wallet ${typeLabel}`,
        `${description}: ${symbol}₦${amountKobo / 100}`,
        NotificationType.PAYMENT,
        {
          transactionId: savedTransaction.id,
          amount: amountKobo.toString(),
          transactionType: type,
        }
      );

      return savedTransaction;
    });
  }

  async withdraw(
    userId: string,
    amountKobo: number,
    bankDetails: { bankName: string; bankCode: string; accountNumber: string; accountName: string },
    pin: string,
    idempotencyKey?: string,
  ) {
    // 1. Verify Minimum Withdrawal
    if (amountKobo < 100000) { // ₦1,000 in Kobo
      throw new BadRequestException('Minimum withdrawal amount is ₦1,000');
    }

    // 2. Verify PIN
    await this.securityService.verifyTransactionPin(userId, pin);

    // 3. Calculate Fee via Rule Evaluator
    const { fee: feeKobo, promo } = await this.calculateWithdrawalFee(userId, amountKobo);

    return this.dataSource.transaction(async (manager) => {
      // 4. Prevent Duplicates (Idempotency)
      if (idempotencyKey) {
        const existing = await manager.findOne(Transaction, { where: { idempotencyKey } });
        if (existing) return { success: true, alreadyProcessed: true };
      }

      // 5. Get user with Pessimistic Lock (High Security)
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) throw new BadRequestException('User not found');

      const totalDebitKobo = amountKobo + feeKobo;

      if (user.walletBalance < totalDebitKobo) {
        throw new BadRequestException(`Insufficient balance. Note: A ₦${feeKobo/100} fee is required.`);
      }

      // 6. Deduct from wallet (Accessible balance only)
      user.walletBalance -= totalDebitKobo;
      await manager.save(user);

      // 7. Call Monnify (Real Disbursement)
      let monnifyRef = '';
      try {
        // Monnify expects amount in Naira (not Kobo) for disbursements
        const withdrawalAmountNaira = amountKobo / 100;
        
        const monnifyRes = await this.monnifyService.initiateTransfer(
          user.monnifyAccountId || '', // Source
          withdrawalAmountNaira,
          `BeeSeek Withdrawal: ${user.firstName}`,
          bankDetails.bankCode,
          bankDetails.accountNumber
        );
        monnifyRef = monnifyRes.transactionReference;
      } catch (error) {
        this.logger.error(`Monnify Disbursement Failed for user ${userId}`, error.stack);
        throw new BadRequestException('Withdrawal failed at bank level. Please try again later.');
      }

      // 8. Record transaction
      const transaction = manager.create(Transaction, {
        userId,
        amount: amountKobo,
        type: TransactionType.DEBIT,
        status: TransactionStatus.SUCCESS,
        description: `Withdrawal to ${bankDetails.bankName} (${bankDetails.accountNumber})${promo ? ` (Promo: ${promo.name} applied)` : ''}`,
        idempotencyKey,
        metadata: {
           fee: feeKobo,
           bank: bankDetails.bankName,
           account: bankDetails.accountNumber,
           monnifyRef,
           promoId: promo?.id,
           orgCost: 2000 // ₦20 cost to platform for every transfer (Monnify fee)
        }
      });

      const savedTransaction = await manager.save(transaction);

      // 9. Notifications (Push & Email)
      const formattedAmount = (amountKobo / 100).toLocaleString();
      this.notificationsService.notify(
        userId,
        'Withdrawal Successful',
        `₦${formattedAmount} has been sent to ${bankDetails.bankName} (${bankDetails.accountNumber.slice(-4)}).${promo ? ' Fee waived!' : ''}`,
        NotificationType.PAYMENT,
        { 
          transactionId: savedTransaction.id,
          url: '/transactions' 
        }
      );

      this.mailService.sendWithdrawalNotification(user.email, user.firstName, {
        amount: (amountKobo / 100).toLocaleString(),
        bank: bankDetails.bankName,
        account: bankDetails.accountNumber,
        reference: savedTransaction.id,
        fee: (feeKobo / 100).toString()
      });

      return { success: true, balance: user.walletBalance, transactionId: savedTransaction.id };
    });
  }

  async calculateWithdrawalFee(userId: string, amountKobo: number) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const downloadsToday = await this.transactionRepository.count({
      where: {
        userId,
        type: TransactionType.DEBIT,
        status: TransactionStatus.SUCCESS,
        description: Like('%Withdrawal%'),
        createdAt: MoreThan(todayStart)
      }
    });

    const baseFeeKobo = downloadsToday >= 1 ? 5000 : 0; // ₦50 for second withdrawal
    
    const promo = await this.promotionsService.evaluatePromotions(userId, {
      amountKobo,
      userTransactionCount: 0, 
    });

    if (!promo) return { fee: baseFeeKobo, promo: null };

    let finalFee = baseFeeKobo;
    if (promo.type === PromotionType.FEE_WAIVER) {
      finalFee = 0;
    } else if (promo.type === PromotionType.FLAT_DISCOUNT) {
      finalFee = Math.max(0, baseFeeKobo - promo.value);
    } else if (promo.type === PromotionType.PERCENTAGE_DISCOUNT) {
      finalFee = Math.round(baseFeeKobo * (1 - (promo.value / 100)));
    }

    return { fee: finalFee, promo };
  }

  async getEconomicsStats() {
    // 1. Platform Earnings (Service Fees + Commissions)
    const platformEarnings = await this.transactionRepository
      .createQueryBuilder('tx')
      .select("SUM(CAST(tx.metadata->>'serviceFee' AS BIGINT))", 'totalServiceFees')
      .addSelect("SUM(CAST(tx.metadata->>'commissionAmount' AS BIGINT))", 'totalCommissions')
      .where('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .getRawOne();

    // 2. Withdrawal Fees Charged to Users
    const feesChargedToUsers = await this.transactionRepository
      .createQueryBuilder('tx')
      .select("SUM(CAST(tx.metadata->>'fee' AS BIGINT))", 'totalFees')
      .where('tx.type = :type', { type: TransactionType.DEBIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .getRawOne();

    // 3. Operational Costs (Fees BeeSeek pays Monnify for Withdrawals)
    const operationalCosts = await this.transactionRepository
      .createQueryBuilder('tx')
      .select("SUM(CAST(tx.metadata->>'orgCost' AS BIGINT))", 'totalCost')
      .where('tx.type = :type', { type: TransactionType.DEBIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .getRawOne();

    return {
      revenue: {
        serviceFees: Number(platformEarnings.totalServiceFees) || 0,
        commissions: Number(platformEarnings.totalCommissions) || 0,
        total: (Number(platformEarnings.totalServiceFees) || 0) + (Number(platformEarnings.totalCommissions) || 0),
      },
      withdrawals: {
        feesCollected: Number(feesChargedToUsers.totalFees) || 0,
        costsBorne: Number(operationalCosts.totalCost) || 0,
        netWithdrawalProfit: (Number(feesChargedToUsers.totalFees) || 0) - (Number(operationalCosts.totalCost) || 0),
      },
      netPlatformPosition: ((Number(platformEarnings.totalServiceFees) || 0) + (Number(platformEarnings.totalCommissions) || 0)) +
                            ((Number(feesChargedToUsers.totalFees) || 0) - (Number(operationalCosts.totalCost) || 0))
    };
  }

  async getBanks() {
    return this.monnifyService.getBanks();
  }

  async getUserBanks(userId: string) {
    return this.userBankRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async addUserBank(userId: string, data: { bankName: string; bankCode: string; accountNumber: string; accountName: string }) {
    // 1. Check limit (max 2 as per policy)
    const count = await this.userBankRepository.count({ where: { userId } });
    if (count >= 2) {
      throw new BadRequestException('You can only link a maximum of 2 bank accounts for security reasons.');
    }

    // 2. Check for duplicate
    const existing = await this.userBankRepository.findOne({
      where: { userId, accountNumber: data.accountNumber },
    });
    if (existing) {
      throw new BadRequestException('This bank account is already linked to your profile.');
    }

    const bank = this.userBankRepository.create({
      userId,
      ...data,
    });

    return this.userBankRepository.save(bank);
  }

  async deleteUserBank(userId: string, bankId: string) {
    const bank = await this.userBankRepository.findOne({
      where: { id: bankId, userId },
    });

    if (!bank) {
      throw new BadRequestException('Bank account not found');
    }

    await this.userBankRepository.remove(bank);
    return { success: true };
  }

  async validateAccount(accountNumber: string, bankCode: string) {
    return this.monnifyService.validateAccount(accountNumber, bankCode);
  }

  /**
   * HIGH PERFORMANCE WEBHOOK HANDLER
   * Handles incoming payment notifications from Monnify for Reserved Accounts
   */
  async handleMonnifyWebhook(body: any, signature: string) {
    this.logger.log(`Received Monnify Webhook: ${body.eventType}`);

    // 1. Verify Signature for Security
    const secretKey = process.env.MONNIFY_SECRET_KEY;
    if (!secretKey) {
      this.logger.error('MONNIFY_SECRET_KEY not found in environment');
      throw new BadRequestException('Webhook configuration error');
    }

    const computedSignature = crypto
      .createHmac('sha512', secretKey)
      .update(JSON.stringify(body))
      .digest('hex');

    if (computedSignature !== signature) {
      this.logger.warn('Monnify Webhook attempted with INVALID SIGNATURE');
      throw new BadRequestException('Invalid signature');
    }

    // 2. Handle successful transaction
    if (body.eventType === 'SUCCESSFUL_TRANSACTION') {
      const data = body.eventData;
      
      const amountKobo = Math.round(data.amountPaid * 100);
      
      // Extract NUBAN from destinationAccountInformation
      const nuban = data.destinationAccountInformation?.accountNumber;
      const transactionRef = data.transactionReference;

      if (!nuban) {
        this.logger.warn(`Webhook missing NUBAN. Full data: ${JSON.stringify(data)}`);
        return { status: 'ignored' };
      }

      this.logger.log(`Looking for user with NUBAN: ${nuban}`);

      // 3. Find User by NUBAN
      const user = await this.userRepository.findOne({
        where: { monnifyNUBAN: nuban },
      });

      if (!user) {
        this.logger.warn(`User with NUBAN ${nuban} not found for webhook`);
        return { status: 'user_not_found' };
      }

      // 4. Process Payment (Atomicity & Idempotency handled inside)
      const sourceAccountNumber = data.paymentSourceInformation?.[0]?.accountNumber || 'Unknown';
      const description = `Wallet Top Up via Bank Transfer (${sourceAccountNumber})`;
      await this.processPayment(
        user.id,
        amountKobo,
        TransactionType.CREDIT,
        description,
        transactionRef, // Use Monnify ref as idempotency key
      );

      this.logger.log(`Successfully credited user ${user.id} for ${amountKobo} kobo`);
      return { status: 'success' };
    }

    return { status: 'event_ignored' };
  }
}
