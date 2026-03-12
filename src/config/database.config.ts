import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'dev_password',
  database: process.env.DB_NAME || 'beeseek_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
  // Auto-sync entities in development only — NEVER in production (schema drift risk).
  synchronize: process.env.NODE_ENV !== 'production',
  // Only log SQL in non-production environments to avoid I/O overhead & data leakage in logs.
  logging: process.env.NODE_ENV !== 'production',
  dropSchema: false,
  migrationsRun: true,
};
