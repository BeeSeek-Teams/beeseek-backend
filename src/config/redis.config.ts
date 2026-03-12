import * as dotenv from 'dotenv';

dotenv.config();

// Parse REDIS_URL if provided (Railway, Heroku, etc.)
function parseRedisUrl() {
  const url = process.env.REDIS_URL;
  if (!url) return {};

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379'),
    password: parsed.password || undefined,
  };
}

const urlConfig = parseRedisUrl();

const host = urlConfig.host || process.env.REDIS_HOST || 'localhost';
const port = urlConfig.port || parseInt(process.env.REDIS_PORT || '6379');
const password = urlConfig.password || process.env.REDIS_PASSWORD || undefined;

// Build a full Redis URL with auth if password is present, or use REDIS_URL directly
export const redisUrl: string =
  process.env.REDIS_URL || (password
    ? `redis://:${encodeURIComponent(password)}@${host}:${port}`
    : `redis://${host}:${port}`);

export const redisConfig = {
  host,
  port,
  password,
  db: 0,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};
