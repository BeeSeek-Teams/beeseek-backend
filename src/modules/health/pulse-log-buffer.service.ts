import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface PulseLogEntry {
  ts: string;
  level: string;
  context: string;
  message: string;
  meta?: Record<string, any>;
}

/**
 * PulseLogBufferService — Stores application logs in a Redis list
 * so the Pulse dashboard can display them in real-time.
 *
 * Redis key: pulse:logs (list, newest at head, capped at MAX_LOGS)
 */
@Injectable()
export class PulseLogBufferService implements OnModuleInit {
  private readonly logger = new Logger(PulseLogBufferService.name);
  private readonly LOG_KEY = 'pulse:logs';
  private readonly MAX_LOGS = 500;
  private ready = false;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    this.ready = true;
    this.logger.log(
      `PulseLogBuffer ready — buffering up to ${this.MAX_LOGS} entries in Redis`,
    );
  }

  /**
   * Push a log entry into the Redis buffer.
   * Fire-and-forget: errors are silently ignored to never disrupt app flow.
   */
  async push(entry: PulseLogEntry): Promise<void> {
    if (!this.ready) return;
    try {
      const client = this.redis.getClient();
      await client.lPush(this.LOG_KEY, JSON.stringify(entry));
      await client.lTrim(this.LOG_KEY, 0, this.MAX_LOGS - 1);
    } catch {
      // Never throw — log buffer must be invisible to the app
    }
  }

  /**
   * Retrieve the last N log entries (newest first).
   */
  async getLogs(
    count = 200,
    level?: string,
    context?: string,
    search?: string,
  ): Promise<PulseLogEntry[]> {
    try {
      const client = this.redis.getClient();
      // Fetch more than requested so we can filter
      const raw = await client.lRange(this.LOG_KEY, 0, this.MAX_LOGS - 1);
      let logs: PulseLogEntry[] = raw.map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return { ts: '', level: 'log', context: 'unknown', message: r };
        }
      });

      if (level) {
        logs = logs.filter(
          (l) => l.level.toLowerCase() === level.toLowerCase(),
        );
      }
      if (context) {
        logs = logs.filter((l) =>
          l.context.toLowerCase().includes(context.toLowerCase()),
        );
      }
      if (search) {
        const q = search.toLowerCase();
        logs = logs.filter(
          (l) =>
            l.message.toLowerCase().includes(q) ||
            l.context.toLowerCase().includes(q),
        );
      }

      return logs.slice(0, count);
    } catch {
      return [];
    }
  }

  /**
   * Clear all buffered logs.
   */
  async clear(): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.del(this.LOG_KEY);
    } catch {
      // ignore
    }
  }
}
