import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeAuditLotUseCase } from '../../../factories/make-audit-lot-use-case.ts';
import { toLotAuditDto } from '../../presenters/audit-presenter.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

/**
 * Auditoria pública (RF-60, RF-61): sem login (o JWT, se vier, é ignorado) e recalculada a cada
 * acesso, por isso `Cache-Control: no-store`.
 */
export async function auditLotController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const report = await makeAuditLotUseCase().execute(id);
  return reply.status(200).header('cache-control', 'no-store').send(toLotAuditDto(report));
}
