import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserPresence } from '../../entities/user-presence.entity';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserPresence])],
  providers: [PresenceService],
  controllers: [PresenceController],
  exports: [PresenceService],
})
export class PresenceModule {}
