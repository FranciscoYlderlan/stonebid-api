import 'dotenv/config';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
    CORS_ORIGIN: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    SEED_PASSWORD: z.string().min(8).optional(),
    MCP_ENABLED: booleanFromString,
    MCP_API_KEY: z.string().min(16, 'MCP_API_KEY precisa de pelo menos 16 caracteres').optional(),
  })
  .superRefine((env, ctx) => {
    if (!env.MCP_ENABLED) return;
    if (!env.MCP_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_API_KEY'],
        message: 'MCP_API_KEY é obrigatória quando MCP_ENABLED=true',
      });
    }
    if (!env.SEED_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['SEED_PASSWORD'],
        message: 'SEED_PASSWORD é obrigatória quando MCP_ENABLED=true (tool entrar)',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', z.treeifyError(parsed.error));
  throw new Error('Variáveis de ambiente inválidas.');
}

export const env = parsed.data;
export type Env = typeof env;
