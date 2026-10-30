import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeGetLotUseCase } from '../../../factories/make-get-lot-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

/**
 * Autenticação opcional (RF-30): com JWT válido de licitante, o lote traz `viewer.pseudonym`; sem
 * token, com token inválido ou de leiloeiro, `viewer` é `null`. Nunca 401.
 */
async function optionalBidderId(request: FastifyRequest): Promise<string | null> {
  if (!request.headers.authorization) return null;
  try {
    await request.jwtVerify();
  } catch {
    return null;
  }
  return request.user.role === 'BIDDER' ? request.user.sub : null;
}

export async function getLotController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const viewerId = await optionalBidderId(request);
  const { lot, now } = await makeGetLotUseCase().execute(id);
  return reply
    .status(200)
    .send({ serverTime: now.toISOString(), lot: toLotDto(lot, now, viewerId) });
}
