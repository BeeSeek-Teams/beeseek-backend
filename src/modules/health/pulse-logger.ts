import { ConsoleLogger, Injectable, Scope } from '@nestjs/common';
import { PulseLogBufferService, PulseLogEntry } from './pulse-log-buffer.service';

/**
 * PulseLogger — A NestJS logger that extends ConsoleLogger and pushes
 * every log entry to the PulseLogBufferService (Redis) for the dashboard.
 *
 * Set as the app-level logger via app.useLogger() in main.ts.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class PulseLogger extends ConsoleLogger {
  private static buffer: PulseLogBufferService | null = null;

  /**
   * Called once during bootstrap to wire up the Redis buffer.
   */
  static setBuffer(buffer: PulseLogBufferService) {
    PulseLogger.buffer = buffer;
  }

  log(message: any, ...optionalParams: any[]) {
    super.log(message, ...optionalParams);
    this.pushToBuffer('log', message, optionalParams);
  }

  error(message: any, ...optionalParams: any[]) {
    super.error(message, ...optionalParams);
    this.pushToBuffer('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]) {
    super.warn(message, ...optionalParams);
    this.pushToBuffer('warn', message, optionalParams);
  }

  debug(message: any, ...optionalParams: any[]) {
    super.debug(message, ...optionalParams);
    this.pushToBuffer('debug', message, optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]) {
    super.verbose(message, ...optionalParams);
    this.pushToBuffer('verbose', message, optionalParams);
  }

  private pushToBuffer(level: string, message: any, optionalParams: any[]) {
    if (!PulseLogger.buffer) return;

    // NestJS passes context as the last string param
    let context = this.context || 'App';
    let meta: Record<string, any> | undefined;

    if (optionalParams.length > 0) {
      const last = optionalParams[optionalParams.length - 1];
      if (typeof last === 'string') {
        context = last;
      }
      // If there's a stack trace (error), capture it
      if (optionalParams.length > 1 && typeof optionalParams[0] === 'string') {
        meta = { stack: optionalParams[0] };
      }
    }

    const entry: PulseLogEntry = {
      ts: new Date().toISOString(),
      level,
      context,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      meta,
    };

    // Fire-and-forget
    PulseLogger.buffer.push(entry).catch(() => {});
  }
}
