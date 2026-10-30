import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ItemCatalog } from '../../../../domain/catalog/item-catalog.ts';
import { ItemNotFoundError } from '../../../../domain/errors/item-not-found-error.ts';
import { itemImageParamsSchema } from '../../schemas/lot-schemas.ts';

/** Uma semana: o id da imagem na AIC não muda de conteúdo. */
const THUMBNAIL_MAX_AGE_S = 7 * 24 * 60 * 60;

export function getItemThumbnailController(catalog: ItemCatalog) {
  return async function handler(request: FastifyRequest, reply: FastifyReply) {
    const { imageId } = itemImageParamsSchema.parse(request.params);
    const image = await catalog.downloadThumbnail(imageId);
    if (!image) throw new ItemNotFoundError();
    return reply
      .status(200)
      .header('content-type', image.contentType)
      .header('cache-control', `public, max-age=${THUMBNAIL_MAX_AGE_S}, immutable`)
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(image.data));
  };
}
