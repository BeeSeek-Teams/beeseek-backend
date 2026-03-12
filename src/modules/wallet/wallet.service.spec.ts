import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Transaction, TransactionType, TransactionStatus } from '../../entities/transaction.entity';
import { UserBank } from '../../entities/user-bank.entity';
import { SecurityService } from '../security/security.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MonnifyService } from './monnify.service';
import { MailService } from '../mail/mail.service';
import { PromotionsService } from '../promotions/promotions.service';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

// ── Mock factories ──────────────────────────────────────────────────
const mockUserRepo = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
});

const mockTransactionRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({}),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  }),
});

const mockUserBankRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockSecurityService = () => ({
  verifyTransactionPin: jest.fn().mockResolvedValue(true),
});

const mockNotificationsService = () => ({
  notify: jest.fn(),
});

const mockMonnifyService = () => ({
  initiateTransfer: jest.fn().mockResolvedValue({ transactionReference: 'monnify-ref' }),
  getBanks: jest.fn().mockResolvedValue([]),
  validateAccount: jest.fn().mockResolvedValue({ accountName: 'Test User' }),
});

const mockMailService = () => ({
  sendWithdrawalNotification: jest.fn().mockResolvedValue(undefined),
});

const mockPromotionsService = () => ({
  findActiveByType: jest.fn().mockResolvedValue(null),
  evaluatePromotions: jest.fn().mockResolvedValue(null),
});

// Simulate DataSource.transaction()
const createMockDataSource = () => {
  const mockManager = {
    findOne: jest.fn(),
    create: jest.fn().mockImplementation((_, data) => data),
    save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'tx-1', ...entity })),
  };

  return {
    transaction: jest.fn().mockImplementation(async (cb) => cb(mockManager)),
    _manager: mockManager,
  };
};

describe('WalletService', () => {
  let service: WalletService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let txRepo: ReturnType<typeof mockTransactionRepo>;
  let dataSource: ReturnType<typeof createMockDataSource>;
  let securitySvc: ReturnType<typeof mockSecurityService>;

  beforeEach(async () => {
    dataSource = createMockDataSource();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(Transaction), useFactory: mockTransactionRepo },
        { provide: getRepositoryToken(UserBank), useFactory: mockUserBankRepo },
        { provide: SecurityService, useFactory: mockSecurityService },
        { provide: NotificationsService, useFactory: mockNotificationsService },
        { provide: MonnifyService, useFactory: mockMonnifyService },
        { provide: MailService, useFactory: mockMailService },
        { provide: PromotionsService, useFactory: mockPromotionsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    userRepo = module.get(getRepositoryToken(User));
    txRepo = module.get(getRepositoryToken(Transaction));
    securitySvc = module.get(SecurityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getBalance ────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('should return user balance', async () => {
      userRepo.findOne.mockResolvedValue({
        walletBalance: 500000,
        lockedBalance: 100000,
      });

      const result = await service.getBalance('user-1');

      expect(result.availableBalance).toBe(500000);
      expect(result.lockedBalance).toBe(100000);
    });

    it('should throw if user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getBalance('nonexistent')).rejects.toThrow(BadRequestException);
    });
  });

  // ── processPayment ────────────────────────────────────────────────

  describe('processPayment', () => {
    it('should credit user wallet successfully', async () => {
      const user = { id: 'user-1', walletBalance: 500000, lockedBalance: 0 };
      dataSource._manager.findOne.mockResolvedValue(user);

      const result = await service.processPayment(
        'user-1',
        100000,
        TransactionType.CREDIT,
        'Test credit',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('should reject debit when balance insufficient', async () => {
      const user = { id: 'user-1', walletBalance: 50000, lockedBalance: 0 };
      dataSource._manager.findOne.mockResolvedValue(user);

      await expect(
        service.processPayment('user-1', 100000, TransactionType.DEBIT, 'Test debit'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return existing transaction for duplicate idempotency key', async () => {
      const existingTx = { id: 'tx-existing', amount: 100000 };
      dataSource._manager.findOne.mockResolvedValue(existingTx);

      const result = await service.processPayment(
        'user-1',
        100000,
        TransactionType.CREDIT,
        'Duplicate',
        'idempotency-key-1',
      );

      expect(result).toEqual(existingTx);
    });

    it('should throw if user not found during payment', async () => {
      // First call (idempotency check) returns null, second call (user) returns null
      dataSource._manager.findOne
        .mockResolvedValueOnce(null)  // no existing idempotency
        .mockResolvedValueOnce(null); // user not found

      await expect(
        service.processPayment('bad-id', 100000, TransactionType.CREDIT, 'Test'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── withdraw ──────────────────────────────────────────────────────

  describe('withdraw', () => {
    const bankDetails = {
      bankName: 'GTBank',
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Test User',
    };

    it('should reject amounts below ₦1,000 minimum', async () => {
      await expect(
        service.withdraw('user-1', 50000, bankDetails, '1234'),
      ).rejects.toThrow(/Minimum withdrawal/);
    });

    it('should verify PIN before withdrawal', async () => {
      const user = {
        id: 'user-1',
        walletBalance: 1000000,
        lockedBalance: 0,
        monnifyAccountId: 'monnify-1',
        firstName: 'Ada',
        email: 'a@b.com',
      };
      // No idempotency key provided so only the user lock findOne is called
      dataSource._manager.findOne.mockResolvedValue(user);

      await service.withdraw('user-1', 100000, bankDetails, '1234');

      expect(securitySvc.verifyTransactionPin).toHaveBeenCalledWith('user-1', '1234');
    });
  });

  // ── getTransactions ───────────────────────────────────────────────

  describe('getTransactions', () => {
    it('should return last 50 transactions ordered by date', async () => {
      const transactions = [{ id: 'tx-1' }, { id: 'tx-2' }];
      txRepo.find.mockResolvedValue(transactions);

      const result = await service.getTransactions('user-1');

      expect(result).toEqual(transactions);
      expect(txRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    });
  });
});
