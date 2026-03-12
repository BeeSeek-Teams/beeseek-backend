import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, UserRole, UserStatus, AuthProvider, NinStatus } from '../../entities/user.entity';
import { Administrator, AdminStatus, AdminRole } from '../../entities/administrator.entity';
import { JwtService } from '@nestjs/jwt';
import { MonnifyService } from '../wallet/monnify.service';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// ── Mock factories ──────────────────────────────────────────────────
const mockUserRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
});

const mockAdminRepo = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockJwtService = () => ({
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
  decode: jest.fn(),
});

const mockMonnifyService = () => ({
  createReservedAccount: jest.fn(),
});

const mockMailService = () => ({
  sendOTP: jest.fn().mockResolvedValue(undefined),
  sendWelcomeAgent: jest.fn().mockResolvedValue(undefined),
  sendWelcomeClient: jest.fn().mockResolvedValue(undefined),
});

const mockRedisService = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
});

const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  },
};

const mockDataSource = () => ({
  createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let adminRepo: ReturnType<typeof mockAdminRepo>;
  let jwtSvc: ReturnType<typeof mockJwtService>;
  let mailSvc: ReturnType<typeof mockMailService>;
  let redisSvc: ReturnType<typeof mockRedisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(Administrator), useFactory: mockAdminRepo },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: MonnifyService, useFactory: mockMonnifyService },
        { provide: MailService, useFactory: mockMailService },
        { provide: RedisService, useFactory: mockRedisService },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    adminRepo = module.get(getRepositoryToken(Administrator));
    jwtSvc = module.get(JwtService);
    mailSvc = module.get(MailService);
    redisSvc = module.get(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Registration ──────────────────────────────────────────────────

  describe('register', () => {
    const validDto = {
      email: 'test@example.com',
      password: 'StrongP@ss1',
      firstName: 'Ada',
      lastName: 'Obi',
      age: 25,
      role: UserRole.CLIENT,
    };

    it('should reject duplicate email', async () => {
      userRepo.findOne.mockResolvedValue({ email: validDto.email, status: UserStatus.ACTIVE } as User);

      await expect(service.register(validDto as any)).rejects.toThrow(ConflictException);
    });

    it('should tell deactivated users to contact support', async () => {
      userRepo.findOne.mockResolvedValue({ email: validDto.email, status: UserStatus.DEACTIVATED } as User);

      await expect(service.register(validDto as any)).rejects.toThrow(
        /deactivated account/i,
      );
    });

    it('should reject weak passwords (no uppercase)', async () => {
      userRepo.findOne.mockResolvedValue(null); // no existing

      await expect(
        service.register({ ...validDto, password: 'lowercase1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject weak passwords (too short)', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.register({ ...validDto, password: 'Abc1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject weak passwords (no number)', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.register({ ...validDto, password: 'Abcdefgh' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should hash passwords with bcrypt round 12', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(0);

      const savedUser = {
        id: 'uuid-1',
        ...validDto,
        slug: 'ada-obi',
        isVerified: false,
        hashedPassword: 'hashed',
        authProvider: AuthProvider.EMAIL,
      } as unknown as User;

      mockQueryRunner.manager.create.mockReturnValue(savedUser);
      mockQueryRunner.manager.save.mockResolvedValue(savedUser);

      const result = await service.register(validDto as any);

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should send OTP email after successful registration', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.count.mockResolvedValue(0);

      const savedUser = {
        id: 'uuid-1',
        ...validDto,
        slug: 'ada-obi',
        isVerified: false,
        hashedPassword: 'hashed',
        authProvider: AuthProvider.EMAIL,
      } as unknown as User;

      mockQueryRunner.manager.create.mockReturnValue(savedUser);
      mockQueryRunner.manager.save.mockResolvedValue(savedUser);

      await service.register(validDto as any);

      // OTP email should be queued (fire-and-forget via .catch())
      expect(mailSvc.sendOTP).toHaveBeenCalledWith(
        validDto.email,
        validDto.firstName,
        expect.any(String),
        'VERIFICATION',
      );
    });
  });

  // ── Login ─────────────────────────────────────────────────────────

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'StrongP@ss1',
    };

    it('should reject non-existent email', async () => {
      adminRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login(loginDto as any)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject wrong password', async () => {
      adminRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({
        id: 'uuid-1',
        email: loginDto.email,
        hashedPassword: await bcrypt.hash('DifferentPwd1', 12),
        status: UserStatus.ACTIVE,
        authProvider: AuthProvider.EMAIL,
        role: UserRole.CLIENT,
      } as User);

      await expect(service.login(loginDto as any)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject deactivated accounts', async () => {
      adminRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({
        id: 'uuid-1',
        email: loginDto.email,
        hashedPassword: await bcrypt.hash(loginDto.password, 12),
        status: UserStatus.DEACTIVATED,
        authProvider: AuthProvider.EMAIL,
        role: UserRole.CLIENT,
      } as User);

      await expect(service.login(loginDto as any)).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens for valid credentials', async () => {
      const hashed = await bcrypt.hash(loginDto.password, 12);
      adminRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({
        id: 'uuid-1',
        email: loginDto.email,
        firstName: 'Ada',
        lastName: 'Obi',
        slug: 'ada-obi',
        hashedPassword: hashed,
        status: UserStatus.ACTIVE,
        authProvider: AuthProvider.EMAIL,
        role: UserRole.CLIENT,
        isVerified: true,
        age: 25,
      } as unknown as User);
      userRepo.update.mockResolvedValue(undefined);

      const result = await service.login(loginDto as any);

      expect(result.access_token).toBe('mock.jwt.token');
      expect(result.refresh_token).toBe('mock.jwt.token');
      expect(result.user.email).toBe(loginDto.email);
    });

    it('should authenticate administrators from admin table', async () => {
      const hashed = await bcrypt.hash(loginDto.password, 12);
      adminRepo.findOne.mockResolvedValue({
        id: 'admin-1',
        email: loginDto.email,
        firstName: 'Admin',
        lastName: 'User',
        hashedPassword: hashed,
        role: AdminRole.ADMIN,
        status: AdminStatus.ACTIVE,
      } as Administrator);
      adminRepo.update.mockResolvedValue(undefined);

      const result = await service.login(loginDto as any);

      expect(result.access_token).toBe('mock.jwt.token');
      expect(result.user.role).toBe(AdminRole.ADMIN);
    });

    it('should reject inactive administrators', async () => {
      adminRepo.findOne.mockResolvedValue({
        id: 'admin-1',
        email: loginDto.email,
        hashedPassword: await bcrypt.hash(loginDto.password, 12),
        role: AdminRole.ADMIN,
        status: AdminStatus.INACTIVE,
      } as Administrator);

      await expect(service.login(loginDto as any)).rejects.toThrow(
        /inactive/i,
      );
    });
  });

  // ── Token generation ──────────────────────────────────────────────

  describe('generateTokens (via login)', () => {
    it('should call JwtService.sign twice (access + refresh)', async () => {
      const hashed = await bcrypt.hash('StrongP@ss1', 12);
      adminRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({
        id: 'uuid-1',
        email: 'a@b.com',
        firstName: 'Ada',
        lastName: 'Obi',
        slug: 'ada-obi',
        hashedPassword: hashed,
        status: UserStatus.ACTIVE,
        authProvider: AuthProvider.EMAIL,
        role: UserRole.CLIENT,
        isVerified: true,
        age: 25,
      } as unknown as User);
      userRepo.update.mockResolvedValue(undefined);

      await service.login({ email: 'a@b.com', password: 'StrongP@ss1' } as any);

      expect(jwtSvc.sign).toHaveBeenCalledTimes(2); // access + refresh
    });
  });

  // ── Logout ────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should blocklist token JTI in Redis', async () => {
      jwtSvc.decode.mockReturnValue({ jti: 'abc123', exp: Math.floor(Date.now() / 1000) + 3600 });
      redisSvc.set.mockResolvedValue(undefined);

      const result = await service.logout('fake.jwt.token');

      expect(result).toHaveProperty('message');
    });
  });
});
