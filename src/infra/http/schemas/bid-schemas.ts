import { z } from 'zod';
import { MAX_CENTS } from './lot-schemas.ts';
import { idempotencyKeySchema } from './wallet-schemas.ts';

/** Schemas das rotas de lances. A camada MCP reaproveita os mesmos (sem regra duplicada). */
export const placeBidBodySchema = z.object(
  {
    amountCents: z
      .number('Informe o valor do lance em centavos (número inteiro).')
      .int('O lance deve ser em centavos inteiros.')
      .positive('O lance deve ser maior que zero.')
      .max(MAX_CENTS, 'O lance passa do limite de R$ 20.000.000,00.'),
  },
  'Envie o corpo { amountCents }.',
);

/** Mesmo cabeçalho do depósito (RN-18): o cliente guarda a chave até o lance dar certo. */
export const placeBidHeadersSchema = z.object({ 'idempotency-key': idempotencyKeySchema });

export type PlaceBidBody = z.infer<typeof placeBidBodySchema>;
