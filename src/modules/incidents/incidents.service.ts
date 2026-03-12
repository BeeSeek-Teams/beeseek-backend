import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident } from '../../entities/incident.entity';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentRepository: Repository<Incident>,
  ) {}

  async findAll(): Promise<Incident[]> {
    return this.incidentRepository.find({
      relations: ['updates'],
      order: {
        createdAt: 'DESC',
      },
    });
  }
}
