import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from '../../entities/contract.entity';
import { Job } from '../../entities/job.entity';
import { CancellationAudit } from '../../entities/cancellation-audit.entity';
import { User } from '../../entities/user.entity';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { AutoReleaseCron } from './auto-release.cron';
import { StaleJobCron } from './stale-job.cron';
import { Message } from '../../entities/message.entity';
import { Bee } from '../../entities/bee.entity';
import { ChatModule } from '../chat/chat.module';
import { WalletModule } from '../wallet/wallet.module';
import { SecurityModule } from '../security/security.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PdfService } from '../../common/services/pdf.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, Message, Bee, Job, CancellationAudit, User]),
    ChatModule,
    WalletModule,
    SecurityModule,
    MailModule,
    NotificationsModule,
  ],
  providers: [ContractsService, AutoReleaseCron, StaleJobCron, PdfService],
  controllers: [ContractsController],
  exports: [ContractsService],
})
export class ContractsModule {}
