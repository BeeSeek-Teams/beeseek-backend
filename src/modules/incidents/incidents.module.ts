import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../../entities/incident.entity';
import { IncidentUpdate } from '../../entities/incident-update.entity';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [TypeOrmModule.forFeature([Incident, IncidentUpdate])],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
