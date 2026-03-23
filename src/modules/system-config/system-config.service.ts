import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../../entities/system-config.entity';
import { MaintenanceWindow, MaintenanceStatus } from '../../entities/maintenance-window.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);
  private readonly CACHE_KEY = 'beeseek:system_config';

  constructor(
    @InjectRepository(SystemConfig)
    private configRepository: Repository<SystemConfig>,
    @InjectRepository(MaintenanceWindow)
    private maintenanceRepo: Repository<MaintenanceWindow>,
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
    // Check if maintenance mode is being toggled
    const oldConfig = await this.configRepository.findOne({ where: {} });
    const wasInMaintenance = oldConfig?.maintenanceMode === 'true' || oldConfig?.maintenanceMode === '1';
    const isEnteringMaintenance = data.maintenanceMode === 'true' || data.maintenanceMode === '1';

    let config = oldConfig;
    if (!config) {
      config = this.configRepository.create(data);
    } else {
      Object.assign(config, data);
    }
    const saved = await this.configRepository.save(config);
    await this.refreshCache();

    // Auto-create maintenance window when entering maintenance mode
    if (!wasInMaintenance && isEnteringMaintenance) {
      const window = this.maintenanceRepo.create({
        title: 'Unscheduled Maintenance',
        description: 'BeeSeek is currently under maintenance. Service will be restored shortly.',
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 2 * 60 * 60 * 1000), // Default 2hr window
        affectedServices: 'All Services',
        status: MaintenanceStatus.IN_PROGRESS,
      });
      await this.maintenanceRepo.save(window);
      this.logger.log('[SYSTEM-CONFIG] Maintenance mode ON — auto-created maintenance window');
    }

    // Auto-complete active windows when leaving maintenance mode
    if (wasInMaintenance && !isEnteringMaintenance) {
      const activeWindows = await this.maintenanceRepo.find({
        where: [{ status: MaintenanceStatus.IN_PROGRESS }, { status: MaintenanceStatus.SCHEDULED }],
      });
      for (const w of activeWindows) {
        if (w.title === 'Unscheduled Maintenance') {
          w.status = MaintenanceStatus.COMPLETED;
          w.scheduledEnd = new Date(); // Set actual end time
          await this.maintenanceRepo.save(w);
        }
      }
      this.logger.log('[SYSTEM-CONFIG] Maintenance mode OFF — auto-completed unscheduled windows');
    }

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
