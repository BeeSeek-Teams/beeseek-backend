import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Queen Bee Bypass: constant-time comparison to prevent timing attacks
    const queenKey = request.headers['x-queen-key'] || request.headers['X-Queen-Key'];
    const validKey = this.configService.get<string>('QUEEN_BEE_PASSWORD');
    
    if (queenKey && validKey && validKey.length > 0) {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(queenKey),
        Buffer.from(validKey),
      );
      if (isValid) {
        request.user = { id: 'queen', role: 'SUPER_ADMIN', firstName: 'Queen', lastName: 'Bee', email: 'queen@beeseek.site' };
        return true;
      }
    }

    try {
      const result = await super.canActivate(context);
      return !!result;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }
}
