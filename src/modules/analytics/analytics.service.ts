import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, Not, IsNull } from 'typeorm';
import { Bee } from '../../entities/bee.entity';
import { User, NinStatus } from '../../entities/user.entity';
import {
  BeeAnalytics,
  BeeAnalyticsEventType,
} from '../../entities/bee-analytics.entity';
import { Contract, ContractStatus } from '../../entities/contract.entity';
import { Job, JobStatus } from '../../entities/job.entity';
import { Review } from '../../entities/review.entity';
import dayjs from 'dayjs';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Bee)
    private beeRepository: Repository<Bee>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(BeeAnalytics)
    private analyticsRepository: Repository<BeeAnalytics>,
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(Job)
    private jobRepository: Repository<Job>,
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
    private dataSource: DataSource,
  ) {}

  /** Convert a period label to a start date, or null for all-time. */
  private periodToStartDate(period?: string): Date | null {
    if (!period) return null;
    const now = new Date();
    switch (period.toLowerCase()) {
      case 'today':
        return dayjs(now).startOf('day').toDate();
      case 'week':
        return dayjs(now).subtract(7, 'day').startOf('day').toDate();
      case 'month':
        return dayjs(now).subtract(30, 'day').startOf('day').toDate();
      case 'year':
        return dayjs(now).subtract(365, 'day').startOf('day').toDate();
      default:
        return null;
    }
  }

  private formatTime12h(time: string | Date): string {
    if (!time) return '';
    // If it's a date object
    if (time instanceof Date) {
        return dayjs(time).format('hh:mm A');
    }
    // If it's a time string (HH:mm:ss), prepend a dummy date for dayjs
    if (typeof time === 'string' && time.includes(':')) {
        return dayjs(`2000-01-01 ${time}`).format('hh:mm A');
    }
    return dayjs(time).format('hh:mm A');
  }

  private formatJobResponse(job: Job, role: 'CLIENT' | 'AGENT') {
    if (!job) return null;
    const isClient = role === 'CLIENT';
    const relationField = isClient ? 'agent' : 'client';
    const idField = isClient ? 'agentId' : 'clientId';
    const contract = job.contract;
    const otherParty = contract ? contract[relationField] : null;
    const otherPartyName = otherParty ? `${otherParty.firstName} ${otherParty.lastName}` : 'System';

    return {
      id: job.id,
      contractId: contract?.id,
      jobId: job.id, // for consistency with frontend expectations
      title: contract?.details?.split('\n')[0] || 'Service',
      details: contract?.details,
      status: job.status,
      currentStep: job.currentStep,
      date: contract ? dayjs(contract.workDate).format('MMM DD, YYYY') : '',
      startTime: contract ? this.formatTime12h(contract.startTime) : '',
      fullDateTime: contract ? `${dayjs(contract.workDate).format('MMM DD, YYYY')}, ${this.formatTime12h(contract.startTime)}` : '',
      createdAt: this.formatTime12h(job.createdAt),
      updatedAt: this.formatTime12h(job.updatedAt),
      totalCost: contract ? Number(contract.totalCost) : 0,
      [relationField]: otherParty,
      [idField]: contract ? contract[idField] : undefined, // Fallback ID for when relation is not loaded
      clientName: !isClient ? otherPartyName : undefined, // Agent app expects clientName
      workerName: isClient ? otherPartyName : undefined,  // Client app expects workerName
      otherPartyName, // generic
      bee: contract?.bee,
    };
  }

  async trackEvent(
    beeId: string,
    type: BeeAnalyticsEventType,
    userId?: string,
    metadata?: any,
  ) {
    const bee = await this.beeRepository.findOne({ where: { id: beeId } });
    if (!bee) throw new NotFoundException('Bee not found');

    // Run in a transaction to ensure both history and counters are updated
    return await this.dataSource.transaction(async (manager) => {
      // 1. Create history record
      const event = manager.create(BeeAnalytics, {
        beeId,
        type,
        userId,
        metadata,
      });
      await manager.save(event);

      // 2. Increment counters on the Bee entity based on event type
      switch (type) {
        case BeeAnalyticsEventType.VIEW:
          await manager.increment(Bee, { id: beeId }, 'totalViews', 1);
          break;
        case BeeAnalyticsEventType.HIRE:
          await manager.increment(Bee, { id: beeId }, 'totalHires', 1);
          break;
        case BeeAnalyticsEventType.COMPLETION:
          // We could track completions separately or use it to verify reliability
          break;
      }

      return { success: true };
    });
  }

  async getBeeStats(beeId: string, days: number = 30) {
    // This is for the Agent app to see their own stats
    const bee = await this.beeRepository.findOne({
      where: { id: beeId },
      select: ['totalViews', 'totalHires', 'totalRevenue'],
    });

    if (!bee) throw new NotFoundException('Bee not found');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get daily distribution for charts
    const history = await this.analyticsRepository
      .createQueryBuilder('analytics')
      .select("DATE_TRUNC('day', analytics.createdAt)", 'date')
      .addSelect('analytics.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('analytics.beeId = :beeId', { beeId })
      .andWhere('analytics.createdAt >= :startDate', { startDate })
      .groupBy("DATE_TRUNC('day', analytics.createdAt), analytics.type")
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      totals: bee,
      history,
    };
  }

  async getAgentOverview(agentId: string, period?: string) {
    const periodStart = this.periodToStartDate(period);

    // 1. Total Earnings + Tasks Done (SQL aggregate instead of loading all jobs)
    const earningsQb = this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .select('SUM(contract."totalCost" - contract."commissionAmount")', 'totalEarnings')
      .addSelect('COUNT(*)', 'tasksDone')
      .where('contract.agentId = :agentId', { agentId })
      .andWhere('job.status = :status', { status: JobStatus.COMPLETED });
    if (periodStart) earningsQb.andWhere('job.updatedAt >= :periodStart', { periodStart });
    const earningsResult = await earningsQb.getRawOne();

    const totalEarnings = parseInt(earningsResult?.totalEarnings || '0', 10);
    const tasksDone = parseInt(earningsResult?.tasksDone || '0', 10);

    // 3. Active Jobs (Status ACTIVE)
    const activeJobsCount = await this.jobRepository.count({
      where: { 
        contract: { agentId },
        status: JobStatus.ACTIVE
      },
    });

    // 4. Recurring Clients Count (Based on Jobs)
    const recurringClients = await this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .select('contract.clientId', 'clientId')
      .addSelect('COUNT(*)', 'jobCount')
      .where('contract.agentId = :agentId', { agentId })
      .groupBy('contract.clientId')
      .having('COUNT(*) > 1')
      .getRawMany();

    // 5. Weekly Revenue History (Based on period or last 7 days default)
    const historyStart = periodStart || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d;
    })();

    const revenueHistory = await this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .select("DATE_TRUNC('day', job.updatedAt)", 'date')
      .addSelect('SUM(contract.totalCost - contract.commissionAmount)', 'revenue')
      .where('contract.agentId = :agentId', { agentId })
      .andWhere('job.status = :status', { status: JobStatus.COMPLETED })
      .andWhere('job.updatedAt >= :historyStart', { historyStart })
      .groupBy("DATE_TRUNC('day', job.updatedAt)")
      .orderBy('date', 'ASC')
      .getRawMany();

    // 6. Recent Reviews
    const recentReviews = await this.dataSource.getRepository('Review').find({
      where: { revieweeId: agentId },
      order: { createdAt: 'DESC' },
      take: 5,
      relations: ['reviewer'],
    });

    const user = await this.userRepository.findOne({ where: { id: agentId } });

    // 7. Per-Bee Stats
    const bees = await this.beeRepository.find({
      where: { agentId },
      select: ['id', 'title', 'totalViews', 'totalHires', 'jobsCompleted', 'totalRevenue', 'category'],
    });

    // 8. Job Distribution by category
    const jobDistribution = await this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .innerJoin('contract.bee', 'bee')
      .select('bee.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('contract.agentId = :agentId', { agentId })
      .groupBy('bee.category')
      .getRawMany();

    return {
      totalEarnings,
      tasksDone,
      activeHires: activeJobsCount,
      recurringClientsCount: recurringClients.length,
      revenueHistory,
      recentReviews,
      rating: user?.rating || 0,
      bees,
      jobDistribution,
    };
  }

  async getClientOverview(clientId: string, period?: string) {
    const periodStart = this.periodToStartDate(period);

    // SQL aggregates instead of loading all jobs into memory
    const statsQb = this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .select('SUM(contract."totalCost" + contract."serviceFee")', 'totalSpent')
      .addSelect(`SUM(CASE WHEN job.status = '${JobStatus.COMPLETED}' THEN 1 ELSE 0 END)`, 'hiresDoneCount')
      .addSelect(`SUM(CASE WHEN job.status = '${JobStatus.ACTIVE}' THEN 1 ELSE 0 END)`, 'ongoingHiresCount')
      .where('contract.clientId = :clientId', { clientId });
    if (periodStart) statsQb.andWhere('job.updatedAt >= :periodStart', { periodStart });
    const statsResult = await statsQb.getRawOne();

    const totalSpent = parseInt(statsResult?.totalSpent || '0', 10);
    const hiresDoneCount = parseInt(statsResult?.hiresDoneCount || '0', 10);
    const ongoingHiresCount = parseInt(statsResult?.ongoingHiresCount || '0', 10);

    // 4. Recurring Agents Count (Based on Jobs)
    const recurringAgents = await this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .select('contract.agentId', 'agentId')
      .addSelect('COUNT(*)', 'jobCount')
      .where('contract.clientId = :clientId', { clientId })
      .groupBy('contract.agentId')
      .having('COUNT(*) > 1')
      .getRawMany();

    return {
      totalSpent,
      hiresDoneCount,
      ongoingHiresCount,
      recurringAgentsCount: recurringAgents.length,
    };
  }

  async getRecentHires(userId: string, role: string) {
    const isClient = role === 'CLIENT';
    const relationField = isClient ? 'agent' : 'client';
    const userIdField = isClient ? 'clientId' : 'agentId';

    const jobs = await this.jobRepository.find({
      where: {
        contract: { [userIdField]: userId }
      },
      relations: ['contract', `contract.${relationField}`, 'contract.bee'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return jobs.map(job => this.formatJobResponse(job, role as 'CLIENT' | 'AGENT'));
  }

  async getRecurringHires(userId: string, role: string) {
    const isClient = role === 'CLIENT';
    const userIdField = isClient ? 'clientId' : 'agentId';
    const otherPartyIdField = isClient ? 'agentId' : 'clientId';
    const relationField = isClient ? 'agent' : 'client';

    // First find IDs with > 1 job
    const recurringIds = await this.jobRepository
      .createQueryBuilder('job')
      .innerJoin('job.contract', 'contract')
      .select(`contract.${otherPartyIdField}`, 'id')
      .where(`contract.${userIdField} = :userId`, { userId })
      .groupBy(`contract.${otherPartyIdField}`)
      .having('COUNT(*) > 1')
      .getRawMany();

    if (recurringIds.length === 0) return [];

    const ids = recurringIds.map(r => r.id);

    // Get the actual jobs/agents for display (last one for each)
    const results = await Promise.all(ids.map(async (otherId) => {
      const lastJob = await this.jobRepository.findOne({
        where: { contract: { [userIdField]: userId, [otherPartyIdField]: otherId } },
        relations: ['contract', `contract.${relationField}`, 'contract.bee'],
        order: { createdAt: 'DESC' }
      });
      
      if (!lastJob) return null;

      const countRes = await this.jobRepository.count({
          where: { contract: { [userIdField]: userId, [otherPartyIdField]: otherId } }
      });

      return {
          ...this.formatJobResponse(lastJob, role as 'CLIENT' | 'AGENT'),
          jobCount: countRes,
          lastServiceDate: dayjs(lastJob.createdAt).format('MMM DD, YYYY')
      };
    }));

    return results.filter(r => r !== null);
  }

  async getUnratedJobs(userId: string, role: string) {
    const isClient = role === 'CLIENT';
    const userIdField = isClient ? 'clientId' : 'agentId';
    const relationField = isClient ? 'agent' : 'client';

    // Get all completed jobs for this user (status=COMPLETED OR completedAt is set)
    const completedJobs = await this.jobRepository.find({
      where: [
        { status: JobStatus.COMPLETED, contract: { [userIdField]: userId } },
        { completedAt: Not(IsNull()), contract: { [userIdField]: userId } },
      ],
      relations: ['contract', `contract.${relationField}`, 'contract.bee'],
      order: { updatedAt: 'DESC' },
    });

    if (completedJobs.length === 0) return [];

    // Get all reviews submitted by this user (or we could check for specific role if needed)
    const userReviews = await this.reviewRepository.find({
      where: { reviewerId: userId },
      select: ['jobId'],
    });

    const reviewedJobIds = new Set(userReviews.map(r => r.jobId));

    // Filter out jobs that have already been reviewed by this user
    const unratedJobs = completedJobs.filter(job => !reviewedJobIds.has(job.id));

    return unratedJobs.map(job => this.formatJobResponse(job, role as 'CLIENT' | 'AGENT'));
  }

  async getAdminDashboardStats() {
    const [totalUsers, pendingVerifications, activeJobs, totalJobs] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { ninStatus: NinStatus.PENDING } }),
      this.jobRepository.count({ where: { status: JobStatus.ACTIVE } }),
      this.jobRepository.count()
    ]);

    return {
      totalUsers,
      pendingVerifications,
      activeJobs,
      totalJobs
    };
  }

  async getPlatformDistributions() {
    const [beeCategories, userRoles, jobStatuses, ninStatuses] = await Promise.all([
      this.beeRepository
        .createQueryBuilder('bee')
        .select('bee.category', 'label')
        .addSelect('COUNT(*)', 'value')
        .groupBy('bee.category')
        .getRawMany(),
      this.userRepository
        .createQueryBuilder('user')
        .select('user.role', 'label')
        .addSelect('COUNT(*)', 'value')
        .groupBy('user.role')
        .getRawMany(),
      this.jobRepository
        .createQueryBuilder('job')
        .select('job.status', 'label')
        .addSelect('COUNT(*)', 'value')
        .groupBy('job.status')
        .getRawMany(),
      this.userRepository
        .createQueryBuilder('user')
        .select('user.ninStatus', 'label')
        .addSelect('COUNT(*)', 'value')
        .groupBy('user.ninStatus')
        .getRawMany(),
    ]);

    return {
      beeCategories: beeCategories.map(c => ({ label: c.label, value: Number(c.value) })),
      userRoles: userRoles.map(c => ({ label: c.label, value: Number(c.value) })),
      jobStatuses: jobStatuses.map(c => ({ label: c.label, value: Number(c.value) })),
      ninStatuses: ninStatuses.map(c => ({ label: c.label, value: Number(c.value) })),
    };
  }

  async getMapMarkers() {
    const [bees, users] = await Promise.all([
      this.beeRepository.find({
        select: ['id', 'title', 'latitude', 'longitude', 'category'],
        where: { isActive: true },
      }),
      this.userRepository.find({
        select: ['id', 'firstName', 'lastName', 'latitude', 'longitude', 'role'],
        where: { isDeleted: false },
      }),
    ]);

    const markers = [
      ...bees.map(b => ({
        id: b.id,
        lat: Number(b.latitude),
        lng: Number(b.longitude),
        type: 'bee',
        label: b.title,
        sublabel: b.category,
        color: '#FF6B35', // Orange for bees
      })),
      ...users.filter(u => u.latitude && u.longitude).map(u => {
        // Determine user type: agent or client
        const isAgent = u.role === 'AGENT';
        return {
          id: u.id,
          lat: Number(u.latitude),
          lng: Number(u.longitude),
          type: isAgent ? 'agent' : 'client',
          label: `${u.firstName} ${u.lastName}`,
          sublabel: isAgent ? 'Service Provider' : 'Client',
          color: isAgent ? '#4ECDC4' : '#1E90FF', // Teal for agents, Blue for clients
        };
      }),
    ];

    return markers;
  }
}
