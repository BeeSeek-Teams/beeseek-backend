import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import {
  Contract,
  ContractStatus,
  ServiceType,
} from '../../entities/contract.entity';
import { Job, JobStatus, JobStep } from '../../entities/job.entity';
import { CancellationAudit } from '../../entities/cancellation-audit.entity';
import { User, UserRole } from '../../entities/user.entity';
import { NotificationType } from '../../entities/notification.entity';
import { Bee } from '../../entities/bee.entity';
import { ChatService } from '../chat/chat.service';
import { WalletService } from '../wallet/wallet.service';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../../entities/transaction.entity';
import { SecurityService } from '../security/security.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import dayjs from 'dayjs';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(Bee)
    private beeRepository: Repository<Bee>,
    @InjectRepository(Job)
    private jobRepository: Repository<Job>,
    @InjectRepository(CancellationAudit)
    private auditRepository: Repository<CancellationAudit>,
    private chatService: ChatService,
    private walletService: WalletService,
    private securityService: SecurityService,
    private mailService: MailService,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  async createRequest(
    clientId: string,
    beeId: string,
    data: {
      type?: ServiceType;
      details: string;
      workDate: string;
      startTime: string;
      latitude?: number;
      longitude?: number;
      address?: string;
    },
    roomId: string,
  ) {
    // 1. Verify bee exists and supports inspection if requested
    const bee = await this.beeRepository.findOne({ where: { id: beeId } });
    if (!bee) throw new NotFoundException('Bee service not found');

    if (data.type === ServiceType.INSPECTION && !bee.offersInspection) {
      throw new BadRequestException(
        'This service provider does not offer physical inspections',
      );
    }

    // 2. Verify recipient is an agent
    const room = await this.chatService.getConversation(roomId, clientId);
    const agentId =
      room.participant1Id === clientId
        ? room.participant2Id
        : room.participant1Id;

    const contract = this.contractRepository.create({
      clientId,
      agentId,
      beeId,
      type: data.type || ServiceType.TASK,
      ...data,
      status: ContractStatus.PENDING,
    });

    const savedContract = await this.contractRepository.save(contract);

    // 2. Send system message to chat
    await this.chatService.sendMessage(
      roomId,
      clientId,
      `Service request sent for ${dayjs(data.workDate).format('MMM DD')}`,
      'service_request',
      undefined,
      savedContract.id,
    );

    // 3. Persistent Notification for Agent
    this.notificationsService.notify(
      agentId,
      'New Service Request',
      `You received a new request for ${data.workDate}`,
      NotificationType.JOB,
      {
        contractId: savedContract.id,
        roomId: roomId,
      },
    );

    return savedContract;
  }

  async acceptRequest(
    agentId: string,
    contractId: string,
    data: {
      workmanshipCost: number;
      transportFare: number;
      materials?: { item: string; cost: number }[];
    },
    roomId: string,
  ) {
    const contract = await this.contractRepository.findOne({
      where: { id: contractId, agentId },
    });

    if (!contract) throw new NotFoundException('Contract request not found');
    if (contract.status !== ContractStatus.PENDING) {
      throw new BadRequestException('Contract is not in a pending state');
    }

    // Expiry Guard: 30-minute window
    const now = new Date();
    const scheduledStart = new Date(`${contract.workDate}T${contract.startTime}:00`);
    const diffMins = (scheduledStart.getTime() - now.getTime()) / 60000;
    if (diffMins < 30) {
      throw new BadRequestException('This job request has expired and can no longer be accepted.');
    }

    // Convert inputs from Naira to Kobo for high-integrity storage
    const workmanshipKobo = Math.round(Number(data.workmanshipCost) * 100);
    const transportKobo = Math.round(Number(data.transportFare) * 100);

    // Minimum check on workmanship fee (₦500 = 50,000 Kobo)
    if (workmanshipKobo < 50000) {
      throw new BadRequestException('Minimum workmanship fee is ₦500. Quality services deserve fair pay.');
    }

    const materialsInKobo = (data.materials || []).map((m) => ({
      item: m.item,
      cost: Math.round(Number(m.cost) * 100),
    }));
    const totalMaterialsKobo = materialsInKobo.reduce(
      (sum, m) => sum + m.cost,
      0,
    );

    // Fee Calculation (Constants in Naira, convert to Kobo)
    const SERVICE_FEE_KOBO = 200 * 100; // Flat 200 Naira for client
    const COMMISSION_RATE = 0.05; // 5% on workmanship for agent
    const commissionAmountKobo = Math.round(workmanshipKobo * COMMISSION_RATE);
    const totalQuoteKobo = workmanshipKobo + transportKobo + totalMaterialsKobo;

    contract.workmanshipCost = workmanshipKobo;
    contract.transportFare = transportKobo;
    contract.materials = materialsInKobo as any; // Store Kobo in materials too for consistency
    contract.totalCost = totalQuoteKobo;
    contract.serviceFee = SERVICE_FEE_KOBO;
    contract.commissionRate = COMMISSION_RATE;
    contract.commissionAmount = commissionAmountKobo;
    contract.status = ContractStatus.ACCEPTED;

    const savedContract = await this.contractRepository.save(contract);

    // Update chat (Display in Naira for message)
    const displayTotalNaira = (totalQuoteKobo + SERVICE_FEE_KOBO) / 100;
    await this.chatService.sendMessage(
      roomId,
      agentId,
      `Sent a quote for the job: Total ₦${displayTotalNaira.toLocaleString()}`,
      'service_quote',
      undefined,
      savedContract.id,
    );

    // 3. Persistent Notification for Client
    this.notificationsService.notify(
      contract.clientId,
      'Quote Received',
      `Agent sent a quote for ₦${displayTotalNaira.toLocaleString()}`,
      NotificationType.JOB,
      {
        contractId: savedContract.id,
        roomId: roomId,
      },
    );

    return savedContract;
  }

  async rejectRequest(agentId: string, contractId: string, roomId: string) {
    const contract = await this.contractRepository.findOne({
      where: { id: contractId, agentId },
    });

    if (!contract) throw new NotFoundException('Contract request not found');

    contract.status = ContractStatus.REJECTED;
    await this.contractRepository.save(contract);

    await this.chatService.sendMessage(
      roomId,
      agentId,
      'Rejected the job request',
      'text',
      undefined,
      contract.id,
    );

    // 3. Persistent Notification for Client
    this.notificationsService.notify(
      contract.clientId,
      'Request Rejected',
      'Agent has declined your service request.',
      NotificationType.SYSTEM,
      {
        contractId: contract.id,
        roomId: roomId,
      },
    );

    return { success: true };
  }

  async getContract(id: string, caller?: User) {
    const contract = await this.contractRepository.findOne({
      where: { id },
      relations: ['bee', 'client', 'agent', 'job'],
    });
    if (!contract) throw new NotFoundException('Contract not found');

    // IDOR protection: only participants or admins may view
    if (caller) {
      const isAdmin = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT, UserRole.MODERATOR].includes(caller.role);
      if (!isAdmin && contract.clientId !== caller.id && contract.agentId !== caller.id) {
        throw new NotFoundException('Contract not found');
      }
    }

    return contract;
  }

  /**
   * Get contract data specifically for PDF generation.
   * Validates user access and returns only necessary fields.
   */
  async getContractForPdf(id: string, userId: string) {
    const contract = await this.contractRepository.findOne({
      where: { id },
      relations: ['bee', 'client', 'agent'],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // IDOR protection: only contract participants can download PDF
    // Use both direct FK and relation IDs for robustness
    const isClient = contract.clientId === userId || contract.client?.id === userId;
    const isAgent = contract.agentId === userId || contract.agent?.id === userId;
    if (!isClient && !isAgent) {
      throw new NotFoundException('Contract not found');
    }

    return contract;
  }

  async getMyContracts(userId: string, role: string, page: number = 1, limit: number = 20) {
    const isClient = role === 'CLIENT';
    const where = isClient ? { clientId: userId } : { agentId: userId };
    const [items, total] = await this.contractRepository.findAndCount({
      where,
      relations: ['agent', 'client', 'bee', 'job'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getMyJobs(userId: string, role: string, page: number = 1, limit: number = 10) {
    const isClient = role === 'CLIENT';
    const where = isClient
      ? { contract: { clientId: userId } }
      : { contract: { agentId: userId } };

    const [jobs, total] = await this.jobRepository.findAndCount({
      where,
      relations: ['contract', 'contract.agent', 'contract.client', 'contract.bee'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      jobs: jobs.map((job) => ({
        ...job,
        contract: {
          ...job.contract,
          startTime: job.contract?.startTime ? dayjs(`2000-01-01 ${job.contract.startTime}`).format('hh:mm A') : '',
          workDateFormatted: dayjs(job.contract?.workDate).format('MMM DD, YYYY'),
          fullDateTime: `${dayjs(job.contract?.workDate).format('MMM DD, YYYY')}, ${dayjs(`2000-01-01 ${job.contract.startTime}`).format('hh:mm A')}`
        },
        otherPartyName: isClient 
          ? `${job.contract?.agent?.firstName} ${job.contract?.agent?.lastName}`
          : `${job.contract?.client?.firstName} ${job.contract?.client?.lastName}`,
        date: dayjs(job.contract?.workDate).format('MMM DD, YYYY'),
        startTime: job.contract?.startTime ? dayjs(`2000-01-01 ${job.contract.startTime}`).format('hh:mm A') : '',
        fullDateTime: `${dayjs(job.contract?.workDate).format('MMM DD, YYYY')}, ${dayjs(`2000-01-01 ${job.contract.startTime}`).format('hh:mm A')}`
      })),
      total,
      page,
      limit
    };
  }

  async payForContract(
    clientId: string,
    contractId: string,
    roomId: string,
    pin: string,
  ) {
    // 0. Verify Transaction PIN first
    await this.securityService.verifyTransactionPin(clientId, pin);

    const result = await this.dataSource.transaction(async (manager) => {
      // 1. Get contract
      const contract = await manager.findOne(Contract, {
        where: { id: contractId, clientId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!contract) {
        throw new NotFoundException('Contract not found');
      }
      if (contract.status !== ContractStatus.ACCEPTED) {
        throw new BadRequestException(
          'Contract is not in an accepted state for payment',
        );
      }

      // Expiry Guard: 30-minute window
      const now = new Date();
      const scheduledStart = new Date(`${contract.workDate}T${contract.startTime}:00`);
      const diffMins = (scheduledStart.getTime() - now.getTime()) / 60000;
      if (diffMins < 30) {
        throw new BadRequestException('This quote has expired and can no longer be paid for.');
      }

      // 2. Calculate costs in Kobo (Already stored as Kobo now)
      const totalAmountKobo =
        Number(contract.totalCost) + Number(contract.serviceFee);

      // 3. Check client balance
      const client = await manager.findOne(User, {
        where: { id: clientId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!client) throw new NotFoundException('Client not found');

      if (client.walletBalance < totalAmountKobo) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      // 4. Implement Escrow Split for Agent (Values are in Kobo already)
      const workmanshipKobo = Number(contract.workmanshipCost);
      const commissionKobo = Number(contract.commissionAmount);
      const transportKobo = Number(contract.transportFare);
      const materialsKobo = (contract.materials || []).reduce(
        (sum, m) => sum + Number(m.cost),
        0,
      );

      const agentAvailableKobo = transportKobo + materialsKobo;
      const agentLockedKobo = workmanshipKobo - commissionKobo;

      const agent = await manager.findOne(User, {
        where: { id: contract.agentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!agent) throw new NotFoundException('Agent not found');

      // 5. Update Balances and Booking Status
      client.walletBalance -= totalAmountKobo;
      agent.walletBalance += agentAvailableKobo;
      agent.lockedBalance += agentLockedKobo;

      // Mark as booked
      agent.isBooked = true;
      agent.bookedDate = contract.workDate;
      agent.bookedTime = contract.startTime;

      await manager.save(client);
      await manager.save(agent);

      // 6. Update Contract Status
      contract.status = ContractStatus.PAID;
      await manager.save(contract);

      // 7. Create Job Record (The execution phase)
      const arrivalCode = Math.floor(1000 + Math.random() * 9000).toString();
      const job = manager.create(Job, {
        contractId: contract.id,
        status: JobStatus.ACTIVE,
        currentStep: JobStep.ALL_SET,
        arrivalCode: arrivalCode,
        paidAt: new Date(),
      });
      const savedJob = await manager.save(job);
      contract.job = savedJob;

      // NEW: Send chat message for payment confirmation
      await this.chatService.sendMessage(
        roomId,
        clientId,
        'Payment confirmed! Job is now active. Your arrival code is available in the job details.',
        'text',
        undefined,
        contract.id,
      );

      // 8. Record Transactions
      // Client Debit
      await manager.save(Transaction, {
        userId: clientId,
        contractId: contract.id,
        amount: totalAmountKobo,
        type: TransactionType.DEBIT,
        status: TransactionStatus.SUCCESS,
        description: `Payment for hire request #${contract.id.slice(0, 8)}`,
      });

      // Agent Credit Available
      if (agentAvailableKobo > 0) {
        await manager.save(Transaction, {
          userId: agent.id,
          contractId: contract.id,
          amount: agentAvailableKobo,
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESS,
          description: `Transport & Materials for hire request #${contract.id.slice(0, 8)}`,
        });
      }

      // Agent Credit Locked
      if (agentLockedKobo > 0) {
        await manager.save(Transaction, {
          userId: agent.id,
          contractId: contract.id,
          amount: agentLockedKobo,
          type: TransactionType.LOCKED,
          status: TransactionStatus.SUCCESS,
          description: `Workmanship (Locked) for hire request #${contract.id.slice(0, 8)}`,
        });
      }

      // 8. Record Platform Revenue (Audit/Finance)
      // Client Service Fee
      if (Number(contract.serviceFee) > 0) {
        await manager.save(Transaction, {
          userId: null,
          contractId: contract.id,
          amount: Number(contract.serviceFee),
          type: TransactionType.REVENUE,
          status: TransactionStatus.SUCCESS,
          description: `Client Service Fee from contract #${contract.id.slice(0, 8)}`,
          metadata: {
            serviceFee: Number(contract.serviceFee)
          }
        });
      }

      // Agent Commission
      if (commissionKobo > 0) {
        await manager.save(Transaction, {
          userId: null,
          contractId: contract.id,
          amount: commissionKobo,
          type: TransactionType.REVENUE,
          status: TransactionStatus.SUCCESS,
          description: `Agent Commission from contract #${contract.id.slice(0, 8)}`,
          metadata: {
            commissionAmount: commissionKobo
          }
        });
      }

      // Real-time broadcast of agent booking status
      this.chatService.broadcastAgentStatus(agent.id, {
        isBooked: agent.isBooked,
        bookedDate: agent.bookedDate,
        bookedTime: agent.bookedTime,
        isAvailable: agent.isAvailable,
      });

      // Persistent Notification for Agent (Payment Received)
      this.notificationsService.notify(
        agent.id,
        'Payment Received',
        `Client paid for hire request #${contract.id.slice(0, 8)}. Job is now active!`,
        NotificationType.PAYMENT,
        {
          contractId: contract.id,
          roomId: roomId,
        },
      );

      // Persistent Notification for Client (Payment Successful)
      this.notificationsService.notify(
        clientId,
        'Payment Successful',
        `Your payment for hire request #${contract.id.slice(0, 8)} was successful.`,
        NotificationType.PAYMENT,
        {
          contractId: contract.id,
          roomId: roomId,
        },
      );

      return contract;
    });

    // Return the full updated contract
    const finalContract = await this.getContract(contractId);
    return { success: true, contract: finalContract };
  }

  async getBusySlots(agentId: string, date: string) {
    // Fetch all active or accepted contracts for this agent on this date
    const contracts = await this.contractRepository.find({
      where: {
        agentId,
        workDate: date,
        status: In([
          ContractStatus.ACCEPTED,
          ContractStatus.PAID,
          ContractStatus.IN_PROGRESS,
        ]),
      },
      select: ['startTime'],
    });

    return contracts.map((c) => c.startTime);
  }

  async completeContract(clientId: string, contractId: string, pin: string) {
    // 1. Verify PIN
    await this.securityService.verifyTransactionPin(clientId, pin);

    const result = await this.processReleaseFunds(contractId, clientId);

    // 8. Generate and Send Professional Invoice via Email (OUTSIDE Transaction)
    // Invoice email failure should not roll back the financial transaction
    try {
      await this.mailService.sendInvoice(result.contract.client.email, result.contract.client.firstName, {
        contract: result.contract,
        transaction: result.transaction,
      });
    } catch (error) {
      // Logged by MailService internally
    }

    return result.contract;
  }

  /**
   * Internal method to process fund release logic.
   * Can be called by manual completion (with PIN) or auto-release cron.
   */
  async processReleaseFunds(contractId: string, clientId: string) {
    return await this.dataSource.transaction(async (manager) => {
      // 2. Get contract
      const contract = await manager.findOne(Contract, {
        where: { id: contractId, clientId },
        relations: ['agent', 'client'],
      });

      if (!contract) throw new BadRequestException('Contract not found');
      if (
        contract.status !== ContractStatus.PAID &&
        contract.status !== ContractStatus.IN_PROGRESS
      ) {
        throw new BadRequestException(
          'Contract is not in a state that can be completed',
        );
      }

      // 3. Get Agent
      const agent = await manager.findOne(User, {
        where: { id: contract.agentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!agent) throw new BadRequestException('Agent not found');

      // 4. Calculate amount to release (Workmanship - Commission)
      const releaseAmountKobo = Number(contract.workmanshipCost) - Number(contract.commissionAmount);

      if (agent.lockedBalance < releaseAmountKobo) {
        throw new BadRequestException(
          'Agent has insufficient locked funds for this release',
        );
      }

      // 5. Release funds (Locked -> Wallet) and Clear Booking status
      agent.lockedBalance -= releaseAmountKobo;
      agent.walletBalance += releaseAmountKobo;

      // Clear booking
      agent.isBooked = false;
      agent.bookedDate = null;
      agent.bookedTime = null;

      await manager.save(agent);

      // 6. Update contract status
      contract.status = ContractStatus.COMPLETED;
      await manager.save(contract);

      // Real-time broadcast
      this.chatService.broadcastAgentStatus(agent.id, {
        isBooked: false,
        bookedDate: null,
        bookedTime: null,
        isAvailable: agent.isAvailable,
      });

      // 7. Update linked job status if it exists
      const job = await manager.findOne(Job, { where: { contractId: contract.id } });
      if (job) {
        job.completedAt = new Date();
        await manager.save(job);
      }

      // 8. Record transaction for Agent
      const transaction = await manager.save(Transaction, {
        userId: agent.id,
        contractId: contract.id,
        amount: releaseAmountKobo,
        type: TransactionType.CREDIT,
        status: TransactionStatus.SUCCESS,
        description: `Escrow release: Workmanship for contract #${contract.id.slice(0, 8)}`,
      });

      // 10. Persistent Notification for Agent (Funds Released)
      const room = await this.chatService.getOrCreateRoom(contract.clientId, contract.agentId);
      this.notificationsService.notify(
        agent.id,
        'Escrow Released',
        `₦${releaseAmountKobo / 100} has been released to your wallet for contract #${contract.id.slice(0, 8)}`,
        NotificationType.PAYMENT,
        {
          contractId: contract.id,
          amount: releaseAmountKobo.toString(),
          roomId: room?.id,
        },
      );

      return { contract, transaction };
    });
  }

  async getJob(id: string, caller?: User) {
    const job = await this.jobRepository.findOne({
      where: { id },
      relations: [
        'contract',
        'contract.bee',
        'contract.client',
        'contract.agent',
        'reviews',
        'reviews.reviewer',
        'cancellationAudit',
        'cancellationAudit.cancelledBy',
      ],
    });
    if (!job) throw new NotFoundException('Job not found');

    // IDOR protection: only participants or admins may view
    if (caller) {
      const isAdmin = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT, UserRole.MODERATOR].includes(caller.role);
      if (!isAdmin && job.contract.clientId !== caller.id && job.contract.agentId !== caller.id) {
        throw new NotFoundException('Job not found');
      }
    }

    return job;
  }

  async updateJobStep(
    userId: string,
    jobId: string,
    data: { step: JobStep; arrivalCode?: string },
  ) {
    const job = await this.jobRepository.findOne({
      where: { id: jobId },
      relations: ['contract'],
    });

    if (!job) throw new NotFoundException('Job not found');

    if (job.contract.agentId !== userId) {
      throw new BadRequestException(
        'Only the assigned agent can update job steps',
      );
    }

    switch (data.step) {
      case JobStep.MATERIALS_PURCHASED:
        job.materialsPurchasedAt = new Date();
        break;
      case JobStep.ON_THE_WAY:
        job.onTheWayAt = new Date();
        break;
      case JobStep.ARRIVED:
      case JobStep.STARTED:
        if (data.arrivalCode !== job.arrivalCode) {
          throw new BadRequestException('Invalid arrival code');
        }
        if (!job.arrivedAt) job.arrivedAt = new Date();
        job.currentStep = JobStep.STARTED;
        job.startedAt = new Date();
        break;
      case JobStep.FINISHED:
        job.finishedAt = new Date();
        break;
      case JobStep.HOME_SAFE:
        job.homeSafeAt = new Date();
        break;
    }

    if (data.step !== JobStep.ARRIVED && data.step !== JobStep.STARTED) {
      job.currentStep = data.step;
    }

    const savedJob = await this.jobRepository.save(job);

    // 1. Get Room for Presence Guard
    const room = await this.chatService.getOrCreateRoom(job.contract.clientId, job.contract.agentId);

    // Sync contract status if necessary
    if (data.step === JobStep.STARTED || data.step === JobStep.ARRIVED) {
      await this.contractRepository.update(job.contractId, { status: ContractStatus.IN_PROGRESS });
    }

    // Emit real-time job update (Routing handled by chatService now)
    await this.chatService.sendJobUpdate(savedJob);

    // 2. Persistent Notification for Client
    let title = '';
    let body = '';
    switch (data.step) {
      case JobStep.MATERIALS_PURCHASED:
        title = 'Materials Purchased';
        body = 'Agent has purchased the materials for your job.';
        break;
      case JobStep.ON_THE_WAY:
        title = 'Agent on the way';
        body = 'Your service provider is heading to your location.';
        break;
      case JobStep.ARRIVED:
        title = 'Agent Arrived';
        body = 'Your service provider has arrived at the location.';
        break;
      case JobStep.STARTED:
        title = 'Job Started';
        body = 'Your service provider has started the work.';
        break;
      case JobStep.FINISHED:
        title = 'Job Completed';
        body = 'Agent has marked the job as finished. Please review and confirm.';
        break;
      case JobStep.HOME_SAFE:
        title = 'Agent Home Safe';
        body = 'Your service provider has reached home safely. Thank you for using BeeSeek!';
        break;
    }

    if (title) {
      this.notificationsService.notify(
        job.contract.clientId,
        title,
        body,
        NotificationType.JOB,
        {
          jobId: job.id,
          step: data.step,
          roomId: room?.id,
        },
      );
    }

    return savedJob;
  }

  async cancelJob(
    userId: string,
    jobId: string,
    reason: string,
    category?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(Job, {
        where: { id: jobId },
        relations: ['contract', 'contract.client', 'contract.agent'],
      });

      if (!job) throw new NotFoundException('Job not found');

      const isClient = job.contract.clientId === userId;
      const isAgent = job.contract.agentId === userId;

      if (!isClient && !isAgent) {
        throw new BadRequestException('Unauthorized to cancel this job');
      }

      // 1. Restriction: System prevents self-cancellation after STARTED
      // Party must contact support for escalation
      const forbiddenSteps = [JobStep.STARTED, JobStep.FINISHED, JobStep.HOME_SAFE];
      if (forbiddenSteps.includes(job.currentStep)) {
        throw new BadRequestException(
          'Job has already started or reached a critical phase. Please contact support to initiate an escalation.',
        );
      }

      if (job.status !== JobStatus.ACTIVE) {
        throw new BadRequestException('Job is already in a final state');
      }

      const client = job.contract.client;
      const agent = job.contract.agent;

      let refundedAmountKobo = 0;
      let agentRetentionKobo = 0;
      let isInfraction = false;

      // 2. Cancellation Logic
      const materialsKobo = (job.contract.materials || []).reduce(
        (sum, m) => sum + Number(m.cost),
        0,
      );
      const transportKobo = Number(job.contract.transportFare);
      const workmanshipKobo = Number(job.contract.workmanshipCost);
      const commissionKobo = Number(job.contract.commissionAmount);
      const serviceFeeKobo = Number(job.contract.serviceFee);

      const agentLockedKobo = workmanshipKobo - commissionKobo;
      const materialsAlreadyBought = !!job.materialsPurchasedAt;
      
      // If materials aren't bought yet, refund them to the client
      const materialRefundToClient = materialsAlreadyBought ? 0 : materialsKobo;
      const materialRetentionByAgent = materialsAlreadyBought ? materialsKobo : 0;

      if (isClient) {
        // CLIENT CANCELS
        // Policy: Agent keeps Transport as booking commitment fee (Non-refundable)
        // Workmanship & Service Fee & Unbought Materials -> Refunded to Client
        
        refundedAmountKobo = workmanshipKobo + materialRefundToClient;
        agentRetentionKobo = transportKobo + materialRetentionByAgent;

        // Move funds: 
        // 1. Return Locked Workmanship
        agent.lockedBalance -= agentLockedKobo;
        // 2. If materials weren't bought, take them back from Agent wallet
        if (materialRefundToClient > 0) {
          agent.walletBalance -= materialRefundToClient;
        }
        
        client.walletBalance += refundedAmountKobo;

        // Clear booking
        agent.isBooked = false;
        agent.bookedDate = null;
        agent.bookedTime = null;

        await manager.save(agent);
        await manager.save(client);

        this.chatService.broadcastAgentStatus(agent.id, {
          isBooked: false,
          bookedDate: null,
          bookedTime: null,
          isAvailable: agent.isAvailable,
        });

        // 8. Record Transactions
        await manager.save(Transaction, {
          userId: client.id,
          contractId: job.contractId,
          amount: refundedAmountKobo,
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESS,
          description: `Refund for hire #${job.contractId.slice(0, 8)} (${materialsAlreadyBought ? 'Less transport & materials' : 'Less transport'})`,
        });

        await manager.save(Transaction, {
          userId: agent.id,
          contractId: job.contractId,
          amount: agentLockedKobo,
          type: TransactionType.DEBIT,
          status: TransactionStatus.SUCCESS,
          description: `Contract Terminated: Workmanship returned to client`,
        });

        if (materialRefundToClient > 0) {
          await manager.save(Transaction, {
            userId: agent.id,
            contractId: job.contractId,
            amount: materialRefundToClient,
            type: TransactionType.DEBIT,
            status: TransactionStatus.SUCCESS,
            description: `Contract Terminated: Unused materials fund returned to client`,
          });
        }

        // 8.1 Reversal: Agent Commission
        if (commissionKobo > 0) {
          await manager.save(Transaction, {
            userId: null,
            contractId: job.contractId,
            amount: commissionKobo,
            type: TransactionType.REVENUE,
            status: TransactionStatus.SUCCESS,
            description: `Reversal: Agent Commission from contract #${job.contractId.slice(0, 8)}`,
            metadata: {
              commissionAmount: -commissionKobo
            }
          });
        }
      } else {
        // AGENT CANCELS
        // Policy: Agent keeps Transport, but MUST return unbought materials.
        
        refundedAmountKobo = workmanshipKobo + serviceFeeKobo + materialRefundToClient;
        agentRetentionKobo = transportKobo + materialRetentionByAgent;
        isInfraction = true;

        // Move funds
        agent.lockedBalance -= agentLockedKobo;
        if (materialRefundToClient > 0) {
          agent.walletBalance -= materialRefundToClient;
        }
        
        client.walletBalance += refundedAmountKobo;

        // Clear booking
        agent.isBooked = false;
        agent.bookedDate = null;
        agent.bookedTime = null;

        await manager.save(agent);
        await manager.save(client);

        this.chatService.broadcastAgentStatus(agent.id, {
          isBooked: false,
          bookedDate: null,
          bookedTime: null,
          isAvailable: agent.isAvailable,
        });

        // 8. Record Transactions
        await manager.save(Transaction, {
          userId: client.id,
          contractId: job.contractId,
          amount: refundedAmountKobo,
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESS,
          description: `Partial refund for hire #${job.contractId.slice(0, 8)} (Agent cancelled - Transport retained)`,
        });

        await manager.save(Transaction, {
          userId: agent.id,
          contractId: job.contractId,
          amount: agentLockedKobo,
          type: TransactionType.DEBIT,
          status: TransactionStatus.SUCCESS,
          description: `Contract Terminated: Workmanship returned to client`,
        });

        if (materialRefundToClient > 0) {
          await manager.save(Transaction, {
            userId: agent.id,
            contractId: job.contractId,
            amount: materialRefundToClient,
            type: TransactionType.DEBIT,
            status: TransactionStatus.SUCCESS,
            description: `Contract Terminated: Unused materials fund returned to client`,
          });
        }

        // 8.1 Reversal: Agent Commission
        if (commissionKobo > 0) {
          await manager.save(Transaction, {
            userId: null,
            contractId: job.contractId,
            amount: commissionKobo,
            type: TransactionType.REVENUE,
            status: TransactionStatus.SUCCESS,
            description: `Reversal: Agent Commission from contract #${job.contractId.slice(0, 8)}`,
            metadata: {
              commissionAmount: -commissionKobo
            }
          });
        }

        if (serviceFeeKobo > 0) {
          await manager.save(Transaction, {
            userId: null,
            contractId: job.contractId,
            amount: serviceFeeKobo,
            type: TransactionType.REVENUE,
            status: TransactionStatus.SUCCESS,
            description: `Reversal: Service Fee refund for hire #${job.contractId.slice(0, 8)}`,
            metadata: {
              serviceFee: -serviceFeeKobo
            }
          });
        }
      }

      // 3. Create Audit Record
      const audit = manager.create(CancellationAudit, {
        jobId: job.id,
        cancelledById: userId,
        reason,
        category,
        isAgentInfraction: isInfraction,
        refundedAmount: refundedAmountKobo, // Stored in Kobo for consistency
        agentRetention: agentRetentionKobo, // Stored in Kobo for consistency
      });
      await manager.save(audit);

      // 4. Update Statuses
      job.status = JobStatus.CANCELLED;
      await manager.save(job);

      await manager.update(Contract, job.contractId, {
        status: ContractStatus.CANCELLED,
      });

      // 5. Emit Update
      await this.chatService.sendJobUpdate(job);

      // 6. Persistent Notification for the other party
      const recipientId = isClient ? job.contract.agentId : job.contract.clientId;
      const cancelerType = isClient ? 'Client' : 'Agent';
      const room = await this.chatService.getOrCreateRoom(job.contract.clientId, job.contract.agentId);
      
      this.notificationsService.notify(
        recipientId,
        'Job Cancelled',
        `${cancelerType} has cancelled the job #${job.contractId.slice(0, 8)}. Reason: ${reason}`,
        NotificationType.SYSTEM,
        {
          jobId: job.id,
          cancelledBy: userId,
          roomId: room?.id,
        },
      );

      return job;
    });
  }

  async updateJobStatus(
    caller: User,
    jobId: string,
    data: { status: JobStatus },
  ) {
    const job = await this.jobRepository.findOne({
      where: { id: jobId },
      relations: ['contract'],
    });

    if (!job) throw new NotFoundException('Job not found');

    const isAdmin = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT, UserRole.MODERATOR].includes(caller.role);

    // Only parties involved or admins can update status
    if (
      !isAdmin &&
      job.contract.agentId !== caller.id &&
      job.contract.clientId !== caller.id
    ) {
      throw new BadRequestException('Unauthorized to update job status');
    }

    job.status = data.status;
    const savedJob = await this.jobRepository.save(job);

    // Sync contract
    if (data.status === JobStatus.CANCELLED) {
      await this.contractRepository.update(job.contractId, {
        status: ContractStatus.CANCELLED,
      });
    }

    // Special handling for Escalation - notify parties
    if (data.status === JobStatus.ESCALATED) {
      // Job escalation is handled by admin
      
      // Notify Agent
      this.notificationsService.notify(
        job.contract.agentId,
        'Job Escalated',
        `Job #${job.id.slice(0, 8)} has been escalated for review by BeeSeek support.`,
        NotificationType.SYSTEM,
        { jobId: job.id }
      );

      // Notify Client
      this.notificationsService.notify(
        job.contract.clientId,
        'Job Escalated',
        `Job #${job.id.slice(0, 8)} has been escalated for review. Support will contact you if needed.`,
        NotificationType.SYSTEM,
        { jobId: job.id }
      );
    }

    // Emit real-time job update
    await this.chatService.sendJobUpdate(savedJob);

    return savedJob;
  }

  async getAdminJobs(options: {
    page: number;
    limit: number;
    status?: JobStatus;
    search?: string;
  }) {
    const { page, limit, status, search } = options;
    const query = this.jobRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('contract.agent', 'agent')
      .leftJoinAndSelect('contract.bee', 'bee')
      .orderBy('job.createdAt', 'DESC');

    if (status) {
      query.andWhere('job.status = :status', { status });
    }

    if (search) {
      query.andWhere(
        '(contract.details ILIKE :search OR client.firstName ILIKE :search OR client.lastName ILIKE :search OR agent.firstName ILIKE :search OR agent.lastName ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [items, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

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

  async getAdminInfractions(options: { page: number; limit: number }) {
    const { page, limit } = options;
    const [items, total] = await this.jobRepository
      .createQueryBuilder('job')
      .innerJoinAndSelect('job.cancellationAudit', 'audit')
      .innerJoinAndSelect('job.contract', 'contract')
      .innerJoinAndSelect('contract.agent', 'agent')
      .innerJoinAndSelect('contract.client', 'client')
      .where('audit.isAgentInfraction = :isInfraction', { isInfraction: true })
      .orderBy('audit.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

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
}
