import { Controller, Get } from '@nestjs/common';
import { IncidentsService } from '../incidents/incidents.service';

@Controller('status')
export class StatusEventsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  private startTime = Date.now();

  @Get('events')
  async getEvents() {
    const incidents = await this.incidentsService.findAll();
    const incidentEvents = incidents.slice(0, 5).map(i => ({
      id: i.id,
      title: i.title,
      msg: i.status === 'Resolved' ? 'Incident resolved successfully' : 'Active investigation ongoing',
      time: i.updatedAt.toLocaleTimeString(),
      type: i.severity === 'Critical' ? 'warning' : 'info'
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
    // Return real unresolved incidents as alerts
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
  getSummary() {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeHours = (uptimeMs / 3_600_000).toFixed(1);
    return {
      uptime: `${uptimeHours}h (process)`,
      avgLatency: 'N/A',
      securityStatus: 'Active',
    };
  }

  @Get('latency-history')
  getLatencyHistory() {
    // Real latency tracking requires APM integration (e.g. Sentry, Datadog)
    return [];
  }
}
