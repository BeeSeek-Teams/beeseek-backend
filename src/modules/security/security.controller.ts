import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SecurityService } from './security.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('security')
@UseGuards(JwtAuthGuard)
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('status')
  getStatus(@Req() req) {
    return this.securityService.getSecurityStatus(req.user.id);
  }

  @Post('set-pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  setPin(@Req() req, @Body() body: { pin: string }) {
    return this.securityService.setTransactionPin(req.user.id, body.pin);
  }

  @Post('verify-pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  verifyPin(@Req() req, @Body() body: { pin: string }) {
    return this.securityService.verifyTransactionPin(req.user.id, body.pin);
  }

  @Post('toggle-biometrics')
  @HttpCode(HttpStatus.OK)
  toggleBiometrics(@Req() req, @Body() body: { enabled: boolean }) {
    return this.securityService.updateBiometrics(req.user.id, body.enabled);
  }
}
