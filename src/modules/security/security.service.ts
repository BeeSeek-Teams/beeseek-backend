import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import * as bcrypt from 'bcrypt';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SecurityService {
  private readonly MAX_PIN_ATTEMPTS = 5;
  private readonly PIN_LOCKOUT_SECONDS = 900; // 15 minutes

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly redisService: RedisService,
  ) {}

  async setTransactionPin(userId: string, pin: string) {
    if (!/^\d{4}$/.test(pin)) {
      throw new BadRequestException('PIN must be exactly 4 digits');
    }

    const hashedPin = await bcrypt.hash(pin, 10);
    await this.userRepository.update(userId, {
      hashedTransactionPin: hashedPin,
    });
    return { success: true, message: 'Transaction PIN set successfully' };
  }

  async verifyTransactionPin(userId: string, pin: string) {
    // Check lockout
    const lockoutKey = `pin_lockout:${userId}`;
    const attemptKey = `pin_attempts:${userId}`;
    
    const isLockedOut = await this.redisService.get(lockoutKey);
    if (isLockedOut) {
      throw new BadRequestException('Too many failed PIN attempts. Please try again in 15 minutes.');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'hashedTransactionPin'],
    });

    if (!user || !user.hashedTransactionPin) {
      throw new BadRequestException('Transaction PIN not set');
    }

    const isMatch = await bcrypt.compare(pin, user.hashedTransactionPin);
    if (!isMatch) {
      // Increment failed attempts
      const attempts = await this.redisService.get(attemptKey);
      const attemptCount = attempts ? parseInt(attempts) + 1 : 1;
      
      if (attemptCount >= this.MAX_PIN_ATTEMPTS) {
        // Lock out for 15 minutes
        await this.redisService.set(lockoutKey, '1', this.PIN_LOCKOUT_SECONDS);
        await this.redisService.set(attemptKey, '0', 1); // Reset counter
        throw new BadRequestException(`PIN locked after ${this.MAX_PIN_ATTEMPTS} failed attempts. Try again in 15 minutes.`);
      }
      
      await this.redisService.set(attemptKey, String(attemptCount), this.PIN_LOCKOUT_SECONDS);
      const remaining = this.MAX_PIN_ATTEMPTS - attemptCount;
      throw new UnauthorizedException(`Invalid transaction PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`);
    }

    // Clear attempts on success
    await this.redisService.set(attemptKey, '0', 1);
    return true;
  }

  async updateBiometrics(userId: string, enabled: boolean) {
    await this.userRepository.update(userId, { useBiometrics: enabled });
    return { success: true, biometricsEnabled: enabled };
  }

  async getSecurityStatus(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['hashedTransactionPin', 'useBiometrics'],
    });

    return {
      hasPin: !!user?.hashedTransactionPin,
      biometricsEnabled: user?.useBiometrics ?? false,
    };
  }
}
