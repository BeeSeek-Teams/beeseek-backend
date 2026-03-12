import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../entities/user.entity';
import { SosService } from './sos.service';
import { DispatchSosDto } from './sos.dto';

@Controller('sos')
@UseGuards(JwtAuthGuard)
export class SosController {
  constructor(private readonly sosService: SosService) {}

  @Post('dispatch')
  dispatchSos(@CurrentUser() user: User, @Body() dto: DispatchSosDto) {
    return this.sosService.dispatchSos(user, dto);
  }
}
