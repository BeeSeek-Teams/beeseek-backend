import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { randomInt } from 'crypto';
import { User, UserStatus, UserRole, AuthProvider, NinStatus } from '../../entities/user.entity';
import { Administrator, AdminStatus, AdminRole } from '../../entities/administrator.entity';
import {
  RegisterDto,
  LoginDto,
  VerifyNINDto,
  AuthResponseDto,
  JwtPayload,
  ForgotPasswordDto,
  VerifyOtpDto,
  ResetPasswordDto,
} from '../../dto/auth.dto';
import { MonnifyService } from '../wallet/monnify.service';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Administrator)
    private adminRepository: Repository<Administrator>,
    private jwtService: JwtService,
    private monnifyService: MonnifyService,
    private mailService: MailService,
    private dataSource: DataSource,
    private redisService: RedisService,
  ) {}

  /**
   * Register with email and password
   */
  async register(registerDto: RegisterDto, ipAddress?: string): Promise<AuthResponseDto> {
    const {
      email,
      password,
      firstName,
      lastName,
      age,
      role,
      linkedAccountId,
      deviceId,
      deviceType,
      deviceModel,
      latitude,
      longitude,
    } = registerDto;

    // Check if email already exists
    const existingEmail = await this.usersRepository.findOne({
      where: { email },
    });

    if (existingEmail) {
      if (existingEmail.status === UserStatus.DEACTIVATED) {
        throw new ConflictException('This email is linked to a deactivated account. Please contact support@beeseek.site to reactivate your account.');
      }
      throw new ConflictException('Email already registered');
    }

    // Validate password strength
    this.validatePasswordStrength(password);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate unique slug
    const slug = await this.generateUniqueSlug(firstName, lastName);

    // If linkedAccountId provided, verify it exists and belongs to same person
    let linkedUser: User | null = null;
    if (linkedAccountId) {
      linkedUser = await this.usersRepository.findOne({
        where: { id: linkedAccountId },
      });

      if (!linkedUser) {
        throw new BadRequestException('Linked account not found');
      }

      if (
        linkedUser.firstName !== firstName ||
        linkedUser.lastName !== lastName
      ) {
        throw new BadRequestException(
          'Linked account must have the same first and last name',
        );
      }

      // Check if user already has this role
      const existingRole = await this.usersRepository.findOne({
        where: { linkedAccountId, role },
      });

      if (existingRole) {
        throw new ConflictException(`Already have ${role} account`);
      }
    }

    // Create user in transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const otp = randomInt(100000, 1000000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const hashedOtp = await bcrypt.hash(otp, 10);

    // NOTE: OTP is deliberately NOT logged — logging OTPs is a critical security vulnerability.

    try {
      const user = queryRunner.manager.create(User, {
        email,
        firstName,
        lastName,
        slug,
        age,
        role,
        hashedPassword,
        authProvider: AuthProvider.EMAIL,
        isVerified: false,
        emailVerificationOTP: hashedOtp,
        emailVerificationOTPExpires: otpExpires,
        linkedAccountId: linkedAccountId ?? undefined,
        deviceId,
        lastIpAddress: ipAddress,
        deviceType,
        deviceModel,
        latitude,
        longitude,
      });

      // If this is linked to another account, link both ways
      const savedUser = await queryRunner.manager.save(user);
      if (linkedUser) {
        linkedUser.linkedAccountId = savedUser.id;
        await queryRunner.manager.save(linkedUser);
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `User registered: ${savedUser.id} with role ${role} (linkedAccountId: ${linkedAccountId || 'none'})`,
      );

      // Send Verification and Welcome Email (Background - don't block response)
      this.mailService
        .sendOTP(savedUser.email, savedUser.firstName, otp, 'VERIFICATION')
        .catch((err) =>
          this.logger.error(
            `Failed to send OTP email to ${savedUser.email}: ${err?.message} | code=${err?.code} | responseCode=${err?.responseCode}`,
            err?.stack,
          ),
        );

      if (role === UserRole.AGENT) {
        this.mailService
          .sendWelcomeAgent(savedUser.email, savedUser.firstName)
          .catch((err) =>
            this.logger.error(
              `Failed to send background welcome email to ${savedUser.email}`,
              err,
            ),
          );
      } else {
        this.mailService
          .sendWelcomeClient(savedUser.email, savedUser.firstName)
          .catch((err) =>
            this.logger.error(
              `Failed to send background welcome email to ${savedUser.email}`,
              err,
            ),
          );
      }

      return this.generateAuthResponse(savedUser);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Registration failed for email ${email}`, error);
      throw new InternalServerErrorException(
        'Registration failed. Please try again.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Login with email and password
   */
  async login(loginDto: LoginDto, ipAddress?: string): Promise<AuthResponseDto> {
    const { email, password, deviceId, deviceType, deviceModel, latitude, longitude } =
      loginDto;

    // First try finding in administrators (dedicated staff table)
    const admin = await this.adminRepository.findOne({
      where: { email },
      select: ['id', 'email', 'firstName', 'lastName', 'hashedPassword', 'role', 'status'],
    });

    if (admin) {
      if (admin.status === AdminStatus.INACTIVE) {
        throw new UnauthorizedException('This administrative node is inactive');
      }

      const isPasswordValid = await bcrypt.compare(password, admin.hashedPassword);
      if (!isPasswordValid) throw new UnauthorizedException('Invalid email or password');

      await this.adminRepository.update(admin.id, { lastLoginAt: new Date() });
      
      this.logger.log(`[AUTH] Administrator logged in: ${admin.id} (${admin.role})`);
      
      // Return basic auth response for administrators
      const { access_token, refresh_token } = this.generateTokens(admin);
      return {
        access_token,
        refresh_token,
        user: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          isVerified: true,
          age: 0,
        } as any
      };
    }

    // Then try finding in standard users
    const user = await this.usersRepository.findOne({
      where: { email },
      select: [
        'id',
        'email',
        'firstName',
        'lastName',
        'slug',
        'hashedPassword',
        'role',
        'age',
        'isVerified',
        'authProvider',
        'monnifyAccountId',
        'monnifyNUBAN',
        'monnifyBVN',
        'walletBalance',
        'lockedBalance',
        'ninNumber',
        'ninVerifiedAt',
        'useBiometrics',
        'isAvailable',
        'rating',
        'phone',
        'bio',
        'profileImage',
        'deviceType',
        'emergencyContactName',
        'emergencyContactPhone',
        'emergencyContactRelationship',
        'earlyAccessAchievement',
        'topRatedAchievement',
        'goldenBadgeAchievement',
      ],
    });

    if (!user || !user.hashedPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.isDeleted) {
      throw new UnauthorizedException('This account has been closed and permanently removed. Contact support for further assistance.');
    }

    if (user.status === UserStatus.DEACTIVATED) {
      throw new UnauthorizedException('Your account is currently deactivated. Please contact support@beeseek.site to restore access.');
    }

    if (user.authProvider !== AuthProvider.EMAIL) {
      throw new BadRequestException(
        `This account uses ${user.authProvider} sign-in. Please use that method.`,
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.hashedPassword);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Ensure user has a slug (for existing users)
    if (!user.slug) {
      user.slug = await this.generateUniqueSlug(user.firstName, user.lastName);
      await this.usersRepository.update(user.id, { slug: user.slug });
    }

    // Update last login and device info
    const updateData: any = {
      lastLoginAt: new Date(),
      lastIpAddress: ipAddress || user.lastIpAddress,
      deviceId: deviceId || user.deviceId,
      deviceType: deviceType || user.deviceType,
      deviceModel: deviceModel || user.deviceModel,
      latitude: latitude || user.latitude,
      longitude: longitude || user.longitude,
    };
    if (user.role === UserRole.CLIENT) {
      updateData.lastClientLoginAt = new Date();
    } else if (user.role === UserRole.AGENT) {
      updateData.lastAgentLoginAt = new Date();
    }
    await this.usersRepository.update(user.id, updateData);

    this.logger.log(`User logged in: ${user.id} (${user.role})`);

    return this.generateAuthResponse(user);
  }

  /**
   * Verify NIN and create Monnify wallet
   * NIN is unique per person - same NIN on linked accounts means same person
   * One verification verifies both linked accounts
   */
  async verifyNIN(
    userId: string,
    verifyNINDto: VerifyNINDto,
  ): Promise<{
    isVerified: boolean;
    walletCreated: boolean;
    linkedAccountAlsoVerified?: boolean;
  }> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Validate NIN format (11 digits)
    if (!/^\d{11}$/.test(verifyNINDto.ninNumber)) {
      throw new BadRequestException('NIN must be 11 digits');
    }

    // Check if this NIN is already verified by a different person
    const otherUserWithNIN = await this.usersRepository.findOne({
      where: {
        ninNumber: verifyNINDto.ninNumber,
      },
    });

    if (otherUserWithNIN) {
      // This NIN exists - check if it's the same person (current user or linked account)
      const isCurrentUser = otherUserWithNIN.id === user.id;
      const isLinkedAccount = otherUserWithNIN.id === user.linkedAccountId;

      if (!isCurrentUser && !isLinkedAccount) {
        // NIN belongs to a completely different person
        throw new ConflictException(
          'This NIN is already registered to another person',
        );
      }

      if (isCurrentUser && user.isVerified) {
        // This account already verified with this NIN
        throw new BadRequestException('This account is already verified');
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Verify NIN with Monnify
      const ninResult = await this.monnifyService.verifyNIN(
        verifyNINDto.ninNumber,
      );

      if (!ninResult.verified) {
        throw new BadRequestException(
          'NIN verification failed. Please check the number and try again.',
        );
      }

      // Create wallet for current account (We still create the wallet for usage)
      const walletDetails =
        await this.monnifyService.createReservedAccount(user);

      // Update current user with verification details
      user.ninNumber = verifyNINDto.ninNumber;
      user.ninRegistryName = ninResult.name || null;
      user.ninStatus = NinStatus.PENDING;
      user.isNinVerified = false; // MUST remain false until admin confirms
      
      // Note: we don't set isVerified = true here anymore if that was identity status.
      // If isVerified was email status, it should have been true already via OTP.
      
      user.monnifyAccountId = walletDetails.accountId;
      user.monnifyNUBAN = walletDetails.nuban;
      user.monnifyBVN = verifyNINDto.bvnNumber ?? '';

      await queryRunner.manager.save(user);

      let linkedAccountVerified = false;

      // If user has linked account, verify it too with same NIN (same person)
      if (user.linkedAccountId) {
        const linkedUser = await queryRunner.manager.findOne(User, {
          where: { id: user.linkedAccountId },
        });

        if (linkedUser) {
          if (linkedUser.ninStatus !== NinStatus.VERIFIED) {
            // Create separate wallet for linked account
            const linkedWalletDetails =
              await this.monnifyService.createReservedAccount(linkedUser);

            // Update linked account with same NIN
            linkedUser.ninNumber = verifyNINDto.ninNumber;
            linkedUser.ninRegistryName = ninResult.name || null;
            linkedUser.ninStatus = NinStatus.PENDING;
            linkedUser.isNinVerified = false;
            linkedUser.monnifyAccountId = linkedWalletDetails.accountId;
            linkedUser.monnifyNUBAN = linkedWalletDetails.nuban;
            linkedUser.monnifyBVN = verifyNINDto.bvnNumber ?? '';

            await queryRunner.manager.save(linkedUser);

            linkedAccountVerified = true;

            this.logger.log(
              `Submitted linked account ${linkedUser.id} (${linkedUser.email}) for NIN verification review`,
            );
          }
        }
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `User ${userId} (${user.email}) submitted NIN for review. Wallets created. Linked account submitted: ${linkedAccountVerified}`,
      );

      return {
        isVerified: false, // In terms of NIN verification, it's not "Verified" yet
        walletCreated: true,
        linkedAccountAlsoVerified: linkedAccountVerified,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`NIN verification failed for user ${userId}`, error);

      throw new InternalServerErrorException(
        error?.message || 'Verification failed. Please try again later.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get user by ID (checks both users and administrators)
   */
  async getUserById(id: string): Promise<User | Administrator | null> {
    const user = await this.usersRepository.findOne({
      where: { id },
    });
    if (user) return user;

    return this.adminRepository.findOne({
      where: { id },
    });
  }

  /**
   * Generate JWT tokens
   */
  private generateTokens(user: User | Administrator): {
    access_token: string;
    refresh_token: string;
  } {
    const jti = randomUUID();
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any,
    });

    const refresh_token = this.jwtService.sign(payload, {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as any,
    });

    return { access_token, refresh_token };
  }

  /**
   * Logout: adds the token's JTI to the Redis blocklist until the token would naturally expire.
   * The JWT strategy checks this blocklist on every request, making logout truly server-side.
   */
  async logout(rawToken: string): Promise<{ message: string }> {
    try {
      const decoded = this.jwtService.decode(rawToken) as JwtPayload & { exp?: number };
      if (decoded?.jti && decoded?.exp) {
        const now = Math.floor(Date.now() / 1000);
        const ttlSeconds = decoded.exp - now;
        if (ttlSeconds > 0) {
          // Store in Redis with TTL matching the token's remaining lifetime
          await this.redisService.set(`blocklist:${decoded.jti}`, '1', ttlSeconds);
          this.logger.log(`Token blocklisted: jti=${decoded.jti}, ttl=${ttlSeconds}s`);
        }
      }
    } catch (err) {
      // Don't fail logout even if blocklist write fails — client already clears the token
      this.logger.warn('Could not write token to blocklist during logout', err.message);
    }
    return { message: 'Logged out successfully' };
  }

  /**
   * Resend email verification OTP (for registration flow)
   */
  async resendVerificationOtp(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (!user || user.isVerified) {
      // Don't reveal user existence
      return { message: 'If your email is registered and unverified, you will receive an OTP shortly.' };
    }

    // Rate limit via Redis  
    const attemptKey = `resend_otp:${email}`;
    const attempts = await this.redisService.get(attemptKey);
    if (attempts && parseInt(attempts) >= 3) {
      throw new BadRequestException('Too many resend requests. Please wait a few minutes.');
    }
    await this.redisService.set(attemptKey, String((parseInt(attempts || '0')) + 1), 300); // 5 min window

    const otp = randomInt(100000, 1000000).toString();
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15);
    const hashedOtp = await bcrypt.hash(otp, 10);

    await this.usersRepository.update(user.id, {
      emailVerificationOTP: hashedOtp,
      emailVerificationOTPExpires: expires,
    });

    this.mailService
      .sendOTP(user.email, user.firstName, otp, 'VERIFICATION')
      .catch((mailError) =>
        this.logger.error(`Could not send verification OTP to ${user.email}`, mailError),
      );

    return { message: 'If your email is registered and unverified, you will receive an OTP shortly.' };
  }

  /**
   * Send forgot password OTP
   */
  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({
      where: { email: forgotPasswordDto.email },
    });

    if (!user) {
      // Don't reveal if user exists for security, but we'll return same message
      return {
        message:
          'If your email is registered, you will receive an OTP shortly.',
      };
    }

    const otp = randomInt(100000, 1000000).toString();
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15); // 15 mins expiry
    const hashedOtp = await bcrypt.hash(otp, 10);

    await this.usersRepository.update(user.id, {
      resetPasswordOTP: hashedOtp,
      resetPasswordOTPExpires: expires,
    });

    // NOTE: OTP is deliberately NOT logged — logging OTPs is a critical security vulnerability.

    // Send OTP Email (Background)
    this.mailService
      .sendOTP(user.email, user.firstName, otp, 'PASSWORD_RESET')
      .catch((mailError) =>
        this.logger.error(
          `Could not send password reset OTP to ${user.email}`,
          mailError,
        ),
      );

    return {
      message: 'If your email is registered, you will receive an OTP shortly.',
    };
  }

  /**
   * Verify OTP with brute-force protection
   */
  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<{ valid: boolean }> {
    // Rate limit OTP attempts: max 5 attempts per email per 15 minutes
    const attemptKey = `otp_attempts:${verifyOtpDto.email}`;
    const attempts = await this.redisService.get(attemptKey);
    const attemptCount = attempts ? parseInt(attempts) : 0;

    if (attemptCount >= 5) {
      throw new BadRequestException('Too many OTP attempts. Please request a new code after 15 minutes.');
    }

    const user = await this.usersRepository.findOne({
      where: { email: verifyOtpDto.email },
      select: [
        'id',
        'resetPasswordOTP',
        'resetPasswordOTPExpires',
        'emailVerificationOTP',
        'emailVerificationOTPExpires',
        'isVerified',
      ],
    });

    if (!user) {
      // Increment attempts even for non-existent users to prevent user enumeration
      await this.redisService.set(attemptKey, String(attemptCount + 1), 900);
      throw new BadRequestException('Invalid or expired OTP');
    }

    const isResetMatch =
      user.resetPasswordOTP &&
      await bcrypt.compare(verifyOtpDto.code, user.resetPasswordOTP) &&
      user.resetPasswordOTPExpires &&
      new Date() < user.resetPasswordOTPExpires;

    const isVerifyMatch =
      user.emailVerificationOTP &&
      await bcrypt.compare(verifyOtpDto.code, user.emailVerificationOTP) &&
      user.emailVerificationOTPExpires &&
      new Date() < user.emailVerificationOTPExpires;

    if (!isResetMatch && !isVerifyMatch) {
      // Increment failed attempt counter
      await this.redisService.set(attemptKey, String(attemptCount + 1), 900);
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Clear attempt counter on success
    await this.redisService.set(attemptKey, '0', 1);

    // Update user status
    if (isVerifyMatch) {
      user.isVerified = true;
      user.emailVerificationOTP = null;
      user.emailVerificationOTPExpires = null;
    }

    await this.usersRepository.save(user);

    return { valid: true };
  }

  /**
   * Reset Password
   */
  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({
      where: { email: resetPasswordDto.email },
      select: ['id', 'resetPasswordOTP', 'resetPasswordOTPExpires'],
    });

    if (!user || !user.resetPasswordOTP || !await bcrypt.compare(resetPasswordDto.code, user.resetPasswordOTP)) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    if (
      !user.resetPasswordOTPExpires ||
      new Date() > user.resetPasswordOTPExpires
    ) {
      throw new BadRequestException('OTP has expired');
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.password, 12);
    user.hashedPassword = hashedPassword;
    user.resetPasswordOTP = null;
    user.resetPasswordOTPExpires = null;
    user.isVerified = true;

    await this.usersRepository.save(user);

    return { message: 'Password reset successful' };
  }

  /**
   * Send NIN verification reminder
   */
  async sendNINReminder(userId: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('User is already verified');
    }

    // Send NIN reminder in background
    this.mailService
      .sendNINReminder(user.email, user.firstName)
      .catch((error) =>
        this.logger.error(
          `Error sending background NIN reminder to ${user.email}`,
          error,
        ),
      );

    return { message: 'NIN reminder sent successfully' };
  }

  private generateAuthResponse(user: User): AuthResponseDto {
    const { access_token, refresh_token } = this.generateTokens(user);

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        slug: user.slug,
        role: user.role,
        isVerified: user.isVerified,
        isAvailable: user.isAvailable,
        age: user.age,
        isNinVerified: user.isNinVerified,
        ninStatus: user.ninStatus,
        rating: user.rating,
        phone: user.phone ?? undefined,
        bio: user.bio ?? undefined,
        profileImage: user.profileImage ?? undefined,
        walletBalance: user.walletBalance,
        lockedBalance: user.lockedBalance,
        monnifyNUBAN: user.monnifyNUBAN ?? undefined,
        deviceType: user.deviceType ?? undefined,
        emergencyContactName: user.emergencyContactName ?? undefined,
        emergencyContactPhone: user.emergencyContactPhone ?? undefined,
        emergencyContactRelationship: user.emergencyContactRelationship ?? undefined,
        earlyAccessAchievement: user.earlyAccessAchievement,
        topRatedAchievement: user.topRatedAchievement,
        goldenBadgeAchievement: user.goldenBadgeAchievement,
        useBiometrics: user.useBiometrics,
      },
    };
  }

  /**
   * Validate password strength
   */
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one uppercase letter',
      );
    }

    if (!/[a-z]/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one lowercase letter',
      );
    }

    if (!/[0-9]/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one number',
      );
    }
  }

  /**
   * Get all linked accounts for same person
   */
  async getLinkedAccounts(userId: string): Promise<User[]> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });

    if (!user) {
      return [];
    }

    // Find all accounts linked to this user (including bidirectional links)
    const linkedAccounts = await this.usersRepository.find({
      where: [
        { linkedAccountId: userId },
        { id: user.linkedAccountId || undefined },
      ],
    });

    return linkedAccounts;
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.getUserById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Blocklist the old refresh token's JTI to enforce one-time use
      if (payload.jti) {
        const isAlreadyUsed = await this.redisService.get(`blocklist:${payload.jti}`);
        if (isAlreadyUsed) {
          throw new UnauthorizedException('Refresh token has already been used');
        }
        // Block old token for its remaining lifetime
        const now = Math.floor(Date.now() / 1000);
        const ttl = payload.exp ? payload.exp - now : 604800; // default 7 days
        if (ttl > 0) {
          await this.redisService.set(`blocklist:${payload.jti}`, '1', ttl);
        }
      }

      // Issue new token pair (rotation)
      const { access_token, refresh_token: new_refresh_token } = this.generateTokens(user as any);

      return { access_token, refresh_token: new_refresh_token };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Generate a unique slug for a user based on their name
   */
  private async generateUniqueSlug(
    firstName: string,
    lastName: string,
  ): Promise<string> {
    const baseSlug = `${firstName}-${lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-');
    let slug = baseSlug;
    let counter = 1;

    // Keep checking if slug exists until we find a unique one
    while (true) {
      const existingUser = await this.usersRepository.findOne({
        where: { slug },
      });

      if (!existingUser) {
        return slug;
      }

      // If exists, append counter and try again
      slug = `${baseSlug}-${counter}`;
      counter++;

      // Safety break to prevent infinite loop (though very unlikely)
      if (counter > 100) {
        return `${slug}-${Math.random().toString(36).substring(2, 7)}`;
      }
    }
  }
}
