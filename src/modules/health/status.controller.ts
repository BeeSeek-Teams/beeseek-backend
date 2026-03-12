import { Controller, Get, Post, Body, Param, Header, Res, Query } from '@nestjs/common';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { IncidentsService } from '../incidents/incidents.service';
import { PulseMetricsService } from './pulse-metrics.service';
import { MaintenanceWindow } from '../../entities/maintenance-window.entity';
import { StatusSubscriber } from '../../entities/status-subscriber.entity';
import { v4 as uuidv4 } from 'uuid';

@Controller('status')
export class StatusEventsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly pulseMetrics: PulseMetricsService,
    @InjectRepository(MaintenanceWindow)
    private readonly maintenanceRepo: Repository<MaintenanceWindow>,
    @InjectRepository(StatusSubscriber)
    private readonly subscriberRepo: Repository<StatusSubscriber>,
  ) {}

  private startTime = Date.now();

  // ─── Existing endpoints (improved) ─────────────────────────────

  @Get('events')
  async getEvents() {
    const incidents = await this.incidentsService.findAll();
    const incidentEvents = incidents.slice(0, 5).map(i => ({
      id: i.id,
      title: i.title,
      msg: i.status === 'Resolved' ? 'Incident resolved successfully' : 'Active investigation ongoing',
      time: i.updatedAt.toLocaleTimeString(),
      type: i.severity === 'Critical' ? 'warning' : i.status === 'Resolved' ? 'success' : 'info',
    }));
    return incidentEvents;
  }

  @Get('incidents')
  async getIncidents() {
    const incidents = await this.incidentsService.findAll();
    return incidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      severity: incident.severity,
      date: incident.createdAt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      time: `${incident.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} ${incident.status === 'Resolved' ? '- ' + incident.updatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} WAT`,
      updates: incident.updates?.map((u) => ({
        time: u.timestamp.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        msg: u.message,
      })) || [],
    }));
  }

  @Get('alerts')
  async getAlerts() {
    const incidents = await this.incidentsService.findAll();
    return incidents
      .filter(i => i.status !== 'Resolved')
      .slice(0, 10)
      .map(i => ({
        type: i.severity === 'Critical' ? 'Error' : 'Warning',
        msg: i.title,
        project: 'Backend',
        time: i.createdAt.toLocaleTimeString(),
      }));
  }

  @Get('security')
  getSecurity() {
    return {
      rotation: 'Configured',
      anomalies: 'Monitoring Active',
      score: 'N/A',
    };
  }

  @Get('summary')
  async getSummary() {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeHours = (uptimeMs / 3_600_000).toFixed(1);
    const percentiles = await this.pulseMetrics.getPercentiles();
    return {
      uptime: `${uptimeHours}h (process)`,
      avgLatency: percentiles.samples > 0 ? `${percentiles.avg}ms` : 'Collecting...',
      securityStatus: 'Active',
      percentiles,
    };
  }

  // ─── Real latency data ─────────────────────────────────────────

  @Get('latency-history')
  async getLatencyHistory(@Query('points') points?: string) {
    const n = points ? parseInt(points, 10) : 48;
    return this.pulseMetrics.getLatencyHistory(Math.min(n, 200));
  }

  @Get('percentiles')
  async getPercentiles() {
    return this.pulseMetrics.getPercentiles();
  }

  // ─── Uptime timeline (90 days) ────────────────────────────────

  @Get('uptime-history')
  async getUptimeHistory() {
    return this.pulseMetrics.getUptimeHistory();
  }

  // ─── Infrastructure metrics ────────────────────────────────────

  @Get('infra-metrics')
  async getInfraMetrics() {
    return this.pulseMetrics.getInfraMetrics();
  }

  // ─── Resource usage history (CPU, memory charts) ──────────────

  @Get('resource-history')
  async getResourceHistory(
    @Query('hours') hours?: string,
    @Query('points') points?: string,
  ) {
    const h = hours ? parseInt(hours, 10) : 24;
    const p = points ? parseInt(points, 10) : 96;
    return this.pulseMetrics.getResourceHistory(Math.min(h, 168), Math.min(p, 500));
  }

  // ─── Maintenance windows ──────────────────────────────────────

  @Get('maintenance')
  async getMaintenance() {
    return this.maintenanceRepo.find({
      order: { scheduledStart: 'ASC' },
      where: { scheduledStart: MoreThan(new Date(Date.now() - 30 * 86_400_000)) },
    });
  }

  // ─── Subscriber management ────────────────────────────────────

  @Post('subscribe')
  async subscribe(@Body('email') email: string) {
    if (!email || !email.includes('@')) {
      return { ok: false, message: 'Valid email required' };
    }
    const existing = await this.subscriberRepo.findOne({ where: { email } });
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        existing.unsubscribeToken = uuidv4();
        await this.subscriberRepo.save(existing);
      }
      return { ok: true, message: 'Already subscribed' };
    }
    const sub = this.subscriberRepo.create({
      email,
      unsubscribeToken: uuidv4(),
    });
    await this.subscriberRepo.save(sub);
    return { ok: true, message: 'Successfully subscribed to status updates' };
  }

  @Get('unsubscribe/:token')
  async unsubscribe(@Param('token') token: string) {
    const sub = await this.subscriberRepo.findOne({ where: { unsubscribeToken: token } });
    if (!sub) return { ok: false, message: 'Invalid token' };
    sub.isActive = false;
    await this.subscriberRepo.save(sub);
    return { ok: true, message: 'Successfully unsubscribed' };
  }

  // ─── Public status badge (SVG) ────────────────────────────────

  @Get('badge.svg')
  async getBadge(@Res() res: Response) {
    const infra = await this.pulseMetrics.getInfraMetrics();
    const isUp = infra.database.status === 'up' && infra.redis.status === 'up';
    const label = isUp ? 'operational' : 'outage';
    const color = isUp ? '#00C164' : '#FF453A';
    const labelWidth = 50;
    const valueWidth = isUp ? 85 : 55;
    const totalWidth = labelWidth + valueWidth;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="status: ${label}">
  <title>status: ${label}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="14">status</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${label}</text>
  </g>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.send(svg);
  }
}
