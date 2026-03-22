import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SosService } from './sos.service';
import { SosController } from './sos.controller';
import { SosAdminController } from './sos-admin.controller';
import { SosAlert } from '../../entities/sos-alert.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SosAlert])],
  providers: [SosService],
  controllers: [SosController, SosAdminController],
  exports: [SosService],
})
export class SosModule {}
