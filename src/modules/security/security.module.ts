import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RedisModule],
  providers: [SecurityService],
  controllers: [SecurityController],
  exports: [SecurityService],
})
export class SecurityModule {}
