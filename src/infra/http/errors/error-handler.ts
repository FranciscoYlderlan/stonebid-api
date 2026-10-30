import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../../domain/errors/app-error.ts';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const statusByCode: Record<string, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  LOT_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  DEPOSIT_LIMIT_EXCEEDED: 400,
  LOT_NOT_CANCELABLE: 409,
  ITEM_ALREADY_AUCTIONED: 409,
  ITEM_IMAGE_TOO_LARGE: 422,
  // Recusas do lance (RF-70).
  BID_BELOW_MINIMUM: 422,
  INSUFFICIENT_FUNDS: 422,
  ALREADY_WINNING: 409,
  LOT_NOT_STARTED: 409,
  LOT_ENDED: 409,
  LOT_CANCELED: 409,
  TOO_MANY_REQUESTS: 429,
  EXTERNAL_API_UNAVAILABLE: 502,
};

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  const body: ErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return reply.status(status).send(body);
}

/** Tratamento de erro centralizado: toda resposta de erro tem o formato `{ error: { code, message } }`. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        error.issues[0]?.message ?? 'Dados inválidos.',
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }

    if (error instanceof AppError) {
      return sendError(
        reply,
        statusByCode[error.code] ?? 400,
        error.code,
        error.message,
        error.details,
      );
    }

    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, 'BAD_REQUEST', 'Requisição inválida.');
    }

    request.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Erro interno. Tente novamente em instantes.');
  });

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, 'NOT_FOUND', 'Recurso não encontrado.'),
  );
}
