import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeCancelLotUseCase } from '../../../factories/make-cancel-lot-use-case.ts';
import { sendError } from '../../errors/error-handler.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { cancelLotBodySchema, lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

/** Motivo ausente ou fora de 3 a 280 caracteres → 422 `VALIDATION_ERROR` (contrato do I3). */
export async function cancelLotController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const body = cancelLotBodySchema.safeParse(request.body);
  if (!body.success) {
    const issues = body.error.issues;
    return sendError(
      reply,
      422,
      'VALIDATION_ERROR',
      issues[0]?.message ?? 'Informe o motivo do cancelamento.',
      issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  const { lot, now } = await makeCancelLotUseCase().execute({
    lotId: id,
    auctioneerId: request.user.sub,
    reason: body.data.reason,
  });
  return reply.status(200).send(toLotDto(lot, now));
}
