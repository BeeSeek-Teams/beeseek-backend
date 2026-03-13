import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = (exceptionResponse as any).message || exception.message;
      errors = (exceptionResponse as any).error;
      // Log client errors (4xx) at warn level for debugging
      if (status >= 400 && status < 500) {
        this.logger.warn(
          `${request.method} ${request.url} → ${status}: ${Array.isArray(message) ? message.join(', ') : message}`,
        );
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );
    }

    // Don't expose sensitive internal errors in production
    if (
      process.env.NODE_ENV === 'production' &&
      status === HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      message = 'An unexpected error occurred. Please try again later.';
    }

    response.status(status).json({
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
