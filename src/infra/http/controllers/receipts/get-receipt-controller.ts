import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeGetReceiptUseCase } from '../../../factories/make-get-receipt-use-case.ts';
import { toReceiptDto } from '../../presenters/receipt-presenter.ts';
import { receiptParamsSchema } from '../../schemas/lot-schemas.ts';

export async function getReceiptController(request: FastifyRequest, reply: FastifyReply) {
  const { publicId } = receiptParamsSchema.parse(request.params);
  const receipt = await makeGetReceiptUseCase().execute(publicId);
  return reply.status(200).send({ receipt: toReceiptDto(receipt) });
}
