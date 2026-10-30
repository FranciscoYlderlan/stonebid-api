import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeGetLotImageUseCase } from '../../../factories/make-get-lot-image-use-case.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

export async function getLotImageController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const image = await makeGetLotImageUseCase().execute(id);
  return reply
    .status(200)
    .header('content-type', image.contentType)
    .header('cache-control', 'public, max-age=86400')
    .send(Buffer.from(image.data));
}
