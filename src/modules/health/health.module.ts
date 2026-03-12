import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { StatusEventsController } from './status.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [
    TerminusModule,
    TypeOrmModule,
    HttpModule,
    IncidentsModule,
  ],
  controllers: [HealthController, StatusEventsController],
  providers: [],
})
export class HealthModule {}
