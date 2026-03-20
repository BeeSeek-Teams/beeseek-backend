import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository, In } from 'typeorm';
import { Job, JobStep, JobStatus } from '../../entities/job.entity';
import { ContractsService } from './contracts.service';
import { MailService } from '../mail/mail.service';
import dayjs from 'dayjs';

@Injectable()
export class AutoReleaseCron {
  private readonly logger = new Logger(AutoReleaseCron.name);

  constructor(
    @InjectRepository(Job)
    private jobRepository: Repository<Job>,
    private contractsService: ContractsService,
    private mailService: MailService,
  ) {}

  /**
   * Automatically release payments for jobs marked as FINISHED or HOME_SAFE for more than 48 hours.
   * Runs every hour to ensure high performance and low overhead.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoRelease() {
    this.logger.log('Starting Auto-Release check...');

    // 1. Find jobs finished > 48 hours ago that are not yet COMPLETED
    const cutoffDate = dayjs().subtract(48, 'hours').toDate();
    
    const candidates = await this.jobRepository.find({
      where: [
        {
          status: JobStatus.ACTIVE,
          currentStep: JobStep.FINISHED,
          finishedAt: LessThan(cutoffDate),
        },
        {
          status: JobStatus.ACTIVE,
          currentStep: JobStep.HOME_SAFE,
          homeSafeAt: LessThan(cutoffDate),
        }
      ],
      relations: ['contract', 'contract.client', 'contract.agent'],
    });

    if (candidates.length === 0) {
      this.logger.log('No eligible jobs found for auto-release.');
      return;
    }

    this.logger.log(`Found ${candidates.length} jobs eligible for auto-release.`);

    for (const job of candidates) {
      try {
        const { contract } = job;
        
        this.logger.log(`Auto-releasing payment for Contract #${contract.id}...`);

        // 2. Process Release (Internal call, skips PIN check)
        const result = await this.contractsService.processReleaseFunds(
          contract.id,
          contract.clientId,
        );

        // 3. Send Emails to Both Parties
        const amount = Number(contract.workmanshipCost) - Number(contract.commissionAmount);
        
        // Client Email
        await this.mailService.sendAutoReleaseNotification(
          contract.client.email,
          contract.client.firstName,
          'CLIENT',
          contract.id,
          amount,
        );

        // Agent Email
        await this.mailService.sendAutoReleaseNotification(
          contract.agent.email,
          contract.agent.firstName,
          'AGENT',
          contract.id,
          amount,
        );

        this.logger.log(`Successfully auto-released Contract #${contract.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to auto-release Job #${job.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log('Auto-Release check completed.');
  }
}
