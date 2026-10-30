import { z } from 'zod';
import { IMAGE_ID_PATTERN } from '../../external/artic-item-catalog.ts';

/** Teto de centavos: cabe no INTEGER do PostgreSQL (R$ 20 milhões). */
export const MAX_CENTS = 2_000_000_000;

function cents(field: string) {
  return z
    .number(`Informe ${field} em centavos.`)
    .int(`${capitalize(field)} deve ser um número inteiro de centavos.`)
    .positive(`${capitalize(field)} deve ser maior que zero.`)
    .max(MAX_CENTS, `${capitalize(field)} passa do limite de R$ 20.000.000,00.`);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Schemas das rotas de lotes e da busca de itens. A camada MCP reaproveita os mesmos. */
export const createLotBodySchema = z.object({
  externalId: z.string('Informe o item (externalId).').trim().min(1, 'Informe o item.').max(64),
  startingBidCents: cents('o lance inicial'),
  minIncrementCents: cents('o incremento mínimo'),
  startsAt: z.iso.datetime({
    offset: true,
    error: 'Informe o início em data e hora ISO 8601 (ex.: 2026-10-30T12:00:00Z).',
  }),
  endsAt: z.iso.datetime({
    offset: true,
    error: 'Informe o fim em data e hora ISO 8601 (ex.: 2026-10-30T12:30:00Z).',
  }),
});

export const lotIdParamsSchema = z.object({
  id: z.string().min(1),
});

/** Corpo da tool MCP da busca; a rota lê os mesmos campos da query string. */
export const searchItemsInputSchema = z.object({
  q: z.string().trim().max(100, 'A busca aceita até 100 caracteres.').optional(),
  page: z
    .number()
    .int('A página deve ser um número inteiro.')
    .min(1, 'A página começa em 1.')
    .max(1000, 'A página vai até 1000.')
    .optional(),
});

export const searchItemsQuerySchema = z.object({
  q: z.string().trim().max(100, 'A busca aceita até 100 caracteres.').default(''),
  page: z.coerce
    .number('A página deve ser um número.')
    .int('A página deve ser um número inteiro.')
    .min(1, 'A página começa em 1.')
    .max(1000, 'A página vai até 1000.')
    .default(1),
});

/** Id da imagem da miniatura: só UUID; o servidor monta a URL do IIIF (sem SSRF). */
export const itemImageParamsSchema = z.object({
  imageId: z.string().regex(IMAGE_ID_PATTERN, 'Id de imagem inválido.'),
});

export type CreateLotBody = z.infer<typeof createLotBodySchema>;
