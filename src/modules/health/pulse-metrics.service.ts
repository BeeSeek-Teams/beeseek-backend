import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisService } from '../redis/redis.service';
import { DataSource } from 'typeorm';

/**
 * PulseMetricsService — Collects and stores real latency, uptime, and
 * infrastructure metrics in Redis for the Pulse status dashboard.
 *
 * Redis keys used:
 *   pulse:latency:history    — sorted set of { timestamp: latencyMs } (24h)
 *   pulse:uptime:daily       — hash  { "YYYY-MM-DD": "up"|"degraded"|"down" } (90d)
 *   pulse:uptime:checks      — hash  { "YYYY-MM-DD": "total:pass" }
 *   pulse:meta               — hash  { startedAt, lastCheck }
 */
@Injectable()
export class PulseMetricsService implements OnModuleInit {
  private readonly logger = new Logger(PulseMetricsService.name);
  private readonly LATENCY_KEY = 'pulse:latency:history';
  private readonly UPTIME_KEY = 'pulse:uptime:daily';
  private readonly CHECKS_KEY = 'pulse:uptime:checks';
  private readonly RESOURCE_KEY = 'pulse:resources:history';
  private readonly META_KEY = 'pulse:meta';
  private readonly RETENTION_24H = 86_400; // seconds
  private readonly RETENTION_90D = 90; // days
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();

  constructor(
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.redis.hSet(this.META_KEY, 'startedAt', new Date().toISOString());
    this.logger.log('PulseMetricsService initialised — latency probes starting');
  }

  // ─── Run every 30 seconds ──────────────────────────────────────────
  @Cron('*/30 * * * * *')
  async probe() {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 1) Measure DB latency
    let dbLatency = -1;
    try {
      const t0 = Date.now();
      await this.dataSource.query('SELECT 1');
      dbLatency = Date.now() - t0;
    } catch {
      dbLatency = -1;
    }

    // 2) Measure Redis latency
    let redisLatency = -1;
    try {
      const t0 = Date.now();
      await this.redis.set('pulse:ping', 'pong', 10);
      redisLatency = Date.now() - t0;
    } catch {
      redisLatency = -1;
    }

    // 3) Overall latency = max(db, redis) — represents slowest component
    const overallLatency = Math.max(dbLatency, redisLatency);
    const isUp = dbLatency >= 0 && redisLatency >= 0;

    // 4) Store in sorted set (score = timestamp, value = JSON blob)
    const client = this.redis.getClient();
    const entry = JSON.stringify({
      ts: now,
      overall: overallLatency,
      db: dbLatency,
      redis: redisLatency,
    });
    await client.zAdd(this.LATENCY_KEY, { score: now, value: entry });

    // Trim entries older than 24h
    const cutoff = now - this.RETENTION_24H * 1000;
    await client.zRemRangeByScore(this.LATENCY_KEY, 0, cutoff);

    // 5) Update daily uptime tracking
    const checksRaw = await this.redis.hGet(this.CHECKS_KEY, today);
    let [total, pass] = checksRaw ? checksRaw.split(':').map(Number) : [0, 0];
    total++;
    if (isUp) pass++;
    await this.redis.hSet(this.CHECKS_KEY, today, `${total}:${pass}`);

    const ratio = pass / total;
    const status = ratio >= 0.99 ? 'up' : ratio >= 0.9 ? 'degraded' : 'down';
    await this.redis.hSet(this.UPTIME_KEY, today, status);

    // 6) Trim uptime data older than 90 days
    const allDays = Object.keys(await this.redis.hGetAll(this.UPTIME_KEY));
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_90D);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    for (const day of allDays) {
      if (day < cutoffStr) {
        await client.hDel(this.UPTIME_KEY, day);
        await client.hDel(this.CHECKS_KEY, day);
      }
    }

    // 7) Collect CPU + memory snapshot and store in sorted set
    const cpuNow = process.cpuUsage(this.lastCpuUsage);
    const elapsed = (Date.now() - this.lastCpuTime) * 1000; // microseconds
    const cpuPercent = elapsed > 0
      ? Math.min(100, Math.round(((cpuNow.user + cpuNow.system) / elapsed) * 100 * 10) / 10)
      : 0;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();

    const mem = process.memoryUsage();
    const resourceEntry = JSON.stringify({
      ts: now,
      cpuPercent,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
    });
    await client.zAdd(this.RESOURCE_KEY, { score: now, value: resourceEntry });
    await client.zRemRangeByScore(this.RESOURCE_KEY, 0, cutoff);

    await this.redis.hSet(this.META_KEY, 'lastCheck', new Date().toISOString());
  }

  // ─── Public query methods ──────────────────────────────────────────

  /** Last 24h of latency measurements (for the bar chart) */
  async getLatencyHistory(points = 48): Promise<{
    ts: number;
    overall: number;
    db: number;
    redis: number;
  }[]> {
    const client = this.redis.getClient();
    const cutoff = Date.now() - this.RETENTION_24H * 1000;
    const raw = await client.zRangeByScore(this.LATENCY_KEY, cutoff, '+inf');
    const parsed = raw.map((r) => JSON.parse(r));

    // Downsample to `points` buckets
    if (parsed.length <= points) return parsed;
    const step = Math.ceil(parsed.length / points);
    const sampled: typeof parsed = [];
    for (let i = 0; i < parsed.length; i += step) {
      const slice = parsed.slice(i, i + step);
      sampled.push({
        ts: slice[Math.floor(slice.length / 2)].ts,
        overall: Math.round(slice.reduce((s, e) => s + e.overall, 0) / slice.length),
        db: Math.round(slice.reduce((s, e) => s + e.db, 0) / slice.length),
        redis: Math.round(slice.reduce((s, e) => s + e.redis, 0) / slice.length),
      });
    }
    return sampled;
  }

  /** Percentiles from last 24h */
  async getPercentiles(): Promise<{
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    min: number;
    max: number;
    samples: number;
  }> {
    const client = this.redis.getClient();
    const cutoff = Date.now() - this.RETENTION_24H * 1000;
    const raw = await client.zRangeByScore(this.LATENCY_KEY, cutoff, '+inf');
    const values = raw.map((r) => JSON.parse(r).overall as number).filter((v) => v >= 0).sort((a, b) => a - b);
    if (values.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, samples: 0 };
    }
    const pct = (p: number) => values[Math.min(Math.floor(values.length * p), values.length - 1)];
    return {
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      min: values[0],
      max: values[values.length - 1],
      samples: values.length,
    };
  }

  /** 90-day uptime timeline */
  async getUptimeHistory(): Promise<{
    date: string;
    status: 'up' | 'degraded' | 'down';
    uptimePercent: number;
  }[]> {
    const uptimeRaw = await this.redis.hGetAll(this.UPTIME_KEY);
    const checksRaw = await this.redis.hGetAll(this.CHECKS_KEY);

    // Fill in last 90 days
    const result: { date: string; status: 'up' | 'degraded' | 'down'; uptimePercent: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const checksStr = checksRaw[key];
      if (checksStr) {
        const [total, pass] = checksStr.split(':').map(Number);
        const pct = total > 0 ? Math.round((pass / total) * 10000) / 100 : 100;
        result.push({
          date: key,
          status: (uptimeRaw[key] as 'up' | 'degraded' | 'down') || 'up',
          uptimePercent: pct,
        });
      } else {
        result.push({ date: key, status: 'up', uptimePercent: 100 });
      }
    }
    return result;
  }

  /** Resource usage time-series (CPU, memory) — last N hours */
  async getResourceHistory(hours = 24, points = 96): Promise<{
    ts: number;
    cpuPercent: number;
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
  }[]> {
    const client = this.redis.getClient();
    const cutoff = Date.now() - hours * 3600 * 1000;
    const raw = await client.zRangeByScore(this.RESOURCE_KEY, cutoff, '+inf');
    const parsed = raw.map((r) => {
      const e = JSON.parse(r);
      return {
        ts: e.ts,
        cpuPercent: e.cpuPercent,
        rssMB: Math.round((e.rssBytes / 1024 / 1024) * 10) / 10,
        heapUsedMB: Math.round((e.heapUsedBytes / 1024 / 1024) * 10) / 10,
        heapTotalMB: Math.round((e.heapTotalBytes / 1024 / 1024) * 10) / 10,
        externalMB: Math.round((e.externalBytes / 1024 / 1024) * 10) / 10,
      };
    });

    if (parsed.length <= points) return parsed;
    const step = Math.ceil(parsed.length / points);
    const sampled: typeof parsed = [];
    for (let i = 0; i < parsed.length; i += step) {
      const slice = parsed.slice(i, i + step);
      const n = slice.length;
      sampled.push({
        ts: slice[Math.floor(n / 2)].ts,
        cpuPercent: Math.round(slice.reduce((s, e) => s + e.cpuPercent, 0) / n * 10) / 10,
        rssMB: Math.round(slice.reduce((s, e) => s + e.rssMB, 0) / n * 10) / 10,
        heapUsedMB: Math.round(slice.reduce((s, e) => s + e.heapUsedMB, 0) / n * 10) / 10,
        heapTotalMB: Math.round(slice.reduce((s, e) => s + e.heapTotalMB, 0) / n * 10) / 10,
        externalMB: Math.round(slice.reduce((s, e) => s + e.externalMB, 0) / n * 10) / 10,
      });
    }
    return sampled;
  }

  /** DB / Redis specific metrics */
  async getInfraMetrics(): Promise<{
    database: { latency: number; status: string };
    redis: { latency: number; status: string; memoryUsed: string };
    process: { uptimeSeconds: number; memoryMB: number; cpuPercent: number };
  }> {
    // DB latency
    let dbLatency = -1;
    try {
      const t0 = Date.now();
      await this.dataSource.query('SELECT 1');
      dbLatency = Date.now() - t0;
    } catch { /* noop */ }

    // Redis latency + memory
    let redisLatency = -1;
    let redisMemory = 'N/A';
    try {
      const t0 = Date.now();
      await this.redis.set('pulse:ping', 'pong', 10);
      redisLatency = Date.now() - t0;
      const info = await this.redis.getClient().info('memory');
      const match = info.match(/used_memory_human:(.+)/);
      if (match) redisMemory = match[1].trim();
    } catch { /* noop */ }

    const mem = process.memoryUsage();
    const cpuNow = process.cpuUsage();
    const elapsed = (Date.now() - this.lastCpuTime) * 1000;
    const cpuPercent = elapsed > 0
      ? Math.min(100, Math.round(((cpuNow.user + cpuNow.system) / elapsed) * 100 * 10) / 10)
      : 0;
    return {
      database: { latency: dbLatency, status: dbLatency >= 0 ? 'up' : 'down' },
      redis: { latency: redisLatency, status: redisLatency >= 0 ? 'up' : 'down', memoryUsed: redisMemory },
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
        cpuPercent,
      },
    };
  }
}
