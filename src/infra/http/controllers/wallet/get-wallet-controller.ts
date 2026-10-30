import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../../../env/index.ts';
import { makeGetWalletUseCase } from '../../../factories/make-get-wallet-use-case.ts';

export async function getWalletController(request: FastifyRequest, reply: FastifyReply) {
  const { wallet } = await makeGetWalletUseCase().execute(request.user.sub);
  return reply.status(200).send({ ...wallet, depositLimitCents: env.DEPOSIT_LIMIT_CENTS });
}
