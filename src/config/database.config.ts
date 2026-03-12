import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

interface DbUrlConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: { rejectUnauthorized: boolean } | false;
}

// Parse DATABASE_URL if provided (Railway, Heroku, etc.)
function parseDatabaseUrl(): DbUrlConfig | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '5432'),
    username: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace('/', ''),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };
}

const urlConfig = parseDatabaseUrl();

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: urlConfig?.host || process.env.DB_HOST || 'localhost',
  port: urlConfig?.port || parseInt(process.env.DB_PORT || '5432'),
  username: urlConfig?.username || process.env.DB_USERNAME || 'postgres',
  password: urlConfig?.password || process.env.DB_PASSWORD || 'dev_password',
  database: urlConfig?.database || process.env.DB_NAME || 'beeseek_db',
  ssl: urlConfig?.ssl || false,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
  // Auto-sync entities in development, or when DB_SYNCHRONIZE=true (for initial production deploy).
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV !== 'production',
  // Only log SQL in non-production environments to avoid I/O overhead & data leakage in logs.
  logging: process.env.NODE_ENV !== 'production',
  dropSchema: false,
  migrationsRun: true,
};
