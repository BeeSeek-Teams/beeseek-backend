import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../dto/auth.dto';
import { AuthService } from '../../modules/auth/auth.service';
import { RedisService } from '../../modules/redis/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    private redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload) {
    // Check blocklist: if the JTI has been revoked (e.g. user logged out), reject
    if (payload.jti) {
      const isBlocklisted = await this.redisService.get(`blocklist:${payload.jti}`);
      if (isBlocklisted) {
        throw new UnauthorizedException('Token has been revoked. Please log in again.');
      }
    }

    const user = await this.authService.getUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
}
