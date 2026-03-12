import { Module } from '@nestjs/common';
import { SosService } from './sos.service';
import { SosController } from './sos.controller';

@Module({
  providers: [SosService],
  controllers: [SosController],
  exports: [SosService],
})
export class SosModule {}
