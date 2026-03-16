import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exceptions/all-exceptions.filter';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { PulseLogger } from './modules/health/pulse-logger';
import { PulseLogBufferService } from './modules/health/pulse-log-buffer.service';

async function bootstrap() {
  const logger = new NestLogger('Main');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Wire up PulseLogger: pushes every log to Redis for the Pulse dashboard
  try {
    const logBuffer = app.get(PulseLogBufferService);
    PulseLogger.setBuffer(logBuffer);
    app.useLogger(new PulseLogger());
    logger.log('PulseLogger activated — logs streaming to Redis');
  } catch {
    logger.warn('PulseLogBufferService not available, falling back to default logger');
  }

  // Socket.IO Redis adapter for horizontal scaling
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Response compression — reduces payload size by ~70% on JSON (critical for 2G/3G)
  app.use(compression());

  // Increase body parser limits for JSON and URL-encoded payloads
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

  // CORS — locked to real origins; never use `origin: true` in production
  const allowedOrigins = [
    'https://beeseek.site',
    'https://www.beeseek.site',
    'https://admin.beeseek.site',
    'https://pulse.beeseek.site',
    'https://beeseek-admin.vercel.app',
  ];
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-queen-key'],
  });

  // Security: Helmet
  app.use(helmet());

  // Validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger API documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('BeeSeek API')
    .setDescription('BeeSeek platform API — connects clients with local service agents')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-queen-key', in: 'header' }, 'queen-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
  logger.log('📚 Swagger docs available at /docs');

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
