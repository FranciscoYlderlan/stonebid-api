import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeGetWalletUseCase } from '../../../factories/make-get-wallet-use-case.ts';
import { toWalletDto } from '../../presenters/wallet-presenter.ts';

export async function getWalletController(request: FastifyRequest, reply: FastifyReply) {
  const { wallet } = await makeGetWalletUseCase().execute(request.user.sub);
  return reply.status(200).send(toWalletDto(wallet));
}
