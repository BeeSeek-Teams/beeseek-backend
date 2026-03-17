import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { Administrator } from '../../entities/administrator.entity';
import { User } from '../../entities/user.entity';
import { Transaction } from '../../entities/transaction.entity';
import { FundingRequest } from '../../entities/funding-request.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Administrator, User, Transaction, FundingRequest]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any },
    }),
    AuthModule, // re-uses JwtStrategy + PassportModule so JwtAuthGuard works
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
