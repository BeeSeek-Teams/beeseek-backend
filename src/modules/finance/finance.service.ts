import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import {
  Administrator,
  AdminStatus,
} from '../../entities/administrator.entity';
import { User } from '../../entities/user.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../../entities/transaction.entity';
import {
  FundingRequest,
  FundingRequestStatus,
} from '../../entities/funding-request.entity';
import {
  CreateFundingRequestDto,
  UpdateFundingRequestDto,
  FundingRequestQueryDto,
  CashflowQueryDto,
} from './dto/finance.dto';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(Administrator)
    private adminRepository: Repository<Administrator>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(FundingRequest)
    private fundingRequestRepository: Repository<FundingRequest>,
    private jwtService: JwtService,
    private dataSource: DataSource,
  ) {}

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Authenticate an administrator by password.
   * Iterates all active admins and checks the password hash.
   * Returns a JWT token scoped to the matched administrator.
   */
  async login(password: string) {
    // Load all active admins with their hashed passwords
    const admins = await this.adminRepository.find({
      where: { status: AdminStatus.ACTIVE },
      select: ['id', 'email', 'firstName', 'lastName', 'hashedPassword', 'role'],
    });

    if (!admins.length) {
      throw new UnauthorizedException('No active administrators found');
    }

    // Check password against each admin (finance portal uses password-only auth)
    for (const admin of admins) {
      const isMatch = await bcrypt.compare(password, admin.hashedPassword);
      if (isMatch) {
        await this.adminRepository.update(admin.id, { lastLoginAt: new Date() });
        this.logger.log(`[FINANCE] Administrator logged in: ${admin.id} (${admin.role})`);

        const jti = randomUUID();
        const token = this.jwtService.sign({
          sub: admin.id,
          email: admin.email,
          role: admin.role,
          jti,
        });

        return {
          success: true,
          token,
          admin: {
            id: admin.id,
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            role: admin.role,
          },
        };
      }
    }

    throw new UnauthorizedException('Invalid password');
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────────────

  /**
   * Aggregate real-time financial statistics from the platform.
   * - totalWalletBalance: Sum of all user walletBalance fields
   * - monthlyPayouts: Sum of successful DEBIT transactions this month
   * - activeCashFlow: Sum of successful CREDIT transactions this month
   * - estimatedBurnRate: Average monthly DEBIT over the last 3 months
   */
  async getStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

    // Total wallet balance across all users
    const walletResult = await this.userRepository
      .createQueryBuilder('user')
      .select('COALESCE(SUM(user.walletBalance), 0)', 'total')
      .getRawOne();
    const totalWalletBalance = parseInt(walletResult.total) || 0;

    // Monthly payouts (successful debits this month)
    const payoutsResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.type = :type', { type: TransactionType.DEBIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .andWhere('tx.createdAt >= :start', { start: startOfMonth })
      .getRawOne();
    const monthlyPayouts = parseInt(payoutsResult.total) || 0;

    // Active cash flow (successful credits this month)
    const cashflowResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.type = :type', { type: TransactionType.CREDIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .andWhere('tx.createdAt >= :start', { start: startOfMonth })
      .getRawOne();
    const activeCashFlow = parseInt(cashflowResult.total) || 0;

    // Estimated burn rate (average monthly debits over last 3 months)
    const burnResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.type = :type', { type: TransactionType.DEBIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .andWhere('tx.createdAt >= :start', { start: threeMonthsAgo })
      .getRawOne();
    const totalBurn3m = parseInt(burnResult.total) || 0;
    const estimatedBurnRate = Math.round(totalBurn3m / 3);

    // Compute trends by comparing to previous month
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const prevPayoutsResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.type = :type', { type: TransactionType.DEBIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .andWhere('tx.createdAt >= :start', { start: prevMonthStart })
      .andWhere('tx.createdAt <= :end', { end: prevMonthEnd })
      .getRawOne();
    const prevPayouts = parseInt(prevPayoutsResult.total) || 0;

    const prevCashflowResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.type = :type', { type: TransactionType.CREDIT })
      .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
      .andWhere('tx.createdAt >= :start', { start: prevMonthStart })
      .andWhere('tx.createdAt <= :end', { end: prevMonthEnd })
      .getRawOne();
    const prevCashflow = parseInt(prevCashflowResult.total) || 0;

    return {
      totalWalletBalance: {
        amount: totalWalletBalance,
        trend: this.computeTrend(totalWalletBalance, totalWalletBalance), // balance is a snapshot
      },
      monthlyPayouts: {
        amount: monthlyPayouts,
        trend: this.computeTrend(monthlyPayouts, prevPayouts),
      },
      activeCashFlow: {
        amount: activeCashFlow,
        trend: this.computeTrend(activeCashFlow, prevCashflow),
      },
      estimatedBurnRate: {
        amount: estimatedBurnRate,
        trend: estimatedBurnRate === 0 ? 'Stable' : this.computeTrend(estimatedBurnRate, Math.round(totalBurn3m / 3)),
      },
    };
  }

  private computeTrend(current: number, previous: number): string {
    if (previous === 0 && current === 0) return 'Stable';
    if (previous === 0) return '+100%';
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return 'Stable';
    return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  }

  // ─── Analytics / Cashflow Chart ────────────────────────────────────────────

  /**
   * Returns monthly cashflow vs burn data for the chart.
   * Looks back `months` number of months from the current date.
   */
  async getCashflowAnalytics(query: CashflowQueryDto) {
    const months = query.months || 6;
    const now = new Date();
    const results: { name: string; cashflow: number; burn: number }[] = [];

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = months - 1; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

      const cashflowResult = await this.transactionRepository
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.amount), 0)', 'total')
        .where('tx.type = :type', { type: TransactionType.CREDIT })
        .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
        .andWhere('tx.createdAt >= :start', { start: monthDate })
        .andWhere('tx.createdAt <= :end', { end: monthEnd })
        .getRawOne();

      const burnResult = await this.transactionRepository
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.amount), 0)', 'total')
        .where('tx.type = :type', { type: TransactionType.DEBIT })
        .andWhere('tx.status = :status', { status: TransactionStatus.SUCCESS })
        .andWhere('tx.createdAt >= :start', { start: monthDate })
        .andWhere('tx.createdAt <= :end', { end: monthEnd })
        .getRawOne();

      results.push({
        name: monthNames[monthDate.getMonth()],
        cashflow: parseInt(cashflowResult.total) || 0,
        burn: parseInt(burnResult.total) || 0,
      });
    }

    return results;
  }

  // ─── Funding Requests CRUD ─────────────────────────────────────────────────

  /**
   * List funding requests with pagination, filtering, and sorting.
   */
  async getRequests(query: FundingRequestQueryDto) {
    const { page = 1, limit = 10, status, sort = 'desc' } = query;
    const skip = (page - 1) * limit;

    const qb = this.fundingRequestRepository.createQueryBuilder('req');

    if (status) {
      qb.where('req.status = :status', { status });
    }

    qb.orderBy('req.createdAt', sort.toUpperCase() as 'ASC' | 'DESC');
    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((item) => ({
        id: item.id,
        amount: item.amount,
        date: item.date,
        description: item.description,
        status: item.status,
      })),
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Create a new funding request.
   */
  async createRequest(dto: CreateFundingRequestDto, adminId?: string) {
    const request = this.fundingRequestRepository.create({
      amount: dto.amount,
      date: dto.date,
      description: dto.description,
      status: FundingRequestStatus.PENDING,
      createdById: adminId || null,
    });

    const saved = await this.fundingRequestRepository.save(request);
    this.logger.log(`[FINANCE] Funding request created: ${saved.id} by admin ${adminId}`);

    return {
      id: saved.id,
      amount: saved.amount,
      date: saved.date,
      description: saved.description,
      status: saved.status,
    };
  }

  /**
   * Update a funding request (amount, description, date, or status).
   */
  async updateRequest(id: string, dto: UpdateFundingRequestDto) {
    const request = await this.fundingRequestRepository.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Funding request ${id} not found`);
    }

    if (dto.amount !== undefined) request.amount = dto.amount;
    if (dto.date !== undefined) request.date = dto.date;
    if (dto.description !== undefined) request.description = dto.description;
    if (dto.status !== undefined) request.status = dto.status;

    const updated = await this.fundingRequestRepository.save(request);
    this.logger.log(`[FINANCE] Funding request updated: ${id}`);

    return {
      id: updated.id,
      amount: updated.amount,
      date: updated.date,
      description: updated.description,
      status: updated.status,
    };
  }

  /**
   * Permanently delete a funding request.
   */
  async deleteRequest(id: string) {
    const request = await this.fundingRequestRepository.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Funding request ${id} not found`);
    }

    await this.fundingRequestRepository.remove(request);
    this.logger.log(`[FINANCE] Funding request deleted: ${id}`);

    return { success: true };
  }
}
