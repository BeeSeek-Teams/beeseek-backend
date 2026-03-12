import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  Get,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  VerifyNINDto,
  AuthResponseDto,
  ForgotPasswordDto,
  VerifyOtpDto,
  ResetPasswordDto,
} from '../../dto/auth.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../../entities/user.entity';
import { Administrator } from '../../entities/administrator.entity';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Register new user with email and password
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto, @Req() req: any): Promise<AuthResponseDto> {
    const ip = req.ip || req.headers['x-forwarded-for'];
    return this.authService.register(registerDto, ip);
  }

  /**
   * Login with email and password
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: any): Promise<AuthResponseDto> {
    const ip = req.ip || req.headers['x-forwarded-for'];
    return this.authService.login(loginDto, ip);
  }

  /**
   * Forgot Password - Send OTP
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('resend-verification-otp')
  @HttpCode(HttpStatus.OK)
  async resendVerificationOtp(@Body('email') email: string) {
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    return this.authService.resendVerificationOtp(email);
  }

  /**
   * Verify OTP
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  /**
   * Reset Password
   */
  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  /**
   * Send NIN Verification Reminder
   */
  @Post('remind-nin')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async remindNIN(@CurrentUser() user: User) {
    return this.authService.sendNINReminder(user.id);
  }

  /**
   * Verify NIN and create Monnify wallet
   * Same NIN on linked accounts verifies both (same person)
   */
  @Post('verify-nin')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async verifyNIN(
    @CurrentUser() user: User,
    @Body() verifyNINDto: VerifyNINDto,
  ): Promise<{
    message: string;
    isVerified: boolean;
    walletCreated: boolean;
    nuban?: string | null;
    linkedAccountAlsoVerified?: boolean;
  }> {
    const result = await this.authService.verifyNIN(user.id, verifyNINDto);

    const updatedUser = await this.authService.getUserById(user.id) as User;

    return {
      message: 'Account verified successfully. Wallet created.',
      isVerified: result.isVerified,
      walletCreated: result.walletCreated,
      nuban: updatedUser?.monnifyNUBAN,
      linkedAccountAlsoVerified: result.linkedAccountAlsoVerified,
    };
  }

  /**
   * Get current user profile
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getCurrentUser(@CurrentUser() user: User): Promise<User | Administrator | null> {
    return this.authService.getUserById(user.id);
  }

  /**
   * Refresh access token
   */
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Body('refresh_token') refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }
    return this.authService.refreshToken(refreshToken);
  }

  /**
   * Get linked account (for same person with different email)
   */
  @Get('linked-accounts')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getLinkedAccounts(@CurrentUser() user: User): Promise<any> {
    // Find all accounts linked to this user
    const linkedAccounts = await this.authService.getLinkedAccounts(user.id);

    return {
      currentAccount: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      linkedAccounts: linkedAccounts.map((acc) => ({
        id: acc.id,
        email: acc.email,
        role: acc.role,
        isVerified: acc.isVerified,
      })),
    };
  }

  /**
   * Logout: invalidates the token server-side via Redis blocklist
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: User,
    @Req() req: any,
  ): Promise<{ message: string }> {
    const authHeader: string = req.headers['authorization'] || '';
    const rawToken = authHeader.replace('Bearer ', '');
    return this.authService.logout(rawToken);
  }

  /**
   * Token generation is handled exclusively in AuthService.generateTokens()
   */
}
