import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from '../../entities/user.entity';
import { Administrator } from '../../entities/administrator.entity';
import { Contract } from '../../entities/contract.entity';
import { Bee } from '../../entities/bee.entity';
import { Review } from '../../entities/review.entity';
import { Transaction } from '../../entities/transaction.entity';
import { Notification } from '../../entities/notification.entity';
import { MailModule } from '../mail/mail.module';
import { BackgroundCheckService } from '../../common/services/background-check.service';
import { MonnifyService } from '../wallet/monnify.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Administrator, Contract, Bee, Review, Transaction, Notification]),
    MailModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, BackgroundCheckService, MonnifyService],
  exports: [UsersService],
})
export class UsersModule {}
