import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { User } from '../../entities/user.entity';
import { Transaction } from '../../entities/transaction.entity';
import { MonnifyService } from './monnify.service';
import { SecurityModule } from '../security/security.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { PromotionsModule } from '../promotions/promotions.module';

import { UserBank } from '../../entities/user-bank.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Transaction, UserBank]),
    SecurityModule,
    NotificationsModule,
    MailModule,
    PromotionsModule,
  ],
  controllers: [WalletController],
  providers: [WalletService, MonnifyService],
  exports: [WalletService],
})
export class WalletModule {}
