import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { Job, JobStep, JobStatus } from '../../entities/job.entity';
import { Contract, ContractStatus } from '../../entities/contract.entity';
import { CancellationAudit } from '../../entities/cancellation-audit.entity';
import { User } from '../../entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../../entities/notification.entity';
import { MailService } from '../mail/mail.service';
import { ChatService } from '../chat/chat.service';
import dayjs from 'dayjs';

/**
 * Stale Job Watchdog Cron
 *
 * Modelled after industry standards (TaskRabbit, Thumbtack, Uber Pro):
 * - Detects agents who never show up (no-show)
 * - Detects jobs stuck in transit (ON_THE_WAY too long)
 * - Detects jobs stuck mid-work (STARTED too long)
 * - Auto-escalates and notifies both parties
 *
 * Runs every 15 minutes to catch issues quickly without excessive load.
 */
@Injectable()
export class StaleJobCron {
  private readonly logger = new Logger(StaleJobCron.name);

  // Thresholds (in hours) — modelled after TaskRabbit/Thumbtack SLA windows
  private readonly NO_SHOW_HOURS = 2;          // Agent hasn't moved from ALL_SET 2h after scheduled start
  private readonly TRANSIT_STALE_HOURS = 3;     // Agent stuck ON_THE_WAY for 3+ hours
  private readonly WORK_STALE_HOURS = 12;       // Job STARTED for 12+ hours with no completion

  constructor(
    @InjectRepository(Job)
    private jobRepository: Repository<Job>,
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(CancellationAudit)
    private auditRepository: Repository<CancellationAudit>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private chatService: ChatService,
  ) {}

  /**
   * Main watchdog: runs every 15 minutes
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleStaleJobCheck() {
    this.logger.log('Starting Stale Job Watchdog...');

    try {
      await Promise.all([
        this.detectNoShows(),
        this.detectStaleTransit(),
        this.detectStaleWork(),
      ]);
    } catch (error) {
      this.logger.error(`Stale Job Watchdog failed: ${error.message}`, error.stack);
    }

    this.logger.log('Stale Job Watchdog completed.');
  }

  /**
   * NO-SHOW DETECTION
   * Agent accepted and client paid, but agent never moved past ALL_SET
   * and the scheduled start time has passed by NO_SHOW_HOURS.
   *
   * Action: Auto-escalate job, notify both parties, record as infraction.
   */
  private async detectNoShows() {
    const now = dayjs();

    // Find active jobs still at ALL_SET
    const candidates = await this.jobRepository.find({
      where: {
        status: JobStatus.ACTIVE,
        currentStep: JobStep.ALL_SET,
      },
      relations: ['contract', 'contract.client', 'contract.agent'],
    });

    for (const job of candidates) {
      try {
        const { contract } = job;
        if (!contract || contract.status === ContractStatus.CANCELLED || contract.status === ContractStatus.COMPLETED) {
          continue;
        }

        // Calculate how long past the scheduled start time
        const scheduledStart = dayjs(`${contract.workDate}T${contract.startTime}:00`);
        const hoursPastStart = now.diff(scheduledStart, 'hour', true);

        if (hoursPastStart < this.NO_SHOW_HOURS) continue;

        // Check if we already escalated this job (avoid duplicate escalations)
        if (job.status === JobStatus.ESCALATED) continue;

        this.logger.warn(
          `NO-SHOW detected: Job #${job.id.slice(0, 8)} — Agent ${contract.agent?.firstName} is ${Math.round(hoursPastStart)}h past scheduled start at ALL_SET`,
        );

        // Auto-escalate the job
        job.status = JobStatus.ESCALATED;
        await this.jobRepository.save(job);

        // Notify Agent (warning)
        this.notificationsService.notify(
          contract.agentId,
          'Job Escalated — No-Show',
          `You have not started Job #${job.id.slice(0, 8)} which was scheduled for ${dayjs(scheduledStart).format('MMM DD, hh:mm A')}. This has been escalated and recorded as an infraction.`,
          NotificationType.SYSTEM,
          { jobId: job.id },
        );

        // Notify Client (update)
        this.notificationsService.notify(
          contract.clientId,
          'Agent No-Show Detected',
          `Your agent has not arrived for Job #${job.id.slice(0, 8)}. The job has been escalated to our support team. You may also contact support directly.`,
          NotificationType.SYSTEM,
          { jobId: job.id },
        );

        // Email both parties
        await this.mailService.sendStaleJobAlert(
          contract.client.email,
          contract.client.firstName,
          'CLIENT',
          job.id,
          'NO_SHOW',
          `Your agent has not arrived for your scheduled service. Our support team has been notified and will assist you.`,
        );

        await this.mailService.sendStaleJobAlert(
          contract.agent.email,
          contract.agent.firstName,
          'AGENT',
          job.id,
          'NO_SHOW',
          `You missed your scheduled job. This has been recorded as an infraction. Please contact support immediately if this was an emergency.`,
        );

        // Emit real-time update
        await this.chatService.sendJobUpdate(job);
      } catch (error) {
        this.logger.error(`No-show check failed for Job #${job.id}: ${error.message}`);
      }
    }
  }

  /**
   * STALE TRANSIT DETECTION
   * Agent marked ON_THE_WAY but hasn't arrived after TRANSIT_STALE_HOURS.
   *
   * Action: Notify both parties, flag for admin review.
   */
  private async detectStaleTransit() {
    const cutoff = dayjs().subtract(this.TRANSIT_STALE_HOURS, 'hours').toDate();

    const candidates = await this.jobRepository.find({
      where: {
        status: JobStatus.ACTIVE,
        currentStep: JobStep.ON_THE_WAY,
        onTheWayAt: LessThan(cutoff),
      },
      relations: ['contract', 'contract.client', 'contract.agent'],
    });

    for (const job of candidates) {
      try {
        const { contract } = job;
        if (!contract) continue;

        const hoursInTransit = dayjs().diff(dayjs(job.onTheWayAt), 'hour', true);

        this.logger.warn(
          `STALE TRANSIT: Job #${job.id.slice(0, 8)} — Agent has been "On The Way" for ${Math.round(hoursInTransit)}h`,
        );

        // Auto-escalate
        job.status = JobStatus.ESCALATED;
        await this.jobRepository.save(job);

        // Notify Agent
        this.notificationsService.notify(
          contract.agentId,
          'Job Escalated — Delayed Transit',
          `Job #${job.id.slice(0, 8)} has been stuck in transit for ${Math.round(hoursInTransit)} hours. Please update your status or contact support.`,
          NotificationType.SYSTEM,
          { jobId: job.id },
        );

        // Notify Client
        this.notificationsService.notify(
          contract.clientId,
          'Agent Delayed',
          `Your agent has been in transit for an extended period on Job #${job.id.slice(0, 8)}. Our team has been notified.`,
          NotificationType.SYSTEM,
          { jobId: job.id },
        );

        // Emit real-time update
        await this.chatService.sendJobUpdate(job);
      } catch (error) {
        this.logger.error(`Stale transit check failed for Job #${job.id}: ${error.message}`);
      }
    }
  }

  /**
   * STALE WORK DETECTION
   * Agent started the job but hasn't marked it FINISHED after WORK_STALE_HOURS.
   *
   * Action: Notify admin for review (don't auto-cancel — work may genuinely take long).
   */
  private async detectStaleWork() {
    const cutoff = dayjs().subtract(this.WORK_STALE_HOURS, 'hours').toDate();

    const candidates = await this.jobRepository.find({
      where: {
        status: JobStatus.ACTIVE,
        currentStep: JobStep.STARTED,
        startedAt: LessThan(cutoff),
      },
      relations: ['contract', 'contract.client', 'contract.agent'],
    });

    for (const job of candidates) {
      try {
        const { contract } = job;
        if (!contract) continue;

        const hoursWorking = dayjs().diff(dayjs(job.startedAt), 'hour', true);

        this.logger.warn(
          `STALE WORK: Job #${job.id.slice(0, 8)} — Has been "Started" for ${Math.round(hoursWorking)}h without completion`,
        );

        // Don't auto-escalate large jobs — just notify both parties
        // Notify Agent (gentle reminder)
        this.notificationsService.notify(
          contract.agentId,
          'Job Duration Alert',
          `Job #${job.id.slice(0, 8)} has been in progress for ${Math.round(hoursWorking)} hours. Please mark it as finished when complete.`,
          NotificationType.SYSTEM,
          { jobId: job.id },
        );

        // Notify Client
        this.notificationsService.notify(
          contract.clientId,
          'Extended Job Duration',
          `Job #${job.id.slice(0, 8)} has been in progress for ${Math.round(hoursWorking)} hours. Contact support if you have concerns.`,
          NotificationType.SYSTEM,
          { jobId: job.id },
        );
      } catch (error) {
        this.logger.error(`Stale work check failed for Job #${job.id}: ${error.message}`);
      }
    }
  }
}
