import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, LessThan } from 'typeorm';
import { User, UserStatus, UserRole, NinStatus } from '../../entities/user.entity';
import { Administrator, AdminRole, AdminStatus } from '../../entities/administrator.entity';
import { Contract, ContractStatus } from '../../entities/contract.entity';
import { Bee } from '../../entities/bee.entity';
import { Review } from '../../entities/review.entity';
import { Transaction } from '../../entities/transaction.entity';
import { Notification } from '../../entities/notification.entity';
import { MailService } from '../mail/mail.service';
import { MonnifyService } from '../wallet/monnify.service';
import { BackgroundCheckService } from '../../common/services/background-check.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { UpdateProfileDto } from '../../dto/update-profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Administrator)
    private adminRepository: Repository<Administrator>,
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(Bee)
    private beesRepository: Repository<Bee>,
    @InjectRepository(Review)
    private reviewsRepository: Repository<Review>,
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    @InjectRepository(Notification)
    private notificationsRepository: Repository<Notification>,
    private mailService: MailService,
    private monnifyService: MonnifyService,
    private backgroundCheckService: BackgroundCheckService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleAccountPurge() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const accountsToPurge = await this.usersRepository.find({
      where: {
        status: UserStatus.DEACTIVATED,
        deactivatedAt: LessThan(thirtyDaysAgo),
        isDeleted: false,
      },
    });

    for (const user of accountsToPurge) {
      this.logger.warn(`[AccountPurge] Scrubbing PII for user: ${user.id}`);

      // 1. Delete all Bees associated with this agent
      await this.beesRepository.delete({ agentId: user.id });

      // 2. Hard Scrub (PII Removal) - Irreversible destruction of identity
      await this.usersRepository.update(user.id, {
        firstName: 'BeeSeek',
        lastName: 'Member',
        email: `scrubbed-${user.id.substring(0, 8)}@deleted.me`,
        slug: null,
        phone: null,
        ninNumber: null,
        ninRegistryName: null,
        ninVerifiedAt: null,
        profileImage: null,
        bio: 'This account has been permanently deleted at the request of the user.',
        latitude: null,
        longitude: null,
        firebaseToken: null,
        monnifyAccountId: null,
        monnifyNUBAN: null,
        monnifyBVN: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        emergencyContactRelationship: null,
        isDeleted: true,
        deletedAt: new Date(),
        status: UserStatus.DEACTIVATED, // Keep state as deactivated to block login
      });
    }
  }

  async getUserById(id: string) {
    return this.usersRepository.findOne({ where: { id, isDeleted: false } });
  }

  async getUserWithBees(id: string) {
    return this.usersRepository.findOne({
      where: { id, isDeleted: false },
      relations: ['bees'],
    });
  }

  async deactivateAccount(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');

    // 1. Check Wallet & Locked Balance
    if (user.walletBalance > 0 || user.lockedBalance > 0) {
      throw new BadRequestException('You must withdraw all wallet and locked funds before closing your account. Your balance must be zero.');
    }

    // 2. Check Active Contracts
    const activeContracts = await this.contractRepository.count({
      where: [
        { clientId: id, status: In([ContractStatus.PENDING, ContractStatus.ACCEPTED, ContractStatus.IN_PROGRESS]) },
        { agentId: id, status: In([ContractStatus.PENDING, ContractStatus.ACCEPTED, ContractStatus.IN_PROGRESS]) },
      ],
    });

    if (activeContracts > 0) {
      throw new BadRequestException('You cannot close your account while you have ongoing jobs or pending requests.');
    }

    // 3. Perform Deactivation
    await this.usersRepository.update(id, {
      status: UserStatus.DEACTIVATED,
      deactivatedAt: new Date(),
    });

    return { success: true, message: 'Account deactivated. You have 30 days to contact support if you wish to undo this.' };
  }

  async reactivateAccount(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');
    if (user.isDeleted) throw new BadRequestException('This account has been permanently scrubbed and cannot be reactivated.');

    await this.usersRepository.update(id, {
      status: UserStatus.ACTIVE,
      deactivatedAt: null,
    });

    // 4. Send Reactivation Email
    await this.mailService.sendAccountReactivatedEmail(user.email, user.firstName);

    return { success: true, user: await this.usersRepository.findOne({ where: { id } }) };
  }

  async updateProfile(id: string, data: UpdateProfileDto) {
    await this.usersRepository.update(id, data as any);
    return this.usersRepository.findOne({ where: { id } });
  }

  async updateFcmToken(id: string, token: string) {
    await this.usersRepository.update(id, { firebaseToken: token });
    return { success: true };
  }

  async findAllFiltered(query: { search?: string; role?: UserRole; status?: UserStatus; ninStatus?: NinStatus; take?: number; skip?: number }) {
    const qb = this.usersRepository.createQueryBuilder('user')
      .where('user.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('user.createdAt', 'DESC');

    if (query.search) {
      qb.andWhere('(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search OR user.phoneNumber ILIKE :search)', { search: `%${query.search}%` });
    }

    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }

    if (query.status) {
      qb.andWhere('user.status = :status', { status: query.status });
    }

    if (query.ninStatus) {
      qb.andWhere('user.ninStatus = :ninStatus', { ninStatus: query.ninStatus });
    }

    const [items, total] = await qb
      .take(query.take || 20)
      .skip(query.skip || 0)
      .getManyAndCount();

    return { items, total };
  }

  async toggleBlockUser(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');

    const newStatus = user.status === UserStatus.DEACTIVATED ? UserStatus.ACTIVE : UserStatus.DEACTIVATED;
    await this.usersRepository.update(id, { status: newStatus });

    return { success: true, newStatus };
  }

  async getNearbyUsers(
    latitude: number,
    longitude: number,
    radiusKm: number = 10,
    id: string,
  ) {
    // Simple distance calculation - for production, use PostGIS
    return this.usersRepository
      .createQueryBuilder('user')
      .where(
        `(ACOS(SIN(user.latitude * PI() / 180) * SIN(:lat * PI() / 180) + COS(user.latitude * PI() / 180) * COS(:lat * PI() / 180) * COS(user.longitude * PI() / 180 - :lon * PI() / 180)) * 6371) <= :radius`,
        { lat: latitude, lon: longitude, radius: radiusKm },
      )
      .andWhere('user.id != :userId', { userId: id })
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .getMany();
  }

  async getAdmins() {
    return this.adminRepository.find({
      order: { createdAt: 'DESC' }
    });
  }

  async deleteAdmin(id: string) {
    const admin = await this.adminRepository.findOne({ where: { id } });
    if (!admin) throw new BadRequestException('Administrator not found');
    
    await this.adminRepository.remove(admin);
    return { success: true };
  }

  async createAdmin(data: { email: string; firstName: string; lastName: string; role: any; password?: string }) {
    const existing = await this.adminRepository.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Email already in use by another administrator');

    // Also check standard users to avoid collision if desired, or keep namespaces separate
    // For now, let's keep them separate as per request.

    const password = data.password;
    if (!password) {
      throw new BadRequestException('Password is required when creating an admin');
    }
    const hashedPassword = await bcrypt.hash(password, 12);

    const admin = this.adminRepository.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      role: data.role as AdminRole,
      hashedPassword,
      status: AdminStatus.ACTIVE,
    });

    return this.adminRepository.save(admin);
  }

  async getPendingVerifications() {
    return this.usersRepository.find({
      where: { ninStatus: NinStatus.PENDING, isDeleted: false },
      select: [
        'id', 'firstName', 'lastName', 'email', 'ninNumber', 'ninStatus',
        'createdAt', 'profileImage', 'phone', 'role', 'age',
        'deviceType', 'deviceModel', 'lastLoginAt', 'lastIpAddress',
      ],
      order: { createdAt: 'ASC' }
    });
  }

  async updateNinStatus(id: string, status: NinStatus, registryName?: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');

    const updateData: any = { ninStatus: status };

    if (status === NinStatus.VERIFIED) {
      // Run AML / criminal screening via Youverify before approving
      const bgCheck = await this.backgroundCheckService.screenIndividual(
        user.firstName,
        user.lastName,
      );
      updateData.ninBackgroundCheck = {
        provider: 'youverify',
        success: bgCheck.success,
        riskLevel: bgCheck.riskLevel,
        isPEP: bgCheck.isPEP,
        isSanctioned: bgCheck.isSanctioned,
        isWatchlisted: bgCheck.isWatchlisted,
        totalMatches: bgCheck.totalMatches,
        matches: bgCheck.matches,
        reportId: bgCheck.reportId,
        checkedAt: new Date().toISOString(),
        error: bgCheck.error,
      };

      if (bgCheck.success) {
        this.logger.log(
          `[BackgroundCheck] User ${user.id}: risk=${bgCheck.riskLevel}, ` +
          `PEP=${bgCheck.isPEP}, sanctions=${bgCheck.isSanctioned}, ` +
          `matches=${bgCheck.totalMatches}`,
        );

        if (bgCheck.riskLevel === 'high') {
          this.logger.warn(
            `[BackgroundCheck] HIGH RISK for user ${user.id} (${user.firstName} ${user.lastName}): ` +
            `PEP=${bgCheck.isPEP}, sanctioned=${bgCheck.isSanctioned}, matches=${bgCheck.totalMatches}`,
          );
          // Still approve — admin made the decision, but the data is stored for audit
        }
      } else {
        this.logger.warn(
          `[BackgroundCheck] Screening failed for user ${user.id}: ${bgCheck.error}`,
        );
      }

      updateData.isNinVerified = true;
      updateData.ninVerifiedAt = new Date();
      if (registryName && !updateData.ninRegistryName) {
        updateData.ninRegistryName = registryName;
      }

      // Safety net: if the user has no NUBAN (e.g. old bug where accounts[0] wasn't read),
      // try to retrieve from Monnify first, then re-create if needed.
      if (!user.monnifyNUBAN && user.ninNumber) {
        try {
          // First, try to retrieve the existing reserved account from Monnify
          if (user.monnifyAccountId) {
            this.logger.log(`[Approval] User ${user.id} has accountId but no NUBAN — retrieving from Monnify`);
            const existing = await this.monnifyService.getReservedAccountDetails(user.monnifyAccountId);
            if (existing?.nuban) {
              updateData.monnifyNUBAN = existing.nuban;
              updateData.monnifyBankName = existing.bankName;
              updateData.monnifyAccountName = existing.accountName || null;
              this.logger.log(`[Approval] Retrieved existing account: ${existing.bankName} — ${existing.nuban}`);
            }
          }

          // If still no NUBAN, create a new reserved account
          if (!updateData.monnifyNUBAN) {
            this.logger.log(`[Approval] User ${user.id} has no NUBAN — creating reserved account now`);
            const wallet = await this.monnifyService.createReservedAccount(user, user.ninNumber);
            updateData.monnifyNUBAN = wallet.nuban;
            updateData.monnifyAccountId = wallet.accountId;
            updateData.monnifyBankName = wallet.bankName;
            updateData.monnifyAccountName = wallet.accountName || null;
            this.logger.log(`[Approval] Reserved account created: ${wallet.bankName} — ${wallet.nuban}`);
          }
        } catch (err) {
          this.logger.error(`[Approval] Failed to resolve reserved account for user ${user.id}: ${err.message}`);
          // Don't block approval — admin explicitly approved, account can be retried
        }
      }
    } else if (status === NinStatus.REJECTED) {
      updateData.isNinVerified = false;
    }

    await this.usersRepository.update(id, updateData);
    
    // Notify the user via email
    if (status === NinStatus.VERIFIED) {
      await this.mailService.sendVerificationApproved(user.email, user.firstName);
    } else if (status === NinStatus.REJECTED) {
      await this.mailService.sendVerificationRejected(user.email, user.firstName);
    }

    return { success: true, status, backgroundCheck: updateData.ninBackgroundCheck };
  }

  /**
   * Run AML / criminal screening without changing status — admin can preview results.
   */
  async runBackgroundCheck(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const bgCheck = await this.backgroundCheckService.screenIndividual(
      user.firstName,
      user.lastName,
    );

    // Persist the check results for audit
    await this.usersRepository.update(userId, {
      ninBackgroundCheck: {
        provider: 'youverify',
        success: bgCheck.success,
        riskLevel: bgCheck.riskLevel,
        isPEP: bgCheck.isPEP,
        isSanctioned: bgCheck.isSanctioned,
        isWatchlisted: bgCheck.isWatchlisted,
        totalMatches: bgCheck.totalMatches,
        matches: bgCheck.matches,
        reportId: bgCheck.reportId,
        checkedAt: new Date().toISOString(),
        error: bgCheck.error,
      } as any,
    });

    return {
      success: bgCheck.success,
      riskLevel: bgCheck.riskLevel,
      isPEP: bgCheck.isPEP,
      isSanctioned: bgCheck.isSanctioned,
      isWatchlisted: bgCheck.isWatchlisted,
      totalMatches: bgCheck.totalMatches,
      matches: bgCheck.matches,
      reportId: bgCheck.reportId,
      error: bgCheck.error,
    };
  }

  /**
   * Repair wallet for users who have monnifyAccountId but missing NUBAN.
   * Retrieves from Monnify if account exists, or creates a new one.
   */
  async repairWallet(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (user.monnifyNUBAN) {
      return {
        success: true,
        message: 'Wallet already has NUBAN',
        nuban: user.monnifyNUBAN,
        bankName: user.monnifyBankName,
        accountName: user.monnifyAccountName,
      };
    }

    // Try to retrieve existing reserved account from Monnify
    if (user.monnifyAccountId) {
      this.logger.log(`[RepairWallet] Retrieving account for user ${user.id}, ref: ${user.monnifyAccountId}`);
      const existing = await this.monnifyService.getReservedAccountDetails(user.monnifyAccountId);
      if (existing?.nuban) {
        await this.usersRepository.update(userId, {
          monnifyNUBAN: existing.nuban,
          monnifyBankName: existing.bankName,
          monnifyAccountName: existing.accountName || null,
        });
        this.logger.log(`[RepairWallet] Updated user ${user.id}: ${existing.bankName} — ${existing.nuban}`);
        return {
          success: true,
          message: 'Retrieved and updated from Monnify',
          nuban: existing.nuban,
          bankName: existing.bankName,
          accountName: existing.accountName,
        };
      }
    }

    // No existing account found — create a new one
    if (!user.ninNumber) {
      throw new BadRequestException('User has no NIN — cannot create reserved account');
    }

    this.logger.log(`[RepairWallet] Creating new reserved account for user ${user.id}`);
    const wallet = await this.monnifyService.createReservedAccount(user, user.ninNumber);
    await this.usersRepository.update(userId, {
      monnifyNUBAN: wallet.nuban,
      monnifyAccountId: wallet.accountId,
      monnifyBankName: wallet.bankName,
      monnifyAccountName: wallet.accountName || null,
    });

    return {
      success: true,
      message: 'Created new reserved account',
      nuban: wallet.nuban,
      bankName: wallet.bankName,
      accountName: wallet.accountName,
    };
  }

  /**
   * GDPR / Data Subject Access Request (DSAR)
   * Returns all personal data the platform holds about the requesting user.
   * Sensitive fields (hashed passwords, OTPs) are excluded.
   */
  async exportUserData(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['bees'],
    });

    if (!user) throw new BadRequestException('User not found');

    // Strip internal/security fields before export
    const {
      hashedPassword,
      resetPasswordOTP,
      resetPasswordOTPExpires,
      emailVerificationOTP,
      emailVerificationOTPExpires,
      hashedTransactionPin,
      firebaseToken,
      ...safeProfile
    } = user as any;

    const [contracts, reviewsGiven, reviewsReceived, transactions, notifications] =
      await Promise.all([
        this.contractRepository.find({
          where: [{ clientId: userId }, { agentId: userId }],
          order: { createdAt: 'DESC' },
        }),
        this.reviewsRepository.find({
          where: { reviewerId: userId },
          order: { createdAt: 'DESC' },
        }),
        this.reviewsRepository.find({
          where: { revieweeId: userId },
          order: { createdAt: 'DESC' },
        }),
        this.transactionsRepository.find({
          where: { userId },
          order: { createdAt: 'DESC' },
        }),
        this.notificationsRepository.find({
          where: { userId },
          order: { createdAt: 'DESC' },
        }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: safeProfile,
      contracts,
      reviews: {
        given: reviewsGiven,
        received: reviewsReceived,
      },
      transactions,
      notifications,
    };
  }
}
