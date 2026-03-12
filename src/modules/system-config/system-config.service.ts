import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../../entities/system-config.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);
  private readonly CACHE_KEY = 'beeseek:system_config';

  constructor(
    @InjectRepository(SystemConfig)
    private configRepository: Repository<SystemConfig>,
    private redisService: RedisService,
  ) {}

  async onModuleInit() {
    // Ensure at least one config row exists
    const count = await this.configRepository.count();
    if (count === 0) {
      await this.configRepository.save({
        clientVersion: '1.0.0',
        clientMinVersion: '1.0.0',
        agentVersion: '1.0.0',
        agentMinVersion: '1.0.0',
      });
      this.logger.log('Initialized default system configuration');
    }
    await this.refreshCache();
  }

  async getConfig(): Promise<SystemConfig | null> {
    const cached = await this.redisService.get(this.CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
    return this.refreshCache();
  }

  async updateConfig(data: Partial<SystemConfig>): Promise<SystemConfig | null> {
    let config = await this.configRepository.findOne({ where: {} });
    if (!config) {
      config = this.configRepository.create(data);
    } else {
      Object.assign(config, data);
    }
    const saved = await this.configRepository.save(config);
    await this.refreshCache();
    return saved;
  }

  async refreshCache(): Promise<SystemConfig | null> {
    const config = await this.configRepository.findOne({ where: {} });
    if (config) {
      await this.redisService.set(this.CACHE_KEY, JSON.stringify(config), 3600 * 24); // 24h cache
    }
    return config;
  }
}
