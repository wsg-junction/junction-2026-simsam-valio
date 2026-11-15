import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_PATH: z.string().default('./data/valio.db'),
});

// Treat empty strings from .env as unset.
export const env = envSchema.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')),
);
