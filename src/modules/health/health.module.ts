import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { StatusEventsController } from './status.controller';
import { PulseMetricsService } from './pulse-metrics.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { IncidentsModule } from '../incidents/incidents.module';
import { MaintenanceWindow } from '../../entities/maintenance-window.entity';
import { StatusSubscriber } from '../../entities/status-subscriber.entity';

@Module({
  imports: [
    TerminusModule,
    TypeOrmModule.forFeature([MaintenanceWindow, StatusSubscriber]),
    HttpModule,
    IncidentsModule,
  ],
  controllers: [HealthController, StatusEventsController],
  providers: [PulseMetricsService],
  exports: [PulseMetricsService],
})
export class HealthModule {}
