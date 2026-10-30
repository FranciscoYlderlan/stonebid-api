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
    // Segredo do HMAC dos selos (lance, cabeça da cadeia e comprovante, M-12). Só no servidor.
    SEAL_SECRET: z.string().min(32, 'SEAL_SECRET precisa de pelo menos 32 caracteres'),
    // Segredo do pseudônimo do licitante no lote (AD-09), separado do segredo dos selos.
    PSEUDONYM_SECRET: z.string().min(32, 'PSEUDONYM_SECRET precisa de pelo menos 32 caracteres'),
    MCP_ENABLED: booleanFromString,
    MCP_API_KEY: z.string().min(16, 'MCP_API_KEY precisa de pelo menos 16 caracteres').optional(),
    // Teto por depósito em centavos (Q-10). Padrão: R$ 10.000,00.
    DEPOSIT_LIMIT_CENTS: z.coerce.number().int().positive().default(1_000_000),
    // API pública de itens (AD-06): Art Institute of Chicago, sem chave.
    ITEMS_API_BASE_URL: z.url().default('https://api.artic.edu/api/v1'),
    ITEMS_IIIF_BASE_URL: z.url().default('https://www.artic.edu/iiif/2'),
    ITEMS_API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    // Tamanho máximo da imagem copiada para o banco ao criar o lote (padrão 2 MB).
    LOT_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(2 * 1024 * 1024),
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
