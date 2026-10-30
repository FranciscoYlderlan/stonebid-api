import type { FastifyReply, FastifyRequest } from 'fastify';
import { toPublicMovement } from '../../../../domain/entities/wallet.ts';
import { makeDepositToWalletUseCase } from '../../../factories/make-deposit-to-wallet-use-case.ts';
import { toWalletDto } from '../../presenters/wallet-presenter.ts';
import { depositBodySchema, depositHeadersSchema } from '../../schemas/wallet-schemas.ts';

/** 201 no depósito novo; 200 com o mesmo movimento quando a Idempotency-Key se repete. */
export async function depositController(request: FastifyRequest, reply: FastifyReply) {
  const headers = depositHeadersSchema.parse(request.headers);
  const body = depositBodySchema.parse(request.body);

  const { movement, wallet, created } = await makeDepositToWalletUseCase().execute({
    userId: request.user.sub,
    amountCents: body.amountCents,
    idempotencyKey: headers['idempotency-key'],
  });

  return reply
    .status(created ? 201 : 200)
    .send({ movement: toPublicMovement(movement), wallet: toWalletDto(wallet) });
}
