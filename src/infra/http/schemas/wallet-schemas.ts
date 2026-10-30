import { z } from 'zod';

/** Schemas das rotas da carteira. A camada MCP reaproveita os mesmos (sem regra duplicada). */
export const depositBodySchema = z.object(
  {
    amountCents: z
      .number('Informe o valor em centavos (número inteiro).')
      .int('O valor deve ser em centavos inteiros.')
      .positive('O valor do depósito deve ser maior que zero.'),
  },
  'Envie o corpo { amountCents }.',
);

export const idempotencyKeySchema = z
  .string('Envie o cabeçalho Idempotency-Key (8 a 128 caracteres).')
  .trim()
  .min(8, 'A Idempotency-Key precisa de 8 a 128 caracteres.')
  .max(128, 'A Idempotency-Key precisa de 8 a 128 caracteres.');

export const depositHeadersSchema = z.object({ 'idempotency-key': idempotencyKeySchema });

export type DepositBody = z.infer<typeof depositBodySchema>;
