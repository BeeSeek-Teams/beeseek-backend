import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from '../../entities/user.entity';
import { Administrator } from '../../entities/administrator.entity';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { MonnifyService } from '../wallet/monnify.service';
import { MailModule } from '../mail/mail.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Administrator]),
    MailModule,
    RedisModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, MonnifyService],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
