import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QueenGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const queenKey = request.headers['x-queen-key'];
    const validKey = this.configService.get<string>('QUEEN_BEE_PASSWORD');

    if (queenKey && queenKey === validKey) {
      return true;
    }

    throw new UnauthorizedException('Invalid Queen Bee credentials');
  }
}
