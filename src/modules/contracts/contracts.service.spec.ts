import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from './contracts.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Contract, ContractStatus, ServiceType } from '../../entities/contract.entity';
import { Bee } from '../../entities/bee.entity';
import { Job } from '../../entities/job.entity';
import { CancellationAudit } from '../../entities/cancellation-audit.entity';
import { ChatService } from '../chat/chat.service';
import { WalletService } from '../wallet/wallet.service';
import { SecurityService } from '../security/security.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DataSource } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '../../entities/user.entity';

// ── Mock factories ──────────────────────────────────────────────────
const createMockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn().mockImplementation((data) => data),
  save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'contract-1', ...entity })),
  count: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  }),
});

const mockChatService = () => ({
  getConversation: jest.fn().mockResolvedValue({
    participant1Id: 'client-1',
    participant2Id: 'agent-1',
  }),
  sendMessage: jest.fn().mockResolvedValue(undefined),
});

const mockWalletService = () => ({
  processPayment: jest.fn().mockResolvedValue({ id: 'tx-1' }),
});

const mockSecurityService = () => ({
  verifyTransactionPin: jest.fn().mockResolvedValue(true),
});

const mockMailService = () => ({
  sendContractNotification: jest.fn().mockResolvedValue(undefined),
});

const mockNotificationsService = () => ({
  notify: jest.fn(),
});

const createMockDataSource = () => ({
  transaction: jest.fn().mockImplementation(async (cb) => {
    const manager = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((_, data) => data),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'tx-1', ...entity })),
      update: jest.fn(),
    };
    return cb(manager);
  }),
});

describe('ContractsService', () => {
  let service: ContractsService;
  let contractRepo: ReturnType<typeof createMockRepo>;
  let beeRepo: ReturnType<typeof createMockRepo>;
  let chatSvc: ReturnType<typeof mockChatService>;
  let notifSvc: ReturnType<typeof mockNotificationsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: getRepositoryToken(Contract), useFactory: createMockRepo },
        { provide: getRepositoryToken(Bee), useFactory: createMockRepo },
        { provide: getRepositoryToken(Job), useFactory: createMockRepo },
        { provide: getRepositoryToken(CancellationAudit), useFactory: createMockRepo },
        { provide: ChatService, useFactory: mockChatService },
        { provide: WalletService, useFactory: mockWalletService },
        { provide: SecurityService, useFactory: mockSecurityService },
        { provide: MailService, useFactory: mockMailService },
        { provide: NotificationsService, useFactory: mockNotificationsService },
        { provide: DataSource, useFactory: createMockDataSource },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    contractRepo = module.get(getRepositoryToken(Contract));
    beeRepo = module.get(getRepositoryToken(Bee));
    chatSvc = module.get(ChatService);
    notifSvc = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── createRequest ─────────────────────────────────────────────────

  describe('createRequest', () => {
    const requestData = {
      details: 'Fix my plumbing',
      workDate: '2025-03-15',
      startTime: '10:00',
    };

    it('should throw if bee not found', async () => {
      beeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createRequest('client-1', 'bad-bee-id', requestData, 'room-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if inspection requested but bee does not offer it', async () => {
      beeRepo.findOne.mockResolvedValue({ id: 'bee-1', offersInspection: false });

      await expect(
        service.createRequest(
          'client-1',
          'bee-1',
          { ...requestData, type: ServiceType.INSPECTION },
          'room-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a pending contract and send notification', async () => {
      beeRepo.findOne.mockResolvedValue({ id: 'bee-1', offersInspection: true });

      const result = await service.createRequest('client-1', 'bee-1', requestData, 'room-1');

      expect(result).toHaveProperty('id');
      expect(result.status).toBe(ContractStatus.PENDING);
      expect(chatSvc.sendMessage).toHaveBeenCalled();
      expect(notifSvc.notify).toHaveBeenCalledWith(
        'agent-1',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ roomId: 'room-1' }),
      );
    });
  });

  // ── acceptRequest ─────────────────────────────────────────────────

  describe('acceptRequest', () => {
    const quoteData = {
      workmanshipCost: 5000, // ₦5,000
      transportFare: 1000,   // ₦1,000
      materials: [{ item: 'PVC Pipe', cost: 500 }],
    };

    it('should throw if contract not found', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(
        service.acceptRequest('agent-1', 'bad-id', quoteData, 'room-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if contract is not pending', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        status: ContractStatus.ACCEPTED,
      });

      await expect(
        service.acceptRequest('agent-1', 'c-1', quoteData, 'room-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject workmanship below ₦500 minimum', async () => {
      // Far future date to avoid expiry guard
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        status: ContractStatus.PENDING,
        workDate: '2099-12-31',
        startTime: '23:59',
      });

      await expect(
        service.acceptRequest('agent-1', 'c-1', { ...quoteData, workmanshipCost: 100 }, 'room-1'),
      ).rejects.toThrow(/Minimum workmanship/);
    });

    it('should calculate fees correctly and save contract', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        clientId: 'client-1',
        status: ContractStatus.PENDING,
        workDate: '2099-12-31',
        startTime: '23:59',
      });

      const result = await service.acceptRequest('agent-1', 'c-1', quoteData, 'room-1');

      // workmanship 5000 * 100 = 500000 Kobo
      expect(result.workmanshipCost).toBe(500000);
      // transport 1000 * 100 = 100000 Kobo
      expect(result.transportFare).toBe(100000);
      // materials 500 * 100 = 50000 Kobo
      // total = 500000 + 100000 + 50000 = 650000 Kobo
      expect(result.totalCost).toBe(650000);
      // service fee = 200 * 100 = 20000 Kobo
      expect(result.serviceFee).toBe(20000);
      // commission = 5% of 500000 = 25000 Kobo
      expect(result.commissionAmount).toBe(25000);
      expect(result.status).toBe(ContractStatus.ACCEPTED);
    });
  });

  // ── rejectRequest ─────────────────────────────────────────────────

  describe('rejectRequest', () => {
    it('should throw if contract not found', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(
        service.rejectRequest('agent-1', 'bad-id', 'room-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set status to REJECTED and notify client', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        clientId: 'client-1',
        status: ContractStatus.PENDING,
      });

      const result = await service.rejectRequest('agent-1', 'c-1', 'room-1');

      expect(result).toEqual({ success: true });
      expect(contractRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ContractStatus.REJECTED }),
      );
      expect(notifSvc.notify).toHaveBeenCalledWith(
        'client-1',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ contractId: 'c-1' }),
      );
    });
  });

  // ── getContract (IDOR protection) ─────────────────────────────────

  describe('getContract', () => {
    it('should throw if contract not found', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.getContract('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should allow participants to view their contract', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        clientId: 'client-1',
        agentId: 'agent-1',
      });

      const result = await service.getContract('c-1', { id: 'client-1', role: UserRole.CLIENT } as any);
      expect(result.id).toBe('c-1');
    });

    it('should block non-participants from viewing contract (IDOR)', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        clientId: 'client-1',
        agentId: 'agent-1',
      });

      await expect(
        service.getContract('c-1', { id: 'stranger-1', role: UserRole.CLIENT } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow admin to view any contract', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'c-1',
        clientId: 'client-1',
        agentId: 'agent-1',
      });

      const result = await service.getContract('c-1', { id: 'admin-1', role: UserRole.ADMIN } as any);
      expect(result.id).toBe('c-1');
    });
  });
});
