import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPresence, UserStatus } from '../../entities/user-presence.entity';
import { User } from '../../entities/user.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly PRESENCE_KEY_PREFIX = 'presence:';

  constructor(
    @InjectRepository(UserPresence)
    private presenceRepository: Repository<UserPresence>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Update presence for a user in Redis (Fast) and periodically in DB
   */
  async heartbeat(userId: string) {
    const now = new Date();
    const redisKey = `${this.PRESENCE_KEY_PREFIX}${userId}`;

    // 1. Update Redis (TTL 60 seconds)
    // We store JSON string: { status: 'ONLINE', lastSeenAt: timestamp }
    const presenceData = {
      status: UserStatus.ONLINE,
      lastSeenAt: now.getTime(),
    };

    await this.redisService.set(redisKey, JSON.stringify(presenceData), 60);

    // 2. Periodic DB Sync (to avoid DB hammering)
    // Only update DB if the record is missing or last update was > 5 mins ago
    // We can use another Redis key to track DB sync throttle
    const dbSyncKey = `dbSync:${userId}`;
    const needsDbSync = !(await this.redisService.get(dbSyncKey));

    if (needsDbSync) {
      try {
        // Check if user exists before attempting to save presence
        const userExists = await this.userRepository.findOne({
          where: { id: userId },
        });
        
        if (!userExists) {
          this.logger.warn(`User ${userId} not found, skipping presence sync`);
          return presenceData;
        }

        let presence = await this.presenceRepository.findOne({
          where: { userId },
        });
        if (!presence) {
          presence = this.presenceRepository.create({
            userId,
            status: UserStatus.ONLINE,
            lastSeenAt: now,
          });
        } else {
          presence.lastSeenAt = now;
          presence.status = UserStatus.ONLINE;
        }
        await this.presenceRepository.save(presence);

        // Throttle DB sync for 5 minutes
        await this.redisService.set(dbSyncKey, 'true', 300);
      } catch (error) {
        this.logger.error(
          `DB Presence sync failed for ${userId}: ${error.message}`,
        );
      }
    }

    return presenceData;
  }

  /**
   * Get status for multiple users at once (Very Fast - Redis MGET)
   */
  async getBatchStatus(userIds: string[]) {
    if (!userIds.length) return {};

    const keys = userIds.map((id) => `${this.PRESENCE_KEY_PREFIX}${id}`);
    const results = await this.redisService.mGet(keys);

    const statuses: Record<string, any> = {};

    userIds.forEach((id, index) => {
      const data = results[index];
      if (data) {
        try {
          statuses[id] = JSON.parse(data);
        } catch (e) {
          statuses[id] = { status: UserStatus.OFFLINE };
        }
      } else {
        statuses[id] = { status: UserStatus.OFFLINE };
      }
    });

    return statuses;
  }

  /**
   * Force a user offline
   */
  async setOffline(userId: string) {
    const now = new Date();
    const redisKey = `${this.PRESENCE_KEY_PREFIX}${userId}`;

    // 1. Update Redis with OFFLINE status
    const presenceData = {
      status: UserStatus.OFFLINE,
      lastSeenAt: now.getTime(),
    };
    await this.redisService.set(redisKey, JSON.stringify(presenceData), 86400); // Keep offline status for 24h

    // 2. Update DB immediately on logout/disconnect
    await this.presenceRepository.update(userId, {
      status: UserStatus.OFFLINE,
      lastSeenAt: now,
    });

    return presenceData;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePresenceCleanup() {
    // This is less critical now as Redis TTL handles it,
    // but we'll keep it to ensure DB consistency for users who just vanish
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    await this.presenceRepository
      .createQueryBuilder()
      .update(UserPresence)
      .set({ status: UserStatus.OFFLINE })
      .where('lastSeenAt < :threshold', { threshold })
      .andWhere('status = :status', { status: UserStatus.ONLINE })
      .execute();
  }

  async getStatus(userId: string): Promise<UserStatus> {
    const redisKey = `${this.PRESENCE_KEY_PREFIX}${userId}`;
    const cached = await this.redisService.get(redisKey);

    if (cached) {
      try {
        const data = JSON.parse(cached);
        return data.status;
      } catch (e) {}
    }

    const presence = await this.presenceRepository.findOne({
      where: { userId },
    });
    return presence ? presence.status : UserStatus.OFFLINE;
  }
}
