import { Controller, Get } from '@nestjs/common';
import { 
  HealthCheckService, 
  TypeOrmHealthIndicator, 
  HealthCheck, 
  HttpHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  MicroserviceHealthIndicator
} from '@nestjs/terminus';
import { RedisOptions, Transport } from '@nestjs/microservices';
import { redisConfig } from '../../config/redis.config';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private http: HttpHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private microservice: MicroserviceHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () => this.disk.checkStorage('storage', { thresholdPercent: 0.9, path: '/' }),
      // Check Redis
      () => this.microservice.pingCheck<RedisOptions>('redis', {
        transport: Transport.REDIS,
        options: {
          host: redisConfig.host,
          port: redisConfig.port,
        },
      }),
      // Check Cloudinary API
      () => this.http.pingCheck('cloudinary', 'https://cloudinary.com'),
    ]);
  }
}
